# pyright: reportMissingImports=false
"""
Responsibility: send intentionally malformed `KIBO_PKG` frames for Base64 / JSON / schema negative gates, then optionally
re-upload a known-good package to prove recovery.

Example:

    python scripts/pico/runtime_vertical_slice/tools/send_invalid_kibo_pkg_frame.py --port auto --kind invalid_base64
    python scripts/pico/runtime_vertical_slice/tools/send_invalid_kibo_pkg_frame.py --port auto --kind invalid_json_utf8
    python scripts/pico/runtime_vertical_slice/tools/send_invalid_kibo_pkg_frame.py --port auto --kind unsupported_schema
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from pathlib import Path
from typing import Literal

import pico_link_common as common

NegativeFrameKind = Literal["invalid_base64", "invalid_json_utf8", "unsupported_schema"]

NEGATIVE_GATE_ACK_TIMEOUT_SECONDS = 5.0
RECOVERY_PACKAGE_ACK_TIMEOUT_SECONDS = 8.0


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Send malformed KIBO_PKG frames (B64 / JSON / schema negative gates).")
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
        "--kind",
        required=True,
        choices=["invalid_base64", "invalid_json_utf8", "unsupported_schema"],
        help="Which negative gate payload to send.",
    )
    parser.add_argument(
        "--package-file",
        type=Path,
        help="Required for `invalid_json_utf8` and `unsupported_schema` (template package on disk).",
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


def build_negative_kibo_pkg_line_text_or_raise(*, kind: NegativeFrameKind, package_file_path: Path | None) -> str:
    if kind == "invalid_base64":
        # Guard: Base64 length is not a multiple of 4 after whitespace strip, so firmware decode returns empty.
        return "KIBO_PKG schema=1 bytes=1 crc32=00000000 b64=!!!\n"

    if package_file_path is None:
        raise ValueError("--package-file is required for this --kind.")

    if kind == "invalid_json_utf8":
        # Guard: decoded bytes length matches declared bytes=, UTF-8 is valid, but JSON.parse fails on device.
        invalid_json_utf8_bytes = b'{"invalidJsonGate":"'
        crc_hex = common.compute_crc32_hex32_lower_from_bytes(payload_bytes=invalid_json_utf8_bytes)
        b64_text = base64.b64encode(invalid_json_utf8_bytes).decode("ascii")
        byte_count = len(invalid_json_utf8_bytes)
        return f"KIBO_PKG schema=1 bytes={byte_count} crc32={crc_hex} b64={b64_text}\n"

    if kind == "unsupported_schema":
        template_text = package_file_path.read_text(encoding="utf-8")
        package_object = json.loads(template_text)
        package_object["packageSchemaVersion"] = 2
        minified_bytes = json.dumps(package_object, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        return common.build_kibo_pkg_serial_line_from_utf8_json_bytes(minified_bytes)

    raise ValueError(f"Unsupported --kind: {kind}")


def expected_ack_substrings_for_kind(*, kind: NegativeFrameKind) -> tuple[str, str]:
    if kind == "invalid_base64":
        return ("status=error", "base64_decode_failed")
    if kind == "invalid_json_utf8":
        return ("status=error", "json_parse_failed")
    if kind == "unsupported_schema":
        return ("status=error", "unsupported_package_schema_version")
    raise ValueError(f"Unsupported --kind: {kind}")


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

    kind: NegativeFrameKind = arguments.kind
    effective_package_file_path = arguments.package_file
    if kind in ("invalid_json_utf8", "unsupported_schema") and effective_package_file_path is None:
        effective_package_file_path = common.resolve_default_blink_led_golden_pico_runtime_package_json_path_or_raise(
            repository_root=repository_root,
        )

    negative_line_text = build_negative_kibo_pkg_line_text_or_raise(
        kind=kind,
        package_file_path=effective_package_file_path,
    )
    expected_status, expected_reason = expected_ack_substrings_for_kind(kind=kind)

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
            kibo_pkg_line_text=negative_line_text,
            deadline_monotonic=deadline_negative,
        )
        negative_ack = common.find_first_kibo_pkg_ack_line(negative_lines)
        if negative_ack is None:
            print("FAIL: expected kibo_pkg_ack for malformed frame negative gate.", file=sys.stderr)
            raise SystemExit(1)
        print(negative_ack)
        if expected_status not in negative_ack or expected_reason not in negative_ack:
            print(
                f"FAIL: expected kibo_pkg_ack containing {expected_status} and {expected_reason}.",
                file=sys.stderr,
            )
            raise SystemExit(1)

        if arguments.no_recover or recover_path is None:
            print(f"OK: {kind} negative gate passed (recovery skipped).")
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
        print(f"OK: {kind} negative gate passed and recovery upload acked ok.")
    finally:
        serial_port.close()


if __name__ == "__main__":
    main()
