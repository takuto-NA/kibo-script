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
from pathlib import Path

import pico_link_common as common


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
        default=common.KIBO_USB_SERIAL_BAUD_RATE,
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
    serial_module = common.try_import_pyserial_serial_module_or_exit()
    serial_port = common.open_serial_port_for_kibo_vertical_slice_or_raise(
        serial_module=serial_module,
        port_path=port_path,
        baud_rate=baud_rate,
        read_timeout_seconds=0.1,
        write_timeout_seconds=common.DEFAULT_SERIAL_WRITE_TIMEOUT_SECONDS,
    )
    try:
        return common.read_serial_lines_for_seconds(serial_port=serial_port, capture_seconds=float(capture_seconds))
    finally:
        serial_port.close()


def main() -> None:
    arguments = parse_arguments_or_exit(sys.argv[1:])
    expected_text = arguments.expected_trace_file.read_text(encoding="utf-8")
    expected_trace_lines = common.extract_trace_lines_from_serial_lines(common.split_non_empty_lines_from_text(expected_text))

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

    if not any(common.line_contains_vertical_slice_boot_banner(line) for line in captured_lines):
        print("FAIL: did not find kibo_pico_vertical_slice_boot in captured serial output.", file=sys.stderr)
        print("--- captured (first 40 lines) ---", file=sys.stderr)
        for line in captured_lines[:40]:
            print(line, file=sys.stderr)
        raise SystemExit(1)

    actual_trace_lines = common.extract_trace_lines_from_serial_lines(captured_lines)
    if not common.contains_expected_trace_sequence(actual_trace_lines=actual_trace_lines, expected_trace_lines=expected_trace_lines):
        print("FAIL: expected trace sequence was not found in captured trace lines.", file=sys.stderr)
        print("--- expected ---", file=sys.stderr)
        print("\n".join(expected_trace_lines), file=sys.stderr)
        print("--- actual trace lines ---", file=sys.stderr)
        print("\n".join(actual_trace_lines), file=sys.stderr)
        raise SystemExit(1)

    print("OK: baseline boot banner and trace sequence verified.")


if __name__ == "__main__":
    main()
