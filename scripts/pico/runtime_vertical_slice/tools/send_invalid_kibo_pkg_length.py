# pyright: reportMissingImports=false
"""
Responsibility: send an intentionally invalid `KIBO_PKG` frame (byte length mismatch) and verify `kibo_pkg_ack status=error`.

Example:

    python scripts/pico/runtime_vertical_slice/tools/send_invalid_kibo_pkg_length.py --port COM11
"""

from __future__ import annotations

import argparse
import sys
import time


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Send invalid KIBO_PKG frame (length mismatch) to Pico.")
    parser.add_argument("--port", required=True, help="Serial port, e.g. COM11.")
    parser.add_argument("--baud-rate", type=int, default=115200, help="Serial baud rate (default: 115200).")
    return parser.parse_args(argv)


def main() -> None:
    try:
        import serial  # type: ignore[import-untyped]
    except ImportError as import_error:
        print("pyserial is required.", file=sys.stderr)
        raise SystemExit(2) from import_error

    arguments = parse_arguments_or_exit(sys.argv[1:])
    # Guard: bytes count does not match decoded payload length.
    corrupted_line_text = "KIBO_PKG schema=1 bytes=9999 crc32=00000000 b64=eyJ9\n"

    serial_port = serial.Serial(port=arguments.port, baudrate=arguments.baud_rate, timeout=0.05)
    try:
        serial_port.reset_input_buffer()
        serial_port.write(corrupted_line_text.encode("ascii"))
        serial_port.flush()

        deadline = time.monotonic() + 3.0
        ack_lines: list[str] = []
        while time.monotonic() < deadline:
            if serial_port.in_waiting > 0:
                raw = serial_port.readline()
                if raw:
                    text = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                    ack_lines.append(text)
                    if "kibo_pkg_ack" in text:
                        break
            time.sleep(0.02)
    finally:
        serial_port.close()

    if not any(line.startswith("kibo_pkg_ack") and "status=error" in line for line in ack_lines):
        print("FAIL: expected kibo_pkg_ack with status=error for length mismatch.", file=sys.stderr)
        print("\n".join(ack_lines), file=sys.stderr)
        raise SystemExit(1)

    print("OK: device rejected invalid length as expected.")


if __name__ == "__main__":
    main()
