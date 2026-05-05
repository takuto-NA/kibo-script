# pyright: reportMissingImports=false
"""
Responsibility: orchestrate Pico vertical slice **decode limit** experiments by building firmware with
`-DKIBO_PICO_RUNTIME_PACKAGE_MAX_MINIFIED_UTF8_BYTES=<N>`, optionally copying UF2 to BOOTSEL, waiting for CDC,
then running the same RAM hardware gate as `--profile ram` with matching `--experiment-max-minified-bytes`.

Guard: production TypeScript / default Python preflight remain 12288 until a measured adoption; this script is for lab runs only.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Iterable

import pico_link_common as common

_DEFAULT_CANDIDATE_DECODE_LIMITS_BYTES = (14336, 16384, 18432, 20480, 24576, 32768)
_RAM_PROBE_PHASE_COMMIT_AFTER_JSON_PARSE = "commit_after_json_parse"
_RAM_PROBE_PHASE_COMMIT_AFTER_LIVE_RUNTIME_RESET = "commit_after_live_runtime_reset"
_POST_FLASH_HANDSHAKE_WAIT_TIMEOUT_SECONDS = 45.0
_POST_FLASH_HANDSHAKE_POLL_INTERVAL_SECONDS = 1.0


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build + flash + run RAM gate for candidate PicoRuntimePackage decode limits (lab tooling).",
    )
    default_repo_root = common.resolve_repository_root_from_tools_file(tools_file_path=Path(__file__))
    parser.add_argument("--repo-root", type=Path, default=default_repo_root, help="Repository root.")
    parser.add_argument(
        "--port",
        default="auto",
        help="Serial port after firmware reboot (e.g. COM11) or `auto`.",
    )
    parser.add_argument("--capture-seconds", type=int, default=15, help="Probe `--response-read-seconds` window.")
    parser.add_argument(
        "--pio-exe",
        type=Path,
        default=None,
        help="Path to `pio` when not on PATH.",
    )
    parser.add_argument(
        "--candidate-decode-limit-bytes",
        type=int,
        action="append",
        default=[],
        help="Repeatable decode limits to try (each triggers rebuild + optional UF2 copy + RAM gate).",
    )
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Skip PlatformIO build (use existing firmware.uf2; macro must already match each candidate).",
    )
    parser.add_argument(
        "--skip-uf2-copy",
        action="store_true",
        help="Skip BOOTSEL UF2 copy (you flashed manually).",
    )
    parser.add_argument(
        "--skip-handshake-wait",
        action="store_true",
        help="Skip CDC wait after UF2 copy (serial already up).",
    )
    parser.add_argument(
        "--jsonl-results",
        type=Path,
        default=None,
        help="Append one JSON summary line per candidate.",
    )
    parser.add_argument(
        "--min-free-heap-bytes-for-safe-candidate",
        type=int,
        default=64 * 1024,
        help="After a successful gate, require these phases' free_heap >= threshold (default 64KiB per plan).",
    )
    parser.add_argument(
        "--soak-iterations",
        type=int,
        default=20,
        help="Near-limit repeated uploads at the candidate limit (0 disables).",
    )
    parser.add_argument(
        "--stop-on-first-failure",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="When true, stop after the first candidate gate failure.",
    )
    return parser.parse_args(argv)


def parse_candidate_decode_limit_bytes_list_or_exit(*, raw_candidates: list[int]) -> list[int]:
    if len(raw_candidates) == 0:
        return list(_DEFAULT_CANDIDATE_DECODE_LIMITS_BYTES)
    ordered_unique: list[int] = []
    seen: set[int] = set()
    for value in sorted(raw_candidates):
        if value in seen:
            continue
        seen.add(value)
        ordered_unique.append(value)
    for limit in ordered_unique:
        if limit < 1024:
            print("FAIL: each --candidate-decode-limit-bytes must be >= 1024.", file=sys.stderr)
            raise SystemExit(2)
        if limit > common.KIBO_EXPERIMENT_DECODE_LIMIT_BYTE_COUNT_HARD_MAXIMUM:
            print("FAIL: candidate decode limit exceeds hard maximum.", file=sys.stderr)
            raise SystemExit(2)
    return ordered_unique


def read_jsonl_records_from_text_lines(*, text: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped == "":
            continue
        records.append(json.loads(stripped))
    return records


def find_free_heap_for_ram_probe_phase_or_none(*, ram_probe_samples: Iterable[dict[str, Any]], phase: str) -> int | None:
    for sample in ram_probe_samples:
        if sample.get("phase") == phase:
            raw = sample.get("free_heap")
            if isinstance(raw, int):
                return raw
            if isinstance(raw, str) and raw.isdigit():
                return int(raw, 10)
    return None


def assert_ram_probe_phases_meet_minimum_free_heap_or_raise(
    *,
    gate_jsonl_text: str,
    minimum_free_heap_bytes: int,
    candidate_limit_bytes: int,
) -> None:
    records = read_jsonl_records_from_text_lines(text=gate_jsonl_text)
    target_record: dict[str, Any] | None = None
    for record in records:
        byte_count = record.get("minifiedUtf8ByteCount")
        label = str(record.get("label", ""))
        if byte_count == candidate_limit_bytes and label.startswith("padded:"):
            target_record = record
            break
    if target_record is None:
        raise RuntimeError(
            f"Could not find JSONL record for padded upload at exactly {candidate_limit_bytes} bytes.",
        )
    samples = target_record.get("ramProbeSamples")
    if not isinstance(samples, list):
        raise RuntimeError("ramProbeSamples missing or not a list in JSONL record.")
    for phase in (
        _RAM_PROBE_PHASE_COMMIT_AFTER_JSON_PARSE,
        _RAM_PROBE_PHASE_COMMIT_AFTER_LIVE_RUNTIME_RESET,
    ):
        free_heap = find_free_heap_for_ram_probe_phase_or_none(ram_probe_samples=samples, phase=phase)
        if free_heap is None:
            raise RuntimeError(f"Missing ram_probe phase {phase} in JSONL record.")
        if free_heap < minimum_free_heap_bytes:
            raise RuntimeError(
                f"Heap threshold failure: phase={phase} free_heap={free_heap} < {minimum_free_heap_bytes}",
            )


def run_ram_gate_subprocess_and_capture_jsonl_or_raise(
    *,
    repo_root: Path,
    port: str,
    capture_seconds: int,
    candidate_limit_bytes: int,
    gate_jsonl_path: Path,
) -> str:
    probe_script = repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "probe_pico_runtime_package_ram_capacity.py"
    golden_directory = repo_root / "tests" / "runtime-conformance" / "golden"
    package_directory = golden_directory / "pico-runtime-packages"
    blink_led = package_directory / "blink-led.pico-runtime-package.json"
    blink_led_trace = golden_directory / "blink-led.conformance.trace.txt"
    command = common.build_vertical_slice_ram_capacity_hardware_probe_argv(
        python_executable=sys.executable,
        probe_script_path=probe_script,
        serial_port_argument=port,
        response_read_seconds=capture_seconds,
        blink_led_package_json_path=blink_led,
        blink_led_conformance_trace_txt_path=blink_led_trace,
        experiment_max_minified_utf8_bytes=candidate_limit_bytes,
    )
    command.extend(["--jsonl-out", str(gate_jsonl_path)])
    completed = subprocess.run(command, check=False, cwd=str(repo_root))
    if completed.returncode != 0:
        raise RuntimeError(f"RAM gate subprocess failed exit_code={completed.returncode}")
    return gate_jsonl_path.read_text(encoding="utf-8")


def run_soak_iterations_or_raise(
    *,
    repo_root: Path,
    port: str,
    capture_seconds: int,
    candidate_limit_bytes: int,
    soak_iterations: int,
    soak_jsonl_path: Path,
) -> None:
    """
    Responsibility: stress the device with repeated max-size padded uploads (each subprocess is one upload + recovery).

    Guard: each iteration appends one JSONL object to `soak_jsonl_path` via probe `--jsonl-out`.
    """
    probe_script = repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "probe_pico_runtime_package_ram_capacity.py"
    golden_directory = repo_root / "tests" / "runtime-conformance" / "golden"
    package_directory = golden_directory / "pico-runtime-packages"
    blink_led = package_directory / "blink-led.pico-runtime-package.json"
    soak_jsonl_path.parent.mkdir(parents=True, exist_ok=True)
    soak_jsonl_path.write_text("", encoding="utf-8")
    for iteration_index in range(soak_iterations):
        command = [
            sys.executable,
            str(probe_script),
            "--port",
            port,
            "--response-read-seconds",
            str(capture_seconds),
            "--experiment-max-minified-bytes",
            str(candidate_limit_bytes),
            "--padded-template-package-file",
            str(blink_led),
            "--padded-target-minified-bytes",
            str(candidate_limit_bytes),
            "--recovery-package-file",
            str(blink_led),
            "--strict-ram-probe-phases",
            "--jsonl-out",
            str(soak_jsonl_path),
        ]
        completed = subprocess.run(command, check=False, cwd=str(repo_root))
        if completed.returncode != 0:
            raise RuntimeError(f"Soak iteration {iteration_index} failed exit_code={completed.returncode}")


def append_jsonl_result_line_or_raise(*, jsonl_results_path: Path | None, result_object: dict[str, Any]) -> None:
    if jsonl_results_path is None:
        return
    jsonl_results_path.parent.mkdir(parents=True, exist_ok=True)
    with jsonl_results_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(result_object, ensure_ascii=False) + "\n")


def main() -> None:
    arguments = parse_arguments_or_exit(sys.argv[1:])
    repo_root = arguments.repo_root.resolve()
    vertical_slice_directory = repo_root / "runtime" / "pico" / "vertical_slice"
    candidate_limits = parse_candidate_decode_limit_bytes_list_or_exit(raw_candidates=list(arguments.candidate_decode_limit_bytes))
    jsonl_results_handle_path: Path | None = arguments.jsonl_results
    serial_module = common.try_import_pyserial_serial_module_or_exit()

    for candidate_limit_bytes in candidate_limits:
        summary: dict[str, Any] = {
            "candidateDecodeLimitBytes": candidate_limit_bytes,
            "status": "unknown",
        }
        try:
            if not arguments.skip_build:
                common.run_vertical_slice_platform_io_build_or_raise(
                    vertical_slice_directory=vertical_slice_directory,
                    pio_executable_override=arguments.pio_exe,
                    experiment_max_minified_utf8_bytes=candidate_limit_bytes,
                )
            if not arguments.skip_uf2_copy:
                common.copy_vertical_slice_firmware_uf2_to_rp2040_bootsel_volume_or_raise(repository_root=repo_root)
            if not arguments.skip_handshake_wait:
                common.wait_for_vertical_slice_loader_protocol_v1_handshake_on_serial_or_raise(
                    serial_module=serial_module,
                    port_argument=arguments.port,
                    baud_rate=common.KIBO_USB_SERIAL_BAUD_RATE,
                    overall_timeout_seconds=_POST_FLASH_HANDSHAKE_WAIT_TIMEOUT_SECONDS,
                    poll_interval_seconds=_POST_FLASH_HANDSHAKE_POLL_INTERVAL_SECONDS,
                )
            with tempfile.TemporaryDirectory() as temporary_directory:
                gate_jsonl_path = Path(temporary_directory) / f"ram_gate_candidate_{candidate_limit_bytes}.jsonl"
                gate_jsonl_text = run_ram_gate_subprocess_and_capture_jsonl_or_raise(
                    repo_root=repo_root,
                    port=arguments.port,
                    capture_seconds=arguments.capture_seconds,
                    candidate_limit_bytes=candidate_limit_bytes,
                    gate_jsonl_path=gate_jsonl_path,
                )
                assert_ram_probe_phases_meet_minimum_free_heap_or_raise(
                    gate_jsonl_text=gate_jsonl_text,
                    minimum_free_heap_bytes=arguments.min_free_heap_bytes_for_safe_candidate,
                    candidate_limit_bytes=candidate_limit_bytes,
                )
                summary["heapThresholdStatus"] = "ok"
                persistent_gate_log_path = (
                    repo_root
                    / "runtime"
                    / "pico"
                    / "vertical_slice"
                    / ".pio"
                    / f"ram_limit_search_gate_{candidate_limit_bytes}.jsonl"
                )
                persistent_gate_log_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(gate_jsonl_path, persistent_gate_log_path)
                summary["gateJsonlPath"] = str(persistent_gate_log_path)
            if arguments.soak_iterations > 0:
                soak_path = repo_root / "runtime" / "pico" / "vertical_slice" / ".pio" / "ram_limit_search_soak.jsonl"
                run_soak_iterations_or_raise(
                    repo_root=repo_root,
                    port=arguments.port,
                    capture_seconds=arguments.capture_seconds,
                    candidate_limit_bytes=candidate_limit_bytes,
                    soak_iterations=arguments.soak_iterations,
                    soak_jsonl_path=soak_path,
                )
                summary["soakJsonlPath"] = str(soak_path)
                summary["soakIterations"] = arguments.soak_iterations
            summary["status"] = "ok"
            print(json.dumps(summary, ensure_ascii=False))
            append_jsonl_result_line_or_raise(jsonl_results_path=jsonl_results_handle_path, result_object=summary)
        except (RuntimeError, FileNotFoundError, OSError) as error:
            summary["status"] = "fail"
            summary["failureClass"] = type(error).__name__
            summary["failureMessage"] = str(error)
            print(json.dumps(summary, ensure_ascii=False), file=sys.stderr)
            append_jsonl_result_line_or_raise(jsonl_results_path=jsonl_results_handle_path, result_object=summary)
            if arguments.stop_on_first_failure:
                raise SystemExit(1) from error
    print("OK: ram limit search completed for all candidates.")


if __name__ == "__main__":
    main()