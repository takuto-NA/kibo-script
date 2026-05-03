# 責務: Windows / Linux どちらでも動く「指定 COM ポートから一定時間 Serial を読み取って標準出力へ流す」小さな補助ツール。
#
# 注意:
# - PlatformIO の `device monitor` をジョブ化すると環境によって出力が取りこぼされることがあるため、pyserial で直接読む。
# - このファイルは Kibo Script の runtime ではなく、Pico bring-up / probe の作業補助である。

from __future__ import annotations

import argparse
import sys
import time

import serial

SERIAL_PORT_READ_TIMEOUT_SECONDS = 0.2


def parse_command_line_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read lines from a serial port for a fixed duration.")
    parser.add_argument("--port", required=True, help="Serial port name. Example: COM11")
    parser.add_argument("--baud", required=True, type=int, help="Serial baud rate. Example: 115200")
    parser.add_argument(
        "--seconds",
        required=True,
        type=float,
        help="How long to read before exiting. Example: 20",
    )
    return parser.parse_args()


def main() -> int:
    arguments = parse_command_line_arguments()

    read_end_time_seconds = time.time() + arguments.seconds

    with serial.Serial(arguments.port, arguments.baud, timeout=SERIAL_PORT_READ_TIMEOUT_SECONDS) as serial_port:
        serial_port.reset_input_buffer()

        while time.time() < read_end_time_seconds:
            received_line_bytes = serial_port.readline()
            if not received_line_bytes:
                continue

            sys.stdout.buffer.write(received_line_bytes)
            sys.stdout.buffer.flush()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
