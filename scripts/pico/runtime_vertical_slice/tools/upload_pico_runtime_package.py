# pyright: reportMissingImports=false
"""
Responsibility: send a `PicoRuntimePackage` JSON file to the Pico vertical slice firmware over USB Serial using the
`KIBO_PKG schema=1 bytes=<n> crc32=<hex> b64=<payload>` line protocol, then wait for `kibo_pkg_ack`.

Guard: requires pyserial. This is a developer tool, not part of the default npm test suite.

Example:

    python scripts/pico/runtime_vertical_slice/tools/upload_pico_runtime_package.py --port COM11 --package-file tests/runtime-conformance/golden/pico-runtime-packages/blink-led.pico-runtime-package.json
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import zlib
from pathlib import Path


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload PicoRuntimePackage JSON to Pico over USB serial.")
    parser.add_argument("--port", required=True, help="Serial port, e.g. COM11.")
    parser.add_argument(
        "--baud-rate",
        type=int,
        default=115200,
        help="Serial baud rate (default: 115200).",
    )
    parser.add_argument(
        "--package-file",
        type=Path,
        required=True,
        help="Path to PicoRuntimePackage JSON (pretty or minified).",
    )
    parser.add_argument(
        "--ack-timeout-seconds",
        type=float,
        default=5.0,
        help="How long to wait for kibo_pkg_ack after sending the frame.",
    )
    return parser.parse_args(argv)


def build_kibo_pkg_serial_line_from_utf8_json_bytes(json_utf8_bytes: bytes) -> str:
    crc32_value = zlib.crc32(json_utf8_bytes) & 0xFFFFFFFF
    crc32_hex_text = f"{crc32_value:08x}"
    base64_payload_text = base64.b64encode(json_utf8_bytes).decode("ascii")
    byte_count = len(json_utf8_bytes)
    return f"KIBO_PKG schema=1 bytes={byte_count} crc32={crc32_hex_text} b64={base64_payload_text}\n"


def read_serial_lines_until_deadline_or_empty(*, serial_port, deadline_monotonic: float) -> list[str]:
    lines: list[str] = []
    while time.monotonic() < deadline_monotonic:
        waiting_bytes_count = serial_port.in_waiting
        if waiting_bytes_count > 0:
            raw_line = serial_port.readline()
            if raw_line:
                lines.append(raw_line.decode("utf-8", errors="replace").rstrip("\r\n"))
            continue
        time.sleep(0.02)
    return lines


def find_first_kibo_pkg_ack_line(serial_lines: list[str]) -> str | None:
    for line in serial_lines:
        if line.startswith("kibo_pkg_ack"):
            return line
    return None


def main() -> None:
    try:
        import serial  # type: ignore[import-untyped]
    except ImportError as import_error:
        print("pyserial is required. Install with: uv pip install pyserial", file=sys.stderr)
        raise SystemExit(2) from import_error

    arguments = parse_arguments_or_exit(sys.argv[1:])
    package_text = arguments.package_file.read_text(encoding="utf-8")
    package_object = json.loads(package_text)
    minified_utf8_bytes = json.dumps(package_object, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    frame_line_text = build_kibo_pkg_serial_line_from_utf8_json_bytes(minified_utf8_bytes)

    serial_port = serial.Serial(
        port=arguments.port,
        baudrate=arguments.baud_rate,
        timeout=0.05,
        write_timeout=2.0,
    )
    try:
        serial_port.reset_input_buffer()
        serial_port.write(frame_line_text.encode("ascii"))
        serial_port.flush()

        deadline = time.monotonic() + arguments.ack_timeout_seconds
        captured_lines = read_serial_lines_until_deadline_or_empty(serial_port=serial_port, deadline_monotonic=deadline)
    finally:
        serial_port.close()

    ack_line = find_first_kibo_pkg_ack_line(captured_lines)
    if ack_line is None:
        print("FAIL: did not receive kibo_pkg_ack within timeout.", file=sys.stderr)
        print("--- captured lines ---", file=sys.stderr)
        for line in captured_lines[-40:]:
            print(line, file=sys.stderr)
        raise SystemExit(1)

    print(ack_line)
    if "status=ok" not in ack_line:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
