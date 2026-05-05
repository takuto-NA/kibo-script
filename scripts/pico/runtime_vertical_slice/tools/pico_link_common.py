# pyright: reportMissingImports=false
"""
Responsibility: shared USB serial helpers, trace line utilities, and Windows-only diagnostics for Pico vertical slice
developer CLIs (`pico_link_doctor`, `upload_pico_runtime_package`, `pico_link_check`, ...).

Guard: pyserial is required by callers that open serial ports; import errors must be surfaced with actionable install text.
"""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

KIBO_USB_SERIAL_BAUD_RATE = 115200
# Guard: production default must match `KIBO_PICO_RUNTIME_PACKAGE_MAX_MINIFIED_UTF8_BYTES` in
# `runtime/cpp/include/kibo_pico_runtime_package_storage_limits.hpp` and TypeScript preflight until a measured raise is adopted.
KIBO_PRODUCTION_DEFAULT_MAX_MINIFIED_UTF8_BYTES = 12288
KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES = KIBO_PRODUCTION_DEFAULT_MAX_MINIFIED_UTF8_BYTES
# Guard: sanity ceiling for `--experiment-max-minified-bytes` (host tooling); firmware macro should stay well below this.
KIBO_EXPERIMENT_DECODE_LIMIT_BYTE_COUNT_HARD_MAXIMUM = 500_000
# Guard: top-level padding key for RAM capacity boundary packages (ignored by firmware fields; preserved in JSON object).
KIBO_RAM_PROBE_PADDING_TOP_LEVEL_FIELD_NAME = "ramProbePadding"
# Guard: `k_max_serial_line_characters` in `runtime/pico/vertical_slice/src/main.cpp` — single-line `KIBO_PKG` 送信の上限。
KIBO_FIRMWARE_MAX_SERIAL_LINE_CHARACTERS = 16384
# Guard: TypeScript `kibo-pico-package-preflight.ts` の警告閾値と一致。
KIBO_FIRMWARE_PACKAGE_PREFLIGHT_WARN_FRACTION_OF_DECODE_LIMIT = 0.8
KIBO_NEGATIVE_GATE_OVERSIZED_PADDING_FIELD_NAME = "negativeGateOversizedPaddingFieldForLoaderProtocolGateOnly"
KIBO_SERIAL_PING_COMMAND_TEXT = "KIBO_PING"
KIBO_LOADER_STATUS_OK_PREFIX = "kibo_loader status=ok"
VERTICAL_SLICE_BOOT_BANNER_SUBSTRING = "kibo_pico_vertical_slice_boot"
RP2040_UF2_VOLUME_LABEL = "RPI-RP2"
SERIAL_READ_POLL_INTERVAL_SECONDS = 0.02
DEFAULT_SERIAL_READ_TIMEOUT_SECONDS = 0.05
DEFAULT_SERIAL_WRITE_TIMEOUT_SECONDS = 2.0
DEFAULT_PING_READ_SECONDS = 2.0
WINDOWS_CIM_PROCESS_QUERY_TIMEOUT_SECONDS = 12.0


def try_import_pyserial_serial_module_or_exit() -> Any:
    try:
        import serial  # type: ignore[import-untyped]

        return serial
    except ImportError as import_error:
        print("pyserial is required. Install with: uv pip install pyserial", file=sys.stderr)
        raise SystemExit(2) from import_error


def resolve_repository_root_from_tools_file(*, tools_file_path: Path) -> Path:
    # Guard: `tools/pico_link_common.py` lives at repoRoot/scripts/pico/runtime_vertical_slice/tools/.
    return tools_file_path.resolve().parents[4]


def resolve_default_blink_led_golden_pico_runtime_package_json_path_or_raise(*, repository_root: Path) -> Path:
    # Guard: golden package used by negative gate recovery smoke scripts and docs examples.
    candidate_path = (
        repository_root
        / "tests"
        / "runtime-conformance"
        / "golden"
        / "pico-runtime-packages"
        / "blink-led.pico-runtime-package.json"
    )
    if not candidate_path.is_file():
        raise FileNotFoundError(f"Default blink-led golden package missing: {candidate_path}")
    return candidate_path


def split_non_empty_lines_from_text(text: str) -> list[str]:
    return [
        line.rstrip("\r\n")
        for line in text.replace("\r\n", "\n").split("\n")
        if line.strip() != ""
    ]


def extract_trace_lines_from_serial_lines(serial_lines: Iterable[str]) -> list[str]:
    trace_lines: list[str] = []
    for line in serial_lines:
        if line.startswith("trace "):
            trace_lines.append(line)
    return trace_lines


def extract_conformance_trace_lines_from_serial_lines_excluding_ram_probe_diagnostics(serial_lines: Iterable[str]) -> list[str]:
    """
    Responsibility: USB Serial から取った行のうち、`diag=ram_probe` 以外の `trace schema=1 ...` 行だけを返す。

    Guard: RAM 容量実験で `ram_probe` が replay trace 行の間に挟まっても、`contains_expected_trace_sequence` で golden と照合できるようにする。
    """
    lines: list[str] = []
    for line in serial_lines:
        if not line.startswith("trace "):
            continue
        if "diag=ram_probe" in line:
            continue
        lines.append(line)
    return lines


def contains_expected_trace_sequence(*, actual_trace_lines: list[str], expected_trace_lines: list[str]) -> bool:
    if len(expected_trace_lines) == 0:
        return len(actual_trace_lines) == 0
    last_start_index = len(actual_trace_lines) - len(expected_trace_lines)
    for start_index in range(0, last_start_index + 1):
        candidate = actual_trace_lines[start_index : start_index + len(expected_trace_lines)]
        if candidate == expected_trace_lines:
            return True
    return False


