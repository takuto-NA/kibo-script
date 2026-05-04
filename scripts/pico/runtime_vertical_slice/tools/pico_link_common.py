# pyright: reportMissingImports=false
"""
Responsibility: shared USB serial helpers, trace line utilities, and Windows-only diagnostics for Pico vertical slice
developer CLIs (`pico_link_doctor`, `upload_pico_runtime_package`, `pico_link_check`, ...).

Guard: pyserial is required by callers that open serial ports; import errors must be surfaced with actionable install text.
"""

from __future__ import annotations

import json
import platform
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

KIBO_USB_SERIAL_BAUD_RATE = 115200
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


def build_kibo_pkg_serial_line_from_utf8_json_bytes(json_utf8_bytes: bytes) -> str:
    import base64
    import zlib

    crc32_value = zlib.crc32(json_utf8_bytes) & 0xFFFFFFFF
    crc32_hex_text = f"{crc32_value:08x}"
    base64_payload_text = base64.b64encode(json_utf8_bytes).decode("ascii")
    byte_count = len(json_utf8_bytes)
    return f"KIBO_PKG schema=1 bytes={byte_count} crc32={crc32_hex_text} b64={base64_payload_text}\n"


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
    completed = subprocess.run(command, check=False, cwd=str(repository_root))
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def build_pico_runtime_package_from_source_using_tsx_cli_or_exit(
    *,
    repository_root: Path,
    source_script_path: Path,
    output_package_json_path: Path,
    trace_var_names_comma_separated: str | None,
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
