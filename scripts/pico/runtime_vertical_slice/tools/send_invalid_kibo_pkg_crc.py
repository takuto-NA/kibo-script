# pyright: reportMissingImports=false
"""
Responsibility: send a valid Base64 payload with a deliberately wrong declared CRC32 so the firmware returns `crc_mismatch`,
then optionally re-upload a known-good package to prove recovery.

Example:

    python scripts/pico/runtime_vertical_slice/tools/send_invalid_kibo_pkg_crc.py --port auto
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pico_link_common as common

NEGATIVE_GATE_ACK_TIMEOUT_SECONDS = 5.0
RECOVERY_PACKAGE_ACK_TIMEOUT_SECONDS = 8.0


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Send KIBO_PKG with crc32 mismatch (negative gate LOADER-PKG-CRC-001).")
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
        default=None,
        help="Valid PicoRuntimePackage JSON used as the Base64 payload (CRC field will be corrupted). Default: blink-led golden.",
    )
    parser.add_argument(
        "--recover-package-file",
        type=Path,
        default=None,
        help="If set, after the negative ack, upload this valid package to confirm recovery (default: blink-led golden).",
    )
    parser.add_argument(
        "--no-recover",
        action="store_true",
        help="Skip the recovery upload step.",
    )
    parser.add_argument(
        "--no-preflight",
        action="store_true",
        help="Skip KIBO_PING loader handshake preflight (debug only).",
    )
    return parser.parse_args(argv)


def flip_crc32_hex_to_different_valid_hex32(*, crc32_hex_text_lower: str) -> str:
    # Guard: XOR all bits so the line stays well-formed hex while being guaranteed unequal to the real CRC.
    as_int = int(crc32_hex_text_lower, 16)
    flipped = as_int ^ 0xFFFFFFFF
    return f"{flipped & 0xFFFFFFFF:08x}"


def main() -> None:
    serial_module = common.try_import_pyserial_serial_module_or_exit()
    arguments = parse_arguments_or_exit(sys.argv[1:])
    tools_file_path = Path(__file__)
    repository_root = common.resolve_repository_root_from_tools_file(tools_file_path=tools_file_path)
    recover_path = arguments.recover_package_file
    if not arguments.no_recover and recover_path is None:
        recover_path = common.resolve_default_blink_led_golden_pico_runtime_package_json_path_or_raise(
            repository_root=repository_root,
        )

    negative_package_path = arguments.package_file
    if negative_package_path is None:
        negative_package_path = common.resolve_default_blink_led_golden_pico_runtime_package_json_path_or_raise(
            repository_root=repository_root,
        )

    minified_negative_payload_bytes = common.read_minified_pico_runtime_package_utf8_bytes_from_json_path_or_raise(
        package_json_path=negative_package_path,
    )
    correct_crc_hex = common.compute_crc32_hex32_lower_from_bytes(payload_bytes=minified_negative_payload_bytes)
    wrong_crc_hex = flip_crc32_hex_to_different_valid_hex32(crc32_hex_text_lower=correct_crc_hex)
    corrupted_line_text = common.build_kibo_pkg_serial_line_from_utf8_json_bytes_with_crc32_hex_override(
        json_utf8_bytes=minified_negative_payload_bytes,
        crc32_hex_text_lower_eight=wrong_crc_hex,
    )

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
                raise SystemExit(1)

        deadline_negative = time.monotonic() + NEGATIVE_GATE_ACK_TIMEOUT_SECONDS
        negative_lines = common.send_kibo_pkg_line_and_collect_serial_lines_until_deadline_or_raise(
            serial_port=serial_port,
            kibo_pkg_line_text=corrupted_line_text,
            deadline_monotonic=deadline_negative,
        )
        negative_ack = common.find_first_kibo_pkg_ack_line(negative_lines)
        if negative_ack is None:
            print("FAIL: expected kibo_pkg_ack for CRC mismatch negative gate.", file=sys.stderr)
            raise SystemExit(1)
        print(negative_ack)
        if "status=error" not in negative_ack or "crc_mismatch" not in negative_ack:
            print("FAIL: expected kibo_pkg_ack status=error with crc_mismatch.", file=sys.stderr)
            raise SystemExit(1)

        if arguments.no_recover or recover_path is None:
            print("OK: crc_mismatch negative gate passed (recovery skipped).")
            return

        minified_recovery_bytes = common.read_minified_pico_runtime_package_utf8_bytes_from_json_path_or_raise(
            package_json_path=recover_path,
        )
        recovery_ack = common.send_minified_kibo_pkg_from_utf8_json_bytes_and_expect_pkg_ack_substring_or_raise(
            serial_port=serial_port,
            minified_package_utf8_bytes=minified_recovery_bytes,
            ack_timeout_seconds=RECOVERY_PACKAGE_ACK_TIMEOUT_SECONDS,
            expected_ack_substring="status=ok",
        )
        print(recovery_ack)
        print("OK: crc_mismatch negative gate passed and recovery upload acked ok.")
    finally:
        serial_port.close()


if __name__ == "__main__":
    main()