def line_contains_vertical_slice_boot_banner(line: str) -> bool:
    return VERTICAL_SLICE_BOOT_BANNER_SUBSTRING in line


def find_first_kibo_loader_status_line(serial_lines: Iterable[str]) -> str | None:
    for line in serial_lines:
        if line.startswith(KIBO_LOADER_STATUS_OK_PREFIX):
            return line
    return None


def parse_loader_protocol_version_from_loader_status_line(line: str) -> int | None:
    match = re.search(r"\bprotocol=(\d+)\b", line)
    if match is None:
        return None
    return int(match.group(1), 10)


def parse_loader_active_name_from_loader_status_line(line: str) -> str | None:
    match = re.search(r"\bactive=([^\s]+)\b", line)
    if match is None:
        return None
    return match.group(1)


def find_first_kibo_pkg_ack_line(serial_lines: Iterable[str]) -> str | None:
    for line in serial_lines:
        if line.startswith("kibo_pkg_ack"):
            return line
    return None


def open_serial_port_for_kibo_vertical_slice_or_raise(
    *,
    serial_module: Any,
    port_path: str,
    baud_rate: int,
    read_timeout_seconds: float,
    write_timeout_seconds: float,
) -> Any:
    return serial_module.Serial(
        port=port_path,
        baudrate=baud_rate,
        timeout=read_timeout_seconds,
        write_timeout=write_timeout_seconds,
    )


def read_serial_lines_until_deadline(*, serial_port: Any, deadline_monotonic: float) -> list[str]:
    lines: list[str] = []
    while time.monotonic() < deadline_monotonic:
        waiting_bytes_count = int(serial_port.in_waiting)
        if waiting_bytes_count > 0:
            raw_line = serial_port.readline()
            if raw_line:
                lines.append(raw_line.decode("utf-8", errors="replace").rstrip("\r\n"))
            continue
        time.sleep(SERIAL_READ_POLL_INTERVAL_SECONDS)
    return lines


def read_serial_lines_for_seconds(*, serial_port: Any, capture_seconds: float) -> list[str]:
    deadline = time.monotonic() + capture_seconds
    return read_serial_lines_until_deadline(serial_port=serial_port, deadline_monotonic=deadline)


def write_text_line_and_flush_or_raise(*, serial_port: Any, line_without_newline: str) -> None:
    payload = f"{line_without_newline}\n".encode("ascii")
    serial_port.write(payload)
    serial_port.flush()


def send_kibo_ping_and_collect_lines(
    *,
    serial_port: Any,
    read_seconds: float = DEFAULT_PING_READ_SECONDS,
) -> list[str]:
    serial_port.reset_input_buffer()
    serial_port.reset_output_buffer()
    write_text_line_and_flush_or_raise(serial_port=serial_port, line_without_newline=KIBO_SERIAL_PING_COMMAND_TEXT)
    deadline = time.monotonic() + read_seconds
    return read_serial_lines_until_deadline(serial_port=serial_port, deadline_monotonic=deadline)


def list_serial_port_device_paths_and_descriptions() -> list[tuple[str, str]]:
    import serial.tools.list_ports  # type: ignore[import-untyped]

    results: list[tuple[str, str]] = []
    for port_info in serial.tools.list_ports.comports():
        results.append((port_info.device, port_info.description or ""))
    return results


def is_likely_rp2040_pico_usb_cdc_serial_port(*, device_path: str, description: str) -> bool:
    haystack = f"{device_path} {description}".lower()
    if "pico" in haystack:
        return True
    if "rp2040" in haystack:
        return True
    if "raspberry pi" in haystack and "serial" in haystack:
        return True
    # Windows often exposes the flashed Pico as "USB Serial Device" instead of a Pico-specific product name.
    if "usb" in haystack and "bluetooth" not in haystack:
        return True
    return False


def resolve_serial_port_path_for_vertical_slice_or_raise_value_error(*, port_argument: str) -> str:
    if port_argument.strip().lower() != "auto":
        return port_argument

    import serial.tools.list_ports  # type: ignore[import-untyped]  # noqa: F401

    pairs = list_serial_port_device_paths_and_descriptions()
    if len(pairs) == 0:
        raise ValueError("No serial ports were found. Connect Pico USB and retry, or pass explicit --port COMxx.")

    pico_like = [
        device
        for device, description in pairs
        if is_likely_rp2040_pico_usb_cdc_serial_port(device_path=device, description=description)
    ]
    if len(pico_like) == 1:
        return pico_like[0]
    if len(pico_like) > 1:
        lines = "\n".join([f"  - {device}: {description}" for device, description in pairs])
        raise ValueError("Multiple Pico-like serial ports were found; pass explicit --port.\n" + lines)

    if len(pairs) == 1:
        return pairs[0][0]

    lines = "\n".join([f"  - {device}: {description}" for device, description in pairs])
    raise ValueError("Could not auto-pick a serial port; pass explicit --port COMxx.\n" + lines)


def resolve_serial_port_path_for_vertical_slice_or_exit(*, port_argument: str) -> str:
    try:
        return resolve_serial_port_path_for_vertical_slice_or_raise_value_error(port_argument=port_argument)
    except ValueError as value_error:
        print(f"FAIL: {value_error}", file=sys.stderr)
        raise SystemExit(2) from value_error


def assert_windows_host_or_raise(*, feature_label: str) -> None:
    if platform.system().lower() != "windows":
        raise RuntimeError(f"{feature_label} is only implemented for Windows in this repository snapshot.")


