# pyright: reportMissingImports=false
"""
Responsibility: send a minified JSON package whose UTF-8 byte length exceeds the firmware decode cap (`package_too_large`),
then optionally re-upload a known-good smaller package to prove recovery.

Guard: 現行 1 行 `KIBO_PKG` では、decode 上限を超える payload の Base64 化が **シリアル 1 行上限**
を超える場合もあるため、実機では `kibo_pkg_ack ... package_too_large` ではなく `trace ... diag=serial_line_too_long` が出ることがある。
いずれも「巨大 package を拒否し active を壊さない」negative として扱う（詳細は docs/pico-loader-protocol-gates.md）。

Example:

    python scripts/pico/runtime_vertical_slice/tools/send_oversized_kibo_pkg.py --port auto
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import pico_link_common as common

NEGATIVE_GATE_ACK_TIMEOUT_SECONDS = 8.0
RECOVERY_PACKAGE_ACK_TIMEOUT_SECONDS = 8.0
OVERSIZED_TARGET_MIN_DECODED_BYTES = common.KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES + 256


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Send oversized KIBO_PKG (negative gate LOADER-PKG-SIZE-001).")
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
        "--template-package-file",
        type=Path,
        default=None,
        help="Valid PicoRuntimePackage JSON used as a structural template (padding is injected). Default: blink-led golden.",
    )
    parser.add_argument(
        "--recover-package-file",
        type=Path,
        default=None,
        help="If set, after the negative ack, upload this valid package (default: blink-led golden).",
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


def negative_oversized_gate_passed_from_serial_lines(*, serial_lines: list[str]) -> bool:
    # Guard: accept either true decode rejection or serial line buffer rejection (see module docstring).
    for line in serial_lines:
        if line.startswith("kibo_pkg_ack") and "status=error" in line and "package_too_large" in line:
            return True
        if "diag=serial_line_too_long" in line:
            return True
    return False


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

    template_path = arguments.template_package_file
    if template_path is None:
        template_path = common.resolve_default_blink_led_golden_pico_runtime_package_json_path_or_raise(
            repository_root=repository_root,
        )

    template_text = template_path.read_text(encoding="utf-8")
    template_object = json.loads(template_text)
    oversized_minified_bytes = common.build_oversized_minified_package_utf8_bytes_from_template_object_or_raise(
        template_package_object=template_object,
        minimum_decoded_byte_count=OVERSIZED_TARGET_MIN_DECODED_BYTES,
    )
    oversized_line_text = common.build_kibo_pkg_serial_line_from_utf8_json_bytes(oversized_minified_bytes)
    line_character_count = common.count_kibo_pkg_serial_line_characters_excluding_final_newline(
        kibo_pkg_line_text=oversized_line_text,
    )
    if line_character_count > common.KIBO_FIRMWARE_MAX_SERIAL_LINE_CHARACTERS:
        print(
            f"NOTE: KIBO_PKG line is {line_character_count} characters "
            f"(firmware max single line: {common.KIBO_FIRMWARE_MAX_SERIAL_LINE_CHARACTERS}). "
            "Expect `diag=serial_line_too_long` rather than `package_too_large` on current framing.",
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
            kibo_pkg_line_text=oversized_line_text,
            deadline_monotonic=deadline_negative,
        )
        negative_ack = common.find_first_kibo_pkg_ack_line(negative_lines)
        if negative_ack is not None:
            print(negative_ack)

        if not negative_oversized_gate_passed_from_serial_lines(serial_lines=negative_lines):
            print("FAIL: expected package_too_large ack or serial_line_too_long diagnostic.", file=sys.stderr)
            print("Captured lines (last 40):", file=sys.stderr)
            for line in negative_lines[-40:]:
                print(line, file=sys.stderr)
            raise SystemExit(1)

        if arguments.no_recover or recover_path is None:
            print("OK: oversized / over-long-line negative gate passed (recovery skipped).")
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
        print("OK: oversized / over-long-line negative gate passed and recovery upload acked ok.")
    finally:
        serial_port.close()


if __name__ == "__main__":
    main()
