# pyright: reportMissingImports=false
"""
Responsibility: verify that a USB-connected Raspberry Pi Pico running the vertical slice
firmware emits the expected boot banner and conformance trace sequence (hardware baseline).

Guard: this script requires pyserial on the host. It is not part of the default npm test suite.

Example (PowerShell, from repo root, using isolated venv per docs/pico-bringup.md):

    & $picoVenvPython scripts/pico/runtime_vertical_slice/tools/check_pico_baseline.py ^
        --port COM11 --capture-seconds 8 --expected-trace-file tests/runtime-conformance/golden/circle-animation.conformance.trace.txt
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path


def split_non_empty_lines_from_text(text: str) -> list[str]:
    return [
        line.rstrip("\r\n")
        for line in text.replace("\r\n", "\n").split("\n")
        if line.strip() != ""
    ]


def extract_trace_lines_from_serial_lines(serial_lines: list[str]) -> list[str]:
    trace_lines: list[str] = []
    for line in serial_lines:
        if line.startswith("trace "):
            trace_lines.append(line)
    return trace_lines


def extract_trace_lines_from_text_file(file_text: str) -> list[str]:
    return extract_trace_lines_from_serial_lines(split_non_empty_lines_from_text(file_text))


def contains_expected_trace_sequence(
    actual_trace_lines: list[str],
    expected_trace_lines: list[str],
) -> bool:
    if len(expected_trace_lines) == 0:
        return len(actual_trace_lines) == 0
    last_start_index = len(actual_trace_lines) - len(expected_trace_lines)
    for start_index in range(0, last_start_index + 1):
        candidate = actual_trace_lines[start_index : start_index + len(expected_trace_lines)]
        if candidate == expected_trace_lines:
            return True
    return False


def has_vertical_slice_boot_banner(serial_lines: list[str]) -> bool:
    for line in serial_lines:
        if "kibo_pico_vertical_slice_boot" in line:
            return True
    return False


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture USB serial from Pico and verify baseline trace against golden file.",
    )
    parser.add_argument(
        "--port",
        required=True,
        help="Serial port path, e.g. COM11 on Windows or /dev/ttyACM0 on Linux.",
    )
    parser.add_argument(
        "--baud-rate",
        type=int,
        default=115200,
        help="Serial baud rate (default: 115200).",
    )
    parser.add_argument(
        "--capture-seconds",
        type=int,
        required=True,
        help="How many seconds to read from the serial port.",
    )
    parser.add_argument(
        "--expected-trace-file",
        type=Path,
        required=True,
        help="Path to golden trace text file (e.g. circle-animation.conformance.trace.txt).",
    )
    return parser.parse_args(argv)


def read_serial_lines_for_seconds_or_exit(
    *,
    port_path: str,
    baud_rate: int,
    capture_seconds: int,
) -> list[str]:
    try:
        import serial  # type: ignore[import-untyped]
    except ImportError as import_error:
        print(
            "pyserial is required. Install with: uv pip install pyserial",
            file=sys.stderr,
        )
        raise SystemExit(2) from import_error

    serial_port = serial.Serial(port=port_path, baudrate=baud_rate, timeout=0.1)
    lines: list[str] = []
    deadline = time.monotonic() + capture_seconds
    try:
        while time.monotonic() < deadline:
            raw_line = serial_port.readline()
            if raw_line:
                lines.append(raw_line.decode("utf-8", errors="replace").rstrip("\r\n"))
    finally:
        serial_port.close()
    return lines


def main() -> None:
    arguments = parse_arguments_or_exit(sys.argv[1:])
    expected_text = arguments.expected_trace_file.read_text(encoding="utf-8")
    expected_trace_lines = extract_trace_lines_from_text_file(expected_text)

    print(
        f"Capturing serial from {arguments.port} for {arguments.capture_seconds}s "
        f"(baud={arguments.baud_rate})...",
        flush=True,
    )
    captured_lines = read_serial_lines_for_seconds_or_exit(
        port_path=arguments.port,
        baud_rate=arguments.baud_rate,
        capture_seconds=arguments.capture_seconds,
    )

    if not has_vertical_slice_boot_banner(captured_lines):
        print("FAIL: did not find kibo_pico_vertical_slice_boot in captured serial output.", file=sys.stderr)
        print("--- captured (first 40 lines) ---", file=sys.stderr)
        for line in captured_lines[:40]:
            print(line, file=sys.stderr)
        raise SystemExit(1)

    actual_trace_lines = extract_trace_lines_from_serial_lines(captured_lines)
    if not contains_expected_trace_sequence(actual_trace_lines, expected_trace_lines):
        print("FAIL: expected trace sequence was not found in captured trace lines.", file=sys.stderr)
        print("--- expected ---", file=sys.stderr)
        print("\n".join(expected_trace_lines), file=sys.stderr)
        print("--- actual trace lines ---", file=sys.stderr)
        print("\n".join(actual_trace_lines), file=sys.stderr)
        raise SystemExit(1)

    print("OK: baseline boot banner and trace sequence verified.")


if __name__ == "__main__":
    main()