def find_rp2040_bootsel_volume_drive_letter_or_none() -> str | None:
    assert_windows_host_or_raise(feature_label="BOOTSEL UF2 drive detection")
    command = [
        "powershell.exe",
        "-NoProfile",
        "-Command",
        "(Get-Volume | Where-Object { $_.FileSystemLabel -eq 'RPI-RP2' } | Select-Object -First 1 -ExpandProperty DriveLetter)",
    ]
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=WINDOWS_CIM_PROCESS_QUERY_TIMEOUT_SECONDS,
    )
    if completed.returncode != 0:
        return None
    letter = completed.stdout.strip()
    if letter == "":
        return None
    if len(letter) != 1:
        return None
    return letter.upper()


def find_process_command_lines_windows_substring_matches(*, substring: str) -> list[tuple[int, str]]:
    assert_windows_host_or_raise(feature_label="Windows process scan")
    escaped = substring.replace("'", "''")
    command = [
        "powershell.exe",
        "-NoProfile",
        "-Command",
        f"Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -like '*{escaped}*' }} | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ]
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=WINDOWS_CIM_PROCESS_QUERY_TIMEOUT_SECONDS,
    )
    if completed.returncode != 0:
        return []
    stdout_text = completed.stdout.strip()
    if stdout_text == "":
        return []
    try:
        parsed = json.loads(stdout_text)
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, dict):
        rows = [parsed]
    elif isinstance(parsed, list):
        rows = parsed
    else:
        return []
    results: list[tuple[int, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        process_id = row.get("ProcessId")
        command_line = row.get("CommandLine")
        if not isinstance(process_id, int):
            continue
        if not isinstance(command_line, str):
            continue
        results.append((process_id, command_line))
    return results


def format_permission_error_hint_for_serial_port(*, port_path: str) -> str:
    hints = [
        f"PermissionError while opening {port_path}.",
        "Another process may be holding the port (IDE serial monitor, another uploader, or a stuck Python process).",
    ]
    if platform.system().lower() == "windows":
        matches = find_process_command_lines_windows_substring_matches(substring=port_path)
        if len(matches) > 0:
            hints.append("Candidate processes (CommandLine contains port path):")
            for process_id, command_line in matches[:12]:
                hints.append(f"  - pid={process_id}: {command_line}")
    return "\n".join(hints)


def resolve_vertical_slice_firmware_uf2_path_or_none(*, repository_root: Path) -> Path | None:
    candidate = repository_root / "runtime" / "pico" / "vertical_slice" / ".pio" / "build" / "pico" / "firmware.uf2"
    if candidate.is_file():
        return candidate
    return None


def resolve_platform_io_cli_invocation_argv_or_raise(*, pio_executable_override: Path | None) -> list[str]:
    """
    Responsibility: argv prefix to invoke PlatformIO Core (`pio run` equivalent).

    Guard: On Windows, `pio` is often a PowerShell function (`python -m platformio`), which `shutil.which` and
    child processes cannot see — fall back to `python -m platformio` using the current interpreter.
    """
    if pio_executable_override is not None:
        return [str(pio_executable_override)]
    from shutil import which

    discovered = which("pio")
    if discovered is not None:
        return [discovered]
    probe_completed = subprocess.run(
        [sys.executable, "-m", "platformio", "--version"],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if probe_completed.returncode != 0:
        raise FileNotFoundError(
            "PlatformIO CLI not found: `pio` not on PATH and `python -m platformio` is unavailable. "
            "Install PlatformIO Core or pass --pio-exe to a real pio executable.",
        )
    return [sys.executable, "-m", "platformio"]


def run_vertical_slice_platform_io_build_or_raise(
    *,
    vertical_slice_directory: Path,
    pio_executable_override: Path | None,
    experiment_max_minified_utf8_bytes: int | None,
) -> None:
    """
    Responsibility: run `pio run` for `runtime/pico/vertical_slice`, optionally appending a decode-limit macro via env.

    Guard: `PLATFORMIO_BUILD_FLAGS` is merged (not replaced) so local developer flags remain intact.
    """
    argv_prefix = resolve_platform_io_cli_invocation_argv_or_raise(pio_executable_override=pio_executable_override)
    environment = os.environ.copy()
    if experiment_max_minified_utf8_bytes is not None:
        macro_flag = f"-DKIBO_PICO_RUNTIME_PACKAGE_MAX_MINIFIED_UTF8_BYTES={int(experiment_max_minified_utf8_bytes)}"
        prior_flags = environment.get("PLATFORMIO_BUILD_FLAGS", "").strip()
        environment["PLATFORMIO_BUILD_FLAGS"] = f"{macro_flag} {prior_flags}".strip() if prior_flags != "" else macro_flag
    completed_process = subprocess.run(
        argv_prefix + ["run"],
        cwd=str(vertical_slice_directory),
        env=environment,
        check=False,
    )
    if completed_process.returncode != 0:
        message = (
            f"PlatformIO build failed in {vertical_slice_directory} "
            f"exit_code={completed_process.returncode}"
        )
        raise RuntimeError(message)


def copy_vertical_slice_firmware_uf2_to_rp2040_bootsel_volume_or_raise(*, repository_root: Path) -> Path:
    """
    Responsibility: copy the freshly built `firmware.uf2` to the mounted BOOTSEL `RPI-RP2` drive root.

    Guard: Windows-only automation (same policy as `install_pico_loader.py`).
    """
    firmware_path = resolve_vertical_slice_firmware_uf2_path_or_none(repository_root=repository_root)
    if firmware_path is None:
        raise FileNotFoundError("firmware.uf2 not found; run a successful `pio run` first.")
    bootsel_drive_letter = find_rp2040_bootsel_volume_drive_letter_or_none()
    if bootsel_drive_letter is None:
        raise RuntimeError(
            f"BOOTSEL volume {RP2040_UF2_VOLUME_LABEL} not detected; hold BOOTSEL while plugging USB, then retry.",
        )
    destination_path = Path(f"{bootsel_drive_letter}:/firmware.uf2")
    shutil.copy2(firmware_path, destination_path)
    return destination_path


def wait_for_vertical_slice_loader_protocol_v1_handshake_on_serial_or_raise(
    *,
    serial_module: Any,
    port_argument: str,
    baud_rate: int,
    overall_timeout_seconds: float,
    poll_interval_seconds: float,
) -> None:
    """
    Responsibility: poll until `KIBO_PING` returns `kibo_loader ... protocol=1` (used after UF2 flash reboot).

    Guard: mirrors the handshake wait loop in `install_pico_loader.py` so exploration scripts can reuse it.
    """
    deadline_monotonic = time.monotonic() + overall_timeout_seconds
    while time.monotonic() < deadline_monotonic:
        try:
            port_path = resolve_serial_port_path_for_vertical_slice_or_raise_value_error(port_argument=port_argument)
            serial_port = open_serial_port_for_kibo_vertical_slice_or_raise(
                serial_module=serial_module,
                port_path=port_path,
                baud_rate=baud_rate,
                read_timeout_seconds=DEFAULT_SERIAL_READ_TIMEOUT_SECONDS,
                write_timeout_seconds=DEFAULT_SERIAL_WRITE_TIMEOUT_SECONDS,
            )
        except (PermissionError, OSError, ValueError):
            time.sleep(poll_interval_seconds)
            continue
        try:
            preflight_result = run_loader_preflight_on_open_serial_port(serial_port=serial_port)
            if preflight_result.loader_protocol_version == 1:
                return
        finally:
            serial_port.close()
        time.sleep(poll_interval_seconds)
    print("FAIL: timed out waiting for loader handshake protocol=1 after firmware boot.", file=sys.stderr)
    print("Next: run scripts/pico/runtime_vertical_slice/tools/pico_link_doctor.py --port auto", file=sys.stderr)
    raise RuntimeError("Timed out waiting for vertical slice loader handshake (protocol=1).")


def build_vertical_slice_ram_capacity_hardware_probe_argv(
    *,
    python_executable: str,
    probe_script_path: Path,
    serial_port_argument: str,
    response_read_seconds: int,
    blink_led_package_json_path: Path,
    blink_led_conformance_trace_txt_path: Path,
    experiment_max_minified_utf8_bytes: int | None,
) -> list[str]:
    """
    Responsibility: argv list for `probe_pico_runtime_package_ram_capacity.py` hardware RAM gate (padded ladder + oversize + recovery).

    Guard: `experiment_max_minified_utf8_bytes` must match the flashed firmware macro when set; otherwise keep None for production 12288 gate.
    """
    decode_limit_for_targets = (
        experiment_max_minified_utf8_bytes
        if experiment_max_minified_utf8_bytes is not None
        else KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES
    )
    max_bytes = decode_limit_for_targets
    boundary_targets = [
        int(max_bytes * 0.8),
        int(max_bytes * 0.9),
        max_bytes - 1,
        max_bytes,
    ]
    command: list[str] = [
        python_executable,
        str(probe_script_path),
        "--port",
        serial_port_argument,
        "--response-read-seconds",
        str(response_read_seconds),
        "--package-file",
        str(blink_led_package_json_path),
        "--padded-template-package-file",
        str(blink_led_package_json_path),
        "--recovery-package-file",
        str(blink_led_package_json_path),
        "--verify-expected-trace-file",
        str(blink_led_conformance_trace_txt_path),
        "--strict-ram-probe-phases",
        "--device-oversized-file-reject-then-recovery",
    ]
    if experiment_max_minified_utf8_bytes is not None:
        command.extend(
            [
                "--experiment-max-minified-bytes",
                str(int(experiment_max_minified_utf8_bytes)),
            ],
        )
    for target in boundary_targets:
        command.extend(["--padded-target-minified-bytes", str(target)])
    return command


def compute_crc32_hex32_lower_from_bytes(*, payload_bytes: bytes) -> str:
    import zlib

    crc32_value = zlib.crc32(payload_bytes) & 0xFFFFFFFF
    return f"{crc32_value:08x}"


def build_kibo_pkg_serial_line_from_utf8_json_bytes(json_utf8_bytes: bytes) -> str:
    import base64

    crc32_hex_text = compute_crc32_hex32_lower_from_bytes(payload_bytes=json_utf8_bytes)
    base64_payload_text = base64.b64encode(json_utf8_bytes).decode("ascii")
    byte_count = len(json_utf8_bytes)
    return f"KIBO_PKG schema=1 bytes={byte_count} crc32={crc32_hex_text} b64={base64_payload_text}\n"


def count_kibo_pkg_serial_line_characters_excluding_final_newline(*, kibo_pkg_line_text: str) -> int:
    # Guard: firmware counts characters before newline toward `k_max_serial_line_characters`.
    return len(kibo_pkg_line_text.rstrip("\n"))


def build_kibo_pkg_serial_line_from_utf8_json_bytes_with_crc32_hex_override(
    *,
    json_utf8_bytes: bytes,
    crc32_hex_text_lower_eight: str,
) -> str:
    import base64

    # Guard: intentionally wrong CRC for firmware `crc_mismatch` negative gates; payload bytes and Base64 stay consistent.
    base64_payload_text = base64.b64encode(json_utf8_bytes).decode("ascii")
    byte_count = len(json_utf8_bytes)
    return f"KIBO_PKG schema=1 bytes={byte_count} crc32={crc32_hex_text_lower_eight} b64={base64_payload_text}\n"


def minify_pico_runtime_package_json_text_to_utf8_bytes_or_raise(*, package_json_text: str) -> bytes:
    parsed_package_object = json.loads(package_json_text)
    return json.dumps(parsed_package_object, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def build_oversized_minified_package_utf8_bytes_from_template_object_or_raise(
    *,
    template_package_object: dict[str, Any],
    minimum_decoded_byte_count: int,
    firmware_decode_cap_byte_count: int | None = None,
) -> bytes:
    # Guard: `minimum_decoded_byte_count` must exceed firmware decode cap so the device returns `package_too_large`.
    decode_cap = (
        firmware_decode_cap_byte_count
        if firmware_decode_cap_byte_count is not None
        else KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES
    )
    if minimum_decoded_byte_count <= decode_cap:
        raise ValueError(
            f"minimum_decoded_byte_count must be greater than firmware decode cap ({decode_cap}).",
        )

    mutable_package_object = json.loads(json.dumps(template_package_object))
    padding_character = "a"
    padding_length = 0
    while True:
        mutable_package_object[KIBO_NEGATIVE_GATE_OVERSIZED_PADDING_FIELD_NAME] = padding_character * padding_length
        candidate_bytes = json.dumps(mutable_package_object, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if len(candidate_bytes) >= minimum_decoded_byte_count:
            return candidate_bytes
        padding_length += 512
        if padding_length > 10_000_000:
            raise RuntimeError("Failed to construct oversized package within padding search bound.")


def read_minified_pico_runtime_package_utf8_bytes_from_json_path_or_raise(*, package_json_path: Path) -> bytes:
    package_json_text = package_json_path.read_text(encoding="utf-8")
    return minify_pico_runtime_package_json_text_to_utf8_bytes_or_raise(package_json_text=package_json_text)


def send_kibo_pkg_line_and_collect_serial_lines_until_deadline_or_raise(
    *,
    serial_port: Any,
    kibo_pkg_line_text: str,
    deadline_monotonic: float,
) -> list[str]:
    serial_port.reset_input_buffer()
    serial_port.reset_output_buffer()
    write_text_line_and_flush_or_raise(serial_port=serial_port, line_without_newline=kibo_pkg_line_text.rstrip("\n"))
    return read_serial_lines_until_deadline(serial_port=serial_port, deadline_monotonic=deadline_monotonic)


def send_minified_kibo_pkg_from_utf8_json_bytes_and_expect_pkg_ack_substring_or_raise(
    *,
    serial_port: Any,
    minified_package_utf8_bytes: bytes,
    ack_timeout_seconds: float,
    expected_ack_substring: str,
) -> str:
    frame_line_text = build_kibo_pkg_serial_line_from_utf8_json_bytes(minified_package_utf8_bytes)
    deadline = time.monotonic() + ack_timeout_seconds
    captured_lines = send_kibo_pkg_line_and_collect_serial_lines_until_deadline_or_raise(
        serial_port=serial_port,
        kibo_pkg_line_text=frame_line_text,
        deadline_monotonic=deadline,
    )
    ack_line = find_first_kibo_pkg_ack_line(captured_lines)
    if ack_line is None:
        raise RuntimeError("Did not receive kibo_pkg_ack within timeout after sending recovery package.")
    if expected_ack_substring not in ack_line:
        raise RuntimeError(f"Unexpected kibo_pkg_ack line: {ack_line}")
    return ack_line


def evaluate_pico_package_payload_preflight_or_raise(
    *,
    minified_utf8_bytes: bytes,
    kibo_pkg_line_text_without_newline: str,
) -> None:
    """Guard: TS `assessKiboPicoRuntimePackageJsonTextPreflightOrThrow` と同じ拒否 / 警告ルール。"""
    byte_count = len(minified_utf8_bytes)
    line_char_count = len(kibo_pkg_line_text_without_newline)
    if byte_count > KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES:
        print(
            f"FAIL: package_too_large minified_utf8_bytes={byte_count} "
            f"limit={KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES}",
            file=sys.stderr,
        )
        raise SystemExit(1)
    if line_char_count > KIBO_FIRMWARE_MAX_SERIAL_LINE_CHARACTERS:
        print(
            f"FAIL: serial_line_too_long kibo_pkg_line_characters={line_char_count} "
            f"limit={KIBO_FIRMWARE_MAX_SERIAL_LINE_CHARACTERS}",
            file=sys.stderr,
        )
        raise SystemExit(1)
    warn_threshold_bytes = int(KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES * KIBO_FIRMWARE_PACKAGE_PREFLIGHT_WARN_FRACTION_OF_DECODE_LIMIT)
    if byte_count >= warn_threshold_bytes:
        percent = int(KIBO_FIRMWARE_PACKAGE_PREFLIGHT_WARN_FRACTION_OF_DECODE_LIMIT * 100)
        print(
            f"WARN: minified_utf8_bytes={byte_count} is at or above {percent}% "
            f"of decode limit (threshold {warn_threshold_bytes}). See docs/bytecode-transfer-design.md."
        )
    print(
        "PREFLIGHT: "
        f"ok minified_utf8_bytes={byte_count}/{KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES} "
        f"kibo_pkg_line_chars={line_char_count}/{KIBO_FIRMWARE_MAX_SERIAL_LINE_CHARACTERS}"
    )


def evaluate_pico_package_minified_utf8_byte_preflight_for_device_protocol_v1_or_raise(
    *,
    minified_utf8_bytes: bytes,
    device_protocol_v1_minified_utf8_byte_limit: int | None = None,
) -> None:
    """
    Guard: Kibo Device Protocol v1 では 1 行 `KIBO_PKG` 長を使わないため、decode 上限（既定 production 12288 bytes）のみ検査する。
    RAM probe 等で minified が 16384 超の「仮想 1 行」を作らない前提で、byte 数だけを hard gate する。

    Guard: `device_protocol_v1_minified_utf8_byte_limit` が指定される場合は実験ビルドの macro と一致させること（ホスト単独では検証不可）。
    """
    limit = (
        device_protocol_v1_minified_utf8_byte_limit
        if device_protocol_v1_minified_utf8_byte_limit is not None
        else KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES
    )
    if limit < 1 or limit > KIBO_EXPERIMENT_DECODE_LIMIT_BYTE_COUNT_HARD_MAXIMUM:
        raise ValueError(f"device_protocol_v1_minified_utf8_byte_limit out of range: {limit}")
    byte_count = len(minified_utf8_bytes)
    if byte_count > limit:
        print(
            f"FAIL: package_too_large minified_utf8_bytes={byte_count} "
            f"limit={limit}",
            file=sys.stderr,
        )
        raise SystemExit(1)
    warn_threshold_bytes = int(limit * KIBO_FIRMWARE_PACKAGE_PREFLIGHT_WARN_FRACTION_OF_DECODE_LIMIT)
    if byte_count >= warn_threshold_bytes:
        percent = int(KIBO_FIRMWARE_PACKAGE_PREFLIGHT_WARN_FRACTION_OF_DECODE_LIMIT * 100)
        print(
            f"WARN: minified_utf8_bytes={byte_count} is at or above {percent}% "
            f"of v1 staging limit (threshold {warn_threshold_bytes}). See docs/bytecode-transfer-design.md."
        )
    print(f"PREFLIGHT_V1_BYTES_ONLY: ok minified_utf8_bytes={byte_count}/{limit}")


def build_minified_pico_runtime_package_utf8_bytes_with_ram_probe_padding_target_length_or_raise(
    *,
    template_package_object: dict[str, Any],
    target_minified_utf8_byte_count: int,
    device_protocol_v1_minified_utf8_byte_limit: int | None = None,
) -> bytes:
    """
    Responsibility: adjust top-level `ramProbePadding` string so minified UTF-8 JSON matches a target byte length.

    Guard: target must be reachable by lengthening padding (monotone); caller supplies template already below target.
    """
    limit = (
        device_protocol_v1_minified_utf8_byte_limit
        if device_protocol_v1_minified_utf8_byte_limit is not None
        else KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES
    )
    if limit < 1 or limit > KIBO_EXPERIMENT_DECODE_LIMIT_BYTE_COUNT_HARD_MAXIMUM:
        raise ValueError(f"device_protocol_v1_minified_utf8_byte_limit out of range: {limit}")
    if target_minified_utf8_byte_count > limit:
        raise ValueError(
            f"target_minified_utf8_byte_count {target_minified_utf8_byte_count} exceeds experiment or production limit {limit}.",
        )
    mutable_package_object = json.loads(json.dumps(template_package_object))
    low = 0
    high = target_minified_utf8_byte_count + 4096
    padding_unit = "x"
    while True:
        mutable_package_object[KIBO_RAM_PROBE_PADDING_TOP_LEVEL_FIELD_NAME] = padding_unit * high
        candidate_high = json.dumps(mutable_package_object, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if len(candidate_high) >= target_minified_utf8_byte_count:
            break
        high *= 2
        if high > 5_000_000:
            raise RuntimeError("Failed to bracket ramProbePadding length for target byte count.")
    best_length = 0
    while low <= high:
        mid = (low + high) // 2
        mutable_package_object[KIBO_RAM_PROBE_PADDING_TOP_LEVEL_FIELD_NAME] = padding_unit * mid
        candidate_bytes = json.dumps(mutable_package_object, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        candidate_len = len(candidate_bytes)
        if candidate_len == target_minified_utf8_byte_count:
            return candidate_bytes
        if candidate_len < target_minified_utf8_byte_count:
            best_length = max(best_length, mid)
            low = mid + 1
        else:
            high = mid - 1
    mutable_package_object[KIBO_RAM_PROBE_PADDING_TOP_LEVEL_FIELD_NAME] = padding_unit * best_length
    candidate_bytes = json.dumps(mutable_package_object, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(candidate_bytes) != target_minified_utf8_byte_count:
        raise ValueError(
            f"Could not reach exact target_minified_utf8_byte_count={target_minified_utf8_byte_count}; "
            f"best reached {len(candidate_bytes)} with padding length {best_length}.",
        )
    return candidate_bytes


def build_minified_utf8_one_byte_over_firmware_decode_limit_from_template_or_raise(
    *,
    template_package_object: dict[str, Any],
    device_protocol_v1_minified_utf8_byte_limit: int | None = None,
) -> bytes:
    """
    Responsibility: `(limit + 1)` バイトの minified JSON を作る（v1 `FILE_BEGIN` の device reject 試験用）。

    Guard: テンプレを `ramProbePadding` でちょうど上限にしたうえで 1 文字だけ延ばす。
    """
    limit = (
        device_protocol_v1_minified_utf8_byte_limit
        if device_protocol_v1_minified_utf8_byte_limit is not None
        else KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES
    )
    at_limit_bytes = build_minified_pico_runtime_package_utf8_bytes_with_ram_probe_padding_target_length_or_raise(
        template_package_object=template_package_object,
        target_minified_utf8_byte_count=limit,
        device_protocol_v1_minified_utf8_byte_limit=device_protocol_v1_minified_utf8_byte_limit,
    )
    root = json.loads(at_limit_bytes.decode("utf-8"))
    padding_key = KIBO_RAM_PROBE_PADDING_TOP_LEVEL_FIELD_NAME
    root[padding_key] = f"{root[padding_key]}x"
    over_bytes = json.dumps(root, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    expected_len = limit + 1
    if len(over_bytes) != expected_len:
        raise ValueError(f"Expected minified length {expected_len}, got {len(over_bytes)}.")
    return over_bytes


def resolve_node_and_tsx_invocation_or_exit(*, repository_root: Path) -> list[str]:
    tsx_cli = repository_root / "node_modules" / "tsx" / "dist" / "cli.mjs"
    if not tsx_cli.is_file():
        print(
            "FAIL: tsx is not installed. From the repository root run: npm install",
            file=sys.stderr,
        )
        raise SystemExit(2)
    return ["node", str(tsx_cli)]


def build_pico_runtime_package_using_tsx_cli_or_exit(
    *,
    repository_root: Path,
    runtime_ir_contract_json_path: Path,
    output_package_json_path: Path,
    trace_var_names_comma_separated: str | None,
    live_tick_interval_milliseconds: int | None = None,
    replay_preset_id: str | None = None,
) -> None:
    base = resolve_node_and_tsx_invocation_or_exit(repository_root=repository_root)
    cli_script = repository_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "build_pico_runtime_package_cli.ts"
    command = [
        *base,
        str(cli_script),
        "--input",
        str(runtime_ir_contract_json_path),
        "--output",
        str(output_package_json_path),
    ]
    if trace_var_names_comma_separated is not None:
        command.extend(["--trace-var", trace_var_names_comma_separated])
    if live_tick_interval_milliseconds is not None:
        command.extend(["--tick-ms", str(int(live_tick_interval_milliseconds))])
    if replay_preset_id is not None:
        command.extend(["--replay-preset", replay_preset_id])
    completed = subprocess.run(command, check=False, cwd=str(repository_root))
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def build_pico_runtime_package_from_source_using_tsx_cli_or_exit(
    *,
    repository_root: Path,
    source_script_path: Path,
    output_package_json_path: Path,
    trace_var_names_comma_separated: str | None,
    live_tick_interval_milliseconds: int | None = None,
    replay_preset_id: str | None = None,
) -> None:
    base = resolve_node_and_tsx_invocation_or_exit(repository_root=repository_root)
    cli_script = repository_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "build_pico_runtime_package_from_script_cli.ts"
    command = [
        *base,
        str(cli_script),
        "--input-script",
        str(source_script_path),
        "--output",
        str(output_package_json_path),
    ]
    if trace_var_names_comma_separated is not None:
        command.extend(["--trace-var", trace_var_names_comma_separated])
    if live_tick_interval_milliseconds is not None:
        command.extend(["--tick-ms", str(int(live_tick_interval_milliseconds))])
    if replay_preset_id is not None:
        command.extend(["--replay-preset", replay_preset_id])
    completed = subprocess.run(command, check=False, cwd=str(repository_root))
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def print_expected_conformance_trace_lines_from_package_using_tsx_or_exit(
    *,
    repository_root: Path,
    package_json_path: Path,
) -> list[str]:
    base = resolve_node_and_tsx_invocation_or_exit(repository_root=repository_root)
    cli_script = (
        repository_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "print_expected_conformance_trace_lines_from_pico_runtime_package_cli.ts"
    )
    command = [
        *base,
        str(cli_script),
        "--package-file",
        str(package_json_path),
    ]
    completed = subprocess.run(command, check=False, cwd=str(repository_root), capture_output=True, text=True)
    if completed.returncode != 0:
        print(completed.stderr, file=sys.stderr)
        print(completed.stdout, file=sys.stderr)
        raise SystemExit(completed.returncode)
    return split_non_empty_lines_from_text(completed.stdout)


def write_device_protocol_v1_frame_and_sleep_or_raise(
    *,
    serial_port: Any,
    frame_bytes: bytes,
    sleep_seconds: float,
) -> None:
    serial_port.write(frame_bytes)
    serial_port.flush()
    time.sleep(sleep_seconds)


def drain_serial_port_inbound_complete_lines_already_buffered_or_empty(*, serial_port: Any) -> list[str]:
    """
    Responsibility: read complete newline-terminated lines already sitting in the USB serial RX driver buffer.

    Guard: v1 upload 中にデバイスが出す `ram_probe` 等がホスト未読のまま溜まり、Windows CDC の受信上限で先頭行が落ちるのを防ぐ。
    """
    lines: list[str] = []
    max_lines_per_drain_call = 10_000
    for _ in range(max_lines_per_drain_call):
        waiting_bytes_count = int(serial_port.in_waiting or 0)
        if waiting_bytes_count <= 0:
            break
        raw_line = serial_port.readline()
        if not raw_line:
            break
        lines.append(raw_line.decode("utf-8", errors="replace").rstrip("\r\n"))
    return lines


def upload_minified_pico_runtime_package_utf8_via_device_protocol_v1_and_collect_serial_lines_or_raise(
    *,
    serial_port: Any,
    minified_utf8_bytes: bytes,
    chunk_utf8_bytes: int,
    inter_frame_sleep_seconds: float,
    capture_after_run_seconds: float,
) -> list[str]:
    """
    Responsibility: HELLO → FILE_BEGIN → FILE_CHUNK* → FILE_COMMIT → RUN_PACKAGE then read serial for a bounded time.

    Guard: caller must have completed loader preflight; input buffers should be reset by caller if needed.
    """
    import kibo_device_protocol_v1 as kdp

    sequence_counter = 0
    captured_lines: list[str] = []

    def next_sequence() -> int:
        nonlocal sequence_counter
        sequence_counter += 1
        return sequence_counter

    def write_frame_collect_inbound_or_raise(*, frame_bytes: bytes, sleep_seconds: float) -> None:
        write_device_protocol_v1_frame_and_sleep_or_raise(
            serial_port=serial_port,
            frame_bytes=frame_bytes,
            sleep_seconds=sleep_seconds,
        )
        captured_lines.extend(drain_serial_port_inbound_complete_lines_already_buffered_or_empty(serial_port=serial_port))

    hello_payload = json.dumps(
        {"hostProtocolVersion": 1, "hostName": "kibo-python-device-protocol-v1-ram-probe"},
        separators=(",", ":"),
    ).encode("utf-8")
    hello_frame = kdp.encode_kibo_device_protocol_v1_frame_or_raise(
        sequence=next_sequence(),
        request_id=1,
        message_kind=kdp.KiboDeviceProtocolV1MessageKind.HELLO,
        payload_utf8_bytes=hello_payload,
    )
    write_frame_collect_inbound_or_raise(
        frame_bytes=hello_frame,
        sleep_seconds=inter_frame_sleep_seconds,
    )

    file_id = 1
    whole_crc = kdp.compute_crc32_hex8_lower_from_utf8_bytes(minified_utf8_bytes)
    begin_payload = kdp.build_json_utf8_payload_text_for_file_begin(
        file_id=file_id,
        kind="pico_runtime_package_json_minified_utf8",
        total_byte_length=len(minified_utf8_bytes),
        whole_payload_crc32_hex_lower=whole_crc,
    )
    begin_frame = kdp.encode_kibo_device_protocol_v1_frame_or_raise(
        sequence=next_sequence(),
        request_id=1,
        message_kind=kdp.KiboDeviceProtocolV1MessageKind.FILE_BEGIN,
        payload_utf8_bytes=begin_payload,
    )
    write_frame_collect_inbound_or_raise(
        frame_bytes=begin_frame,
        sleep_seconds=inter_frame_sleep_seconds,
    )

    chunk_index = 0
    byte_offset = 0
    chunk_size = max(1, int(chunk_utf8_bytes))
    while byte_offset < len(minified_utf8_bytes):
        chunk_bytes = minified_utf8_bytes[byte_offset : byte_offset + chunk_size]
        chunk_crc = kdp.compute_crc32_hex8_lower_from_utf8_bytes(chunk_bytes)
        chunk_payload = kdp.build_json_utf8_payload_text_for_file_chunk(
            file_id=file_id,
            chunk_index=chunk_index,
            byte_offset=byte_offset,
            chunk_crc32_hex_lower=chunk_crc,
            chunk_payload_utf8_bytes=chunk_bytes,
        )
        chunk_frame = kdp.encode_kibo_device_protocol_v1_frame_or_raise(
            sequence=next_sequence(),
            request_id=1,
            message_kind=kdp.KiboDeviceProtocolV1MessageKind.FILE_CHUNK,
            payload_utf8_bytes=chunk_payload,
        )
        write_frame_collect_inbound_or_raise(
            frame_bytes=chunk_frame,
            sleep_seconds=inter_frame_sleep_seconds,
        )
        byte_offset += len(chunk_bytes)
        chunk_index += 1

    commit_payload = kdp.build_json_utf8_payload_text_for_file_commit(file_id=file_id)
    commit_frame = kdp.encode_kibo_device_protocol_v1_frame_or_raise(
        sequence=next_sequence(),
        request_id=1,
        message_kind=kdp.KiboDeviceProtocolV1MessageKind.FILE_COMMIT,
        payload_utf8_bytes=commit_payload,
    )
    write_frame_collect_inbound_or_raise(
        frame_bytes=commit_frame,
        sleep_seconds=inter_frame_sleep_seconds,
    )

    run_payload = kdp.build_json_utf8_payload_text_for_run_package()
    run_frame = kdp.encode_kibo_device_protocol_v1_frame_or_raise(
        sequence=next_sequence(),
        request_id=1,
        message_kind=kdp.KiboDeviceProtocolV1MessageKind.RUN_PACKAGE,
        payload_utf8_bytes=run_payload,
    )
    write_frame_collect_inbound_or_raise(
        frame_bytes=run_frame,
        sleep_seconds=inter_frame_sleep_seconds,
    )

    captured_lines.extend(
        read_serial_lines_for_seconds(serial_port=serial_port, capture_seconds=capture_after_run_seconds),
    )
    return captured_lines


@dataclass(frozen=True)
class LoaderPreflightResult:
    boot_banner_found: bool
    loader_status_line: str | None
    loader_protocol_version: int | None
    captured_lines: list[str]


def run_loader_preflight_on_open_serial_port(
    *,
    serial_port: Any,
    ping_read_seconds: float = DEFAULT_PING_READ_SECONDS,
) -> LoaderPreflightResult:
    lines_after_ping = send_kibo_ping_and_collect_lines(serial_port=serial_port, read_seconds=ping_read_seconds)
    boot_banner_found = any(line_contains_vertical_slice_boot_banner(line) for line in lines_after_ping)
    loader_line = find_first_kibo_loader_status_line(lines_after_ping)
    protocol_version = parse_loader_protocol_version_from_loader_status_line(loader_line) if loader_line else None
    return LoaderPreflightResult(
        boot_banner_found=boot_banner_found,
        loader_status_line=loader_line,
        loader_protocol_version=protocol_version,
        captured_lines=lines_after_ping,
    )
