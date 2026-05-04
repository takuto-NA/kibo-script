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
import json
import sys
import time
from pathlib import Path

import pico_link_common as common


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload PicoRuntimePackage JSON to Pico over USB serial.")
    parser.add_argument(
        "--port",
        default="auto",
        help="Serial port, e.g. COM11, or `auto` to pick a likely Pico CDC port.",
    )
    parser.add_argument(
        "--baud-rate",
        type=int,
        default=common.KIBO_USB_SERIAL_BAUD_RATE,
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
    parser.add_argument(
        "--no-preflight",
        action="store_true",
        help="Skip KIBO_PING loader handshake preflight (debug only).",
    )
    parser.add_argument(
        "--post-upload-trace-capture-seconds",
        type=float,
        default=0.0,
        help="If >0, capture USB serial for this many seconds after ack and print the last N trace lines.",
    )
    parser.add_argument(
        "--post-upload-trace-line-limit",
        type=int,
        default=12,
        help="Max `trace ` lines to print when --post-upload-trace-capture-seconds > 0.",
    )
    return parser.parse_args(argv)


def main() -> None:
    serial_module = common.try_import_pyserial_serial_module_or_exit()
    arguments = parse_arguments_or_exit(sys.argv[1:])

    package_text = arguments.package_file.read_text(encoding="utf-8")
    package_object = json.loads(package_text)
    minified_utf8_bytes = json.dumps(package_object, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    frame_line_text = common.build_kibo_pkg_serial_line_from_utf8_json_bytes(minified_utf8_bytes)

    port_path = common.resolve_serial_port_path_for_vertical_slice_or_exit(port_argument=arguments.port)

    try:
        serial_port = common.open_serial_port_for_kibo_vertical_slice_or_raise(
            serial_module=serial_module,
            port_path=port_path,
            baud_rate=arguments.baud_rate,
            read_timeout_seconds=common.DEFAULT_SERIAL_READ_TIMEOUT_SECONDS,
            write_timeout_seconds=common.DEFAULT_SERIAL_WRITE_TIMEOUT_SECONDS,
        )
    except PermissionError as permission_error:
        print(f"FAIL: PermissionError opening serial port: {permission_error}", file=sys.stderr)
        print(common.format_permission_error_hint_for_serial_port(port_path=port_path), file=sys.stderr)
        raise SystemExit(1) from permission_error
    except OSError as os_error:
        print(f"FAIL: could not open serial port: {os_error}", file=sys.stderr)
        raise SystemExit(1) from os_error

    try:
        if not arguments.no_preflight:
            preflight = common.run_loader_preflight_on_open_serial_port(serial_port=serial_port)
            if preflight.loader_protocol_version != 1:
                print("FAIL: loader firmware handshake missing or unsupported.", file=sys.stderr)
                print("Captured lines after KIBO_PING (last 40):", file=sys.stderr)
                for line in preflight.captured_lines[-40:]:
                    print(line, file=sys.stderr)
                print("", file=sys.stderr)
                print("Next:", file=sys.stderr)
                print("  - Flash latest firmware.uf2 via BOOTSEL: python .../install_pico_loader.py", file=sys.stderr)
                print("  - Close other serial monitors / stuck uploaders that may hold the port.", file=sys.stderr)
                raise SystemExit(1)

        serial_port.reset_input_buffer()
        serial_port.reset_output_buffer()

        try:
            serial_port.write(frame_line_text.encode("ascii"))
            serial_port.flush()
        except Exception as exception:  # noqa: BLE001 - serial raises multiple timeout types across versions
            message = str(exception)
            print(f"FAIL: serial write failed: {message}", file=sys.stderr)
            print("Hints:", file=sys.stderr)
            print("  - Old firmware may ignore long lines and appear as a write timeout.", file=sys.stderr)
            print("  - Try loader install + doctor preflight.", file=sys.stderr)
            raise SystemExit(1) from exception

        deadline = time.monotonic() + arguments.ack_timeout_seconds
        captured_lines = common.read_serial_lines_until_deadline(serial_port=serial_port, deadline_monotonic=deadline)
    finally:
        serial_port.close()

    ack_line = common.find_first_kibo_pkg_ack_line(captured_lines)
    if ack_line is None:
        print("FAIL: did not receive kibo_pkg_ack within timeout.", file=sys.stderr)
        print("Captured lines (last 40):", file=sys.stderr)
        for line in captured_lines[-40:]:
            print(line, file=sys.stderr)
        print("", file=sys.stderr)
        print("Hints:", file=sys.stderr)
        print("  - If you see boot banner but no ack: package validation failed on device (check CRC/base64).", file=sys.stderr)
        print("  - If output looks like an older firmware: flash loader firmware.", file=sys.stderr)
        raise SystemExit(1)

    print(ack_line)
    if "status=ok" not in ack_line:
        raise SystemExit(1)

    if arguments.post_upload_trace_capture_seconds > 0.0:
        serial_port_second = common.open_serial_port_for_kibo_vertical_slice_or_raise(
            serial_module=serial_module,
            port_path=port_path,
            baud_rate=arguments.baud_rate,
            read_timeout_seconds=common.DEFAULT_SERIAL_READ_TIMEOUT_SECONDS,
            write_timeout_seconds=common.DEFAULT_SERIAL_WRITE_TIMEOUT_SECONDS,
        )
        try:
            extra_lines = common.read_serial_lines_for_seconds(
                serial_port=serial_port_second,
                capture_seconds=arguments.post_upload_trace_capture_seconds,
            )
        finally:
            serial_port_second.close()
        trace_lines = common.extract_trace_lines_from_serial_lines(extra_lines)
        limit = max(1, int(arguments.post_upload_trace_line_limit))
        print("--- post-upload trace lines (most recent) ---")
        for line in trace_lines[-limit:]:
            print(line)


if __name__ == "__main__":
    main()
