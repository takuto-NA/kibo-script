# pyright: reportMissingImports=false
"""
Responsibility: upload minified `PicoRuntimePackage` JSON to Pico using **Kibo Device Protocol v1** chunked `file_*` + `run_package`
instead of the legacy one-line `KIBO_PKG` frame.

Guard: requires pyserial and firmware with v1 ingress (`runtime/pico/vertical_slice`).

Example:

    python scripts/pico/runtime_vertical_slice/tools/upload_pico_runtime_package_via_device_protocol_v1.py --port COM11 --package-file tests/runtime-conformance/golden/pico-runtime-packages/blink-led.pico-runtime-package.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import kibo_device_protocol_v1 as kdp
import pico_link_common as common


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload PicoRuntimePackage JSON via Kibo Device Protocol v1.")
    parser.add_argument("--port", default="auto", help="Serial port, e.g. COM11, or `auto`.")
    parser.add_argument("--baud-rate", type=int, default=common.KIBO_USB_SERIAL_BAUD_RATE)
    parser.add_argument("--package-file", type=Path, required=True, help="Path to PicoRuntimePackage JSON.")
    parser.add_argument(
        "--chunk-utf8-bytes",
        type=int,
        default=768,
        help="Raw UTF-8 bytes per FILE_CHUNK payload (before Base64).",
    )
    parser.add_argument(
        "--inter-frame-sleep-seconds",
        type=float,
        default=0.02,
        help="Sleep between binary frames to reduce USB CDC loss risk.",
    )
    parser.add_argument(
        "--response-read-seconds",
        type=float,
        default=6.0,
        help="After upload, read serial for this long to observe kibo_pkg_ack / trace.",
    )
    return parser.parse_args(argv)


def write_frame_and_sleep_or_raise(*, serial_port: object, frame_bytes: bytes, sleep_seconds: float) -> None:
    serial_port.write(frame_bytes)
    serial_port.flush()
    time.sleep(sleep_seconds)


def main() -> None:
    serial_module = common.try_import_pyserial_serial_module_or_exit()
    arguments = parse_arguments_or_exit(sys.argv[1:])

    package_text = arguments.package_file.read_text(encoding="utf-8")
    package_object = json.loads(package_text)
    minified_utf8_bytes = json.dumps(package_object, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    common.evaluate_pico_package_payload_preflight_or_raise(
        minified_utf8_bytes=minified_utf8_bytes,
        kibo_pkg_line_text_without_newline=common.build_kibo_pkg_serial_line_from_utf8_json_bytes(
            minified_utf8_bytes,
        ).rstrip("\n"),
    )

    port_path = common.resolve_serial_port_path_for_vertical_slice_or_exit(port_argument=arguments.port)

    serial_port = common.open_serial_port_for_kibo_vertical_slice_or_raise(
        serial_module=serial_module,
        port_path=port_path,
        baud_rate=arguments.baud_rate,
        read_timeout_seconds=common.DEFAULT_SERIAL_READ_TIMEOUT_SECONDS,
        write_timeout_seconds=common.DEFAULT_SERIAL_WRITE_TIMEOUT_SECONDS,
    )

    try:
        preflight = common.run_loader_preflight_on_open_serial_port(serial_port=serial_port)
        if preflight.loader_protocol_version != 1:
            print("FAIL: KIBO_PING loader handshake missing or unsupported.", file=sys.stderr)
            raise SystemExit(1)

        serial_port.reset_input_buffer()
        serial_port.reset_output_buffer()

        sequence_counter = 0

        def next_sequence() -> int:
            nonlocal sequence_counter
            sequence_counter += 1
            return sequence_counter

        hello_payload = json.dumps(
            {"hostProtocolVersion": 1, "hostName": "kibo-python-device-protocol-v1-uploader"},
            separators=(",", ":"),
        ).encode("utf-8")
        hello_frame = kdp.encode_kibo_device_protocol_v1_frame_or_raise(
            sequence=next_sequence(),
            request_id=1,
            message_kind=kdp.KiboDeviceProtocolV1MessageKind.HELLO,
            payload_utf8_bytes=hello_payload,
        )
        write_frame_and_sleep_or_raise(
            serial_port=serial_port,
            frame_bytes=hello_frame,
            sleep_seconds=arguments.inter_frame_sleep_seconds,
        )

        file_id = 1
        whole_crc = kdp.compute_crc32_hex8_lower_from_utf8_bytes(minified_utf8_bytes)
        begin_payload = kdp.build_json_utf8_payload_text_for_file_begin(
            file_id=file_id,
            kind="pico_runtime_package_json_minified_utf8",
            total_byte_length=len(minified_utf8_bytes),
            whole_payload_crc32_hex_lower=whole_crc,
        )
        begin_frame = kdp.encode_kibo_device_protocol_v1_frame_or_raise(
            sequence=next_sequence(),
            request_id=1,
            message_kind=kdp.KiboDeviceProtocolV1MessageKind.FILE_BEGIN,
            payload_utf8_bytes=begin_payload,
        )
        write_frame_and_sleep_or_raise(
            serial_port=serial_port,
            frame_bytes=begin_frame,
            sleep_seconds=arguments.inter_frame_sleep_seconds,
        )

        chunk_index = 0
        byte_offset = 0
        chunk_size = max(1, int(arguments.chunk_utf8_bytes))
        while byte_offset < len(minified_utf8_bytes):
            chunk_bytes = minified_utf8_bytes[byte_offset : byte_offset + chunk_size]
            chunk_crc = kdp.compute_crc32_hex8_lower_from_utf8_bytes(chunk_bytes)
            chunk_payload = kdp.build_json_utf8_payload_text_for_file_chunk(
                file_id=file_id,
                chunk_index=chunk_index,
                byte_offset=byte_offset,
                chunk_crc32_hex_lower=chunk_crc,
                chunk_payload_utf8_bytes=chunk_bytes,
            )
            chunk_frame = kdp.encode_kibo_device_protocol_v1_frame_or_raise(
                sequence=next_sequence(),
                request_id=1,
                message_kind=kdp.KiboDeviceProtocolV1MessageKind.FILE_CHUNK,
                payload_utf8_bytes=chunk_payload,
            )
            write_frame_and_sleep_or_raise(
                serial_port=serial_port,
                frame_bytes=chunk_frame,
                sleep_seconds=arguments.inter_frame_sleep_seconds,
            )
            byte_offset += len(chunk_bytes)
            chunk_index += 1

        commit_payload = kdp.build_json_utf8_payload_text_for_file_commit(file_id=file_id)
        commit_frame = kdp.encode_kibo_device_protocol_v1_frame_or_raise(
            sequence=next_sequence(),
            request_id=1,
            message_kind=kdp.KiboDeviceProtocolV1MessageKind.FILE_COMMIT,
            payload_utf8_bytes=commit_payload,
        )
        write_frame_and_sleep_or_raise(
            serial_port=serial_port,
            frame_bytes=commit_frame,
            sleep_seconds=arguments.inter_frame_sleep_seconds,
        )

        run_payload = kdp.build_json_utf8_payload_text_for_run_package()
        run_frame = kdp.encode_kibo_device_protocol_v1_frame_or_raise(
            sequence=next_sequence(),
            request_id=1,
            message_kind=kdp.KiboDeviceProtocolV1MessageKind.RUN_PACKAGE,
            payload_utf8_bytes=run_payload,
        )
        write_frame_and_sleep_or_raise(
            serial_port=serial_port,
            frame_bytes=run_frame,
            sleep_seconds=arguments.inter_frame_sleep_seconds,
        )

        captured = common.read_serial_lines_for_seconds(
            serial_port=serial_port,
            capture_seconds=arguments.response_read_seconds,
        )
        ack_line = common.find_first_kibo_pkg_ack_line(captured)
        if ack_line is None or "status=ok" not in ack_line:
            print("FAIL: expected kibo_pkg_ack status=ok after run_package.", file=sys.stderr)
            print("--- captured lines (tail 40) ---", file=sys.stderr)
            for line in captured[-40:]:
                print(line, file=sys.stderr)
            raise SystemExit(1)

        print("OK: device protocol v1 upload succeeded.")
        print(ack_line)
    finally:
        serial_port.close()


if __name__ == "__main__":
    main()
