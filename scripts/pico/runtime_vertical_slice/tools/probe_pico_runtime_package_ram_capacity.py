# pyright: reportMissingImports=false
"""
Responsibility: upload one or more `PicoRuntimePackage` JSON blobs via Kibo Device Protocol v1, capture `diag=ram_probe` trace lines, emit JSONL plus a markdown summary.

Guard: uses v1-only byte preflight (no legacy `KIBO_PKG` line-length reject) — see `pico_link_common.evaluate_pico_package_minified_utf8_byte_preflight_for_device_protocol_v1_or_raise`.

Example:

    python scripts/pico/runtime_vertical_slice/tools/probe_pico_runtime_package_ram_capacity.py --port COM11 --package-file tests/runtime-conformance/golden/pico-runtime-packages/blink-led.pico-runtime-package.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, cast

import pico_link_common as common
import pico_ram_probe_trace as ram_probe


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="RAM probe: v1 upload + capture diag=ram_probe lines.")
    parser.add_argument("--port", default="auto", help="Serial port, e.g. COM11, or `auto`.")
    parser.add_argument("--baud-rate", type=int, default=common.KIBO_USB_SERIAL_BAUD_RATE)
    parser.add_argument("--package-file", type=Path, action="append", default=[], help="PicoRuntimePackage JSON (repeatable).")
    parser.add_argument(
        "--padded-template-package-file",
        type=Path,
        default=None,
        help="Template JSON; with --padded-target-minified-bytes builds packages via ramProbePadding.",
    )
    parser.add_argument(
        "--padded-target-minified-bytes",
        type=int,
        action="append",
        default=[],
        help="Target minified UTF-8 byte counts (repeatable; paired with padded-template).",
    )
    parser.add_argument(
        "--experiment-max-minified-bytes",
        type=int,
        default=None,
        help=(
            "Optional v1 decode byte limit for this run (RAM experiments). Must match firmware "
            "`-DKIBO_PICO_RUNTIME_PACKAGE_MAX_MINIFIED_UTF8_BYTES`. Production default remains "
            f"{common.KIBO_PRODUCTION_DEFAULT_MAX_MINIFIED_UTF8_BYTES} when omitted."
        ),
    )
    parser.add_argument("--chunk-utf8-bytes", type=int, default=768)
    parser.add_argument("--inter-frame-sleep-seconds", type=float, default=0.02)
    parser.add_argument("--response-read-seconds", type=float, default=8.0)
    parser.add_argument("--jsonl-out", type=Path, default=None, help="Append one JSON object per upload (JSONL).")
    parser.add_argument(
        "--recovery-package-file",
        type=Path,
        default=None,
        help="After each upload, optionally re-send this package via v1 to restore a known-good state.",
    )
    parser.add_argument(
        "--expect-ack-ok",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="When true, require kibo_pkg_ack status=ok after each run_package.",
    )
    parser.add_argument(
        "--verify-expected-trace-file",
        type=Path,
        default=None,
        help="After each successful upload, assert golden conformance trace subsequence (ram_probe lines ignored).",
    )
    parser.add_argument(
        "--strict-ram-probe-phases",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="When true, exit non-zero if any expected ram_probe phase is missing after an upload.",
    )
    parser.add_argument(
        "--device-oversized-file-reject-then-recovery",
        action="store_true",
        help="After normal jobs: upload minified bytes = decode_limit+1 without host byte preflight; expect no ack ok; then require --recovery-package-file upload ok.",
    )
    return parser.parse_args(argv)


def build_upload_jobs_from_arguments_or_exit(*, arguments: argparse.Namespace) -> list[tuple[str, bytes]]:
    experiment_decode_limit = arguments.experiment_max_minified_bytes
    if experiment_decode_limit is not None:
        if experiment_decode_limit < 1024:
            print("FAIL: --experiment-max-minified-bytes must be >= 1024.", file=sys.stderr)
            raise SystemExit(2)
        if experiment_decode_limit > common.KIBO_EXPERIMENT_DECODE_LIMIT_BYTE_COUNT_HARD_MAXIMUM:
            print("FAIL: --experiment-max-minified-bytes exceeds hard maximum.", file=sys.stderr)
            raise SystemExit(2)

    jobs: list[tuple[str, bytes]] = []
    for path in arguments.package_file:
        text = path.read_text(encoding="utf-8")
        obj = json.loads(text)
        minified = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        jobs.append((str(path), minified))

    if arguments.padded_template_package_file is not None:
        if len(arguments.padded_target_minified_bytes) == 0:
            print("FAIL: --padded-target-minified-bytes required when --padded-template-package-file is set.", file=sys.stderr)
            raise SystemExit(2)
        template_text = arguments.padded_template_package_file.read_text(encoding="utf-8")
        template_object = json.loads(template_text)
        for target in arguments.padded_target_minified_bytes:
            label = f"padded:{arguments.padded_template_package_file}:{target}b"
            padded_bytes = common.build_minified_pico_runtime_package_utf8_bytes_with_ram_probe_padding_target_length_or_raise(
                template_package_object=template_object,
                target_minified_utf8_byte_count=int(target),
                device_protocol_v1_minified_utf8_byte_limit=experiment_decode_limit,
            )
            jobs.append((label, padded_bytes))

    if len(jobs) == 0:
        print("FAIL: pass --package-file and/or padded template targets.", file=sys.stderr)
        raise SystemExit(2)
    return jobs


def format_ram_probe_markdown_table(samples: list[ram_probe.RamProbeTraceSample]) -> str:
    lines = [
        "| phase | free_heap | used_heap | total_heap | min_free_heap |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for sample in samples:
        lines.append(
            f"| `{sample.phase}` | {sample.free_heap} | {sample.used_heap} | {sample.total_heap} | {sample.min_free_heap} |"
        )
    return "\n".join(lines)


def main() -> None:
    serial_module = common.try_import_pyserial_serial_module_or_exit()
    arguments = parse_arguments_or_exit(sys.argv[1:])
    jobs = build_upload_jobs_from_arguments_or_exit(arguments=arguments)
    experiment_decode_limit = arguments.experiment_max_minified_bytes

    port_path = common.resolve_serial_port_path_for_vertical_slice_or_exit(port_argument=arguments.port)
    serial_port = common.open_serial_port_for_kibo_vertical_slice_or_raise(
        serial_module=serial_module,
        port_path=port_path,
        baud_rate=arguments.baud_rate,
        read_timeout_seconds=common.DEFAULT_SERIAL_READ_TIMEOUT_SECONDS,
        write_timeout_seconds=common.DEFAULT_SERIAL_WRITE_TIMEOUT_SECONDS,
    )

    jsonl_handle = None
    if arguments.jsonl_out is not None:
        arguments.jsonl_out.parent.mkdir(parents=True, exist_ok=True)
        jsonl_handle = arguments.jsonl_out.open("a", encoding="utf-8")

    recovery_minified: bytes | None = None
    recovery_template_object: dict[str, Any] | None = None
    if arguments.recovery_package_file is not None:
        recovery_text = arguments.recovery_package_file.read_text(encoding="utf-8")
        recovery_obj = json.loads(recovery_text)
        recovery_template_object = cast(dict[str, Any], recovery_obj)
        recovery_minified = json.dumps(recovery_obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        common.evaluate_pico_package_minified_utf8_byte_preflight_for_device_protocol_v1_or_raise(
            minified_utf8_bytes=recovery_minified,
        )

    expected_trace_lines_for_verify: list[str] | None = None
    if arguments.verify_expected_trace_file is not None:
        expected_text = arguments.verify_expected_trace_file.read_text(encoding="utf-8")
        expected_trace_lines_for_verify = common.extract_trace_lines_from_serial_lines(
            common.split_non_empty_lines_from_text(expected_text),
        )

    all_tables: list[str] = []

    try:
        preflight = common.run_loader_preflight_on_open_serial_port(serial_port=serial_port)
        if preflight.loader_protocol_version != 1:
            print("FAIL: KIBO_PING loader handshake missing or unsupported.", file=sys.stderr)
            raise SystemExit(1)

        for label, minified_utf8_bytes in jobs:
            preflight_limit = experiment_decode_limit if label.startswith("padded:") else None
            common.evaluate_pico_package_minified_utf8_byte_preflight_for_device_protocol_v1_or_raise(
                minified_utf8_bytes=minified_utf8_bytes,
                device_protocol_v1_minified_utf8_byte_limit=preflight_limit,
            )

            serial_port.reset_input_buffer()
            serial_port.reset_output_buffer()
            time.sleep(0.05)

            captured_lines = common.upload_minified_pico_runtime_package_utf8_via_device_protocol_v1_and_collect_serial_lines_or_raise(
                serial_port=serial_port,
                minified_utf8_bytes=minified_utf8_bytes,
                chunk_utf8_bytes=arguments.chunk_utf8_bytes,
                inter_frame_sleep_seconds=arguments.inter_frame_sleep_seconds,
                capture_after_run_seconds=arguments.response_read_seconds,
            )

            ack_line = common.find_first_kibo_pkg_ack_line(captured_lines)
            ram_samples = ram_probe.extract_ram_probe_trace_samples_from_serial_lines(serial_lines=captured_lines)

            record = {
                "label": label,
                "minifiedUtf8ByteCount": len(minified_utf8_bytes),
                "kiboPkgAckLine": ack_line,
                "ramProbeSamples": [sample.__dict__ for sample in ram_samples],
            }
            json_line = json.dumps(record, ensure_ascii=False)
            print(json_line)
            if jsonl_handle is not None:
                jsonl_handle.write(json_line + "\n")
                jsonl_handle.flush()

            if arguments.expect_ack_ok:
                if ack_line is None or "status=ok" not in ack_line:
                    print("FAIL: expected kibo_pkg_ack status=ok.", file=sys.stderr)
                    for tail_line in captured_lines[-40:]:
                        print(tail_line, file=sys.stderr)
                    raise SystemExit(1)

            expected_phases = (
                "v1_file_begin_after_buffer_reserved",
                "v1_file_commit_after_staged_bytes",
                "commit_before_json_parse",
                "commit_after_json_parse",
                "commit_after_schema_validation",
                "commit_after_dry_run_replay_ok",
                "commit_after_active_package_assigned",
                "commit_after_emit_trace_replay",
                "commit_after_live_runtime_reset",
            )
            phases_found = {sample.phase for sample in ram_samples}
            missing = [phase for phase in expected_phases if phase not in phases_found]
            if len(missing) > 0:
                message = f"missing expected ram_probe phases: {missing}"
                if arguments.strict_ram_probe_phases:
                    print(f"FAIL: {message}", file=sys.stderr)
                    raise SystemExit(1)
                print(f"WARN: {message}", file=sys.stderr)

            if expected_trace_lines_for_verify is not None and arguments.expect_ack_ok:
                actual_filtered = common.extract_conformance_trace_lines_from_serial_lines_excluding_ram_probe_diagnostics(
                    captured_lines,
                )
                if not common.contains_expected_trace_sequence(
                    actual_trace_lines=actual_filtered,
                    expected_trace_lines=expected_trace_lines_for_verify,
                ):
                    print("FAIL: golden conformance trace sequence not found after upload (see stderr tail).", file=sys.stderr)
                    print("--- expected trace lines ---", file=sys.stderr)
                    print("\n".join(expected_trace_lines_for_verify), file=sys.stderr)
                    print("--- actual (ram_probe stripped) ---", file=sys.stderr)
                    print("\n".join(actual_filtered), file=sys.stderr)
                    raise SystemExit(1)

            all_tables.append(f"## {label} ({len(minified_utf8_bytes)} bytes)\n\n{format_ram_probe_markdown_table(ram_samples)}")

            if recovery_minified is not None:
                serial_port.reset_input_buffer()
                serial_port.reset_output_buffer()
                time.sleep(0.05)
                recovery_lines = common.upload_minified_pico_runtime_package_utf8_via_device_protocol_v1_and_collect_serial_lines_or_raise(
                    serial_port=serial_port,
                    minified_utf8_bytes=recovery_minified,
                    chunk_utf8_bytes=arguments.chunk_utf8_bytes,
                    inter_frame_sleep_seconds=arguments.inter_frame_sleep_seconds,
                    capture_after_run_seconds=arguments.response_read_seconds,
                )
                recovery_ack = common.find_first_kibo_pkg_ack_line(recovery_lines)
                if recovery_ack is None or "status=ok" not in recovery_ack:
                    print("FAIL: recovery package did not ack ok.", file=sys.stderr)
                    raise SystemExit(1)

        if arguments.device_oversized_file_reject_then_recovery:
            if recovery_template_object is None or recovery_minified is None:
                print(
                    "FAIL: --recovery-package-file is required for --device-oversized-file-reject-then-recovery.",
                    file=sys.stderr,
                )
                raise SystemExit(2)
            oversized_bytes = common.build_minified_utf8_one_byte_over_firmware_decode_limit_from_template_or_raise(
                template_package_object=recovery_template_object,
                device_protocol_v1_minified_utf8_byte_limit=experiment_decode_limit,
            )
            serial_port.reset_input_buffer()
            serial_port.reset_output_buffer()
            time.sleep(0.05)
            reject_capture_lines = common.upload_minified_pico_runtime_package_utf8_via_device_protocol_v1_and_collect_serial_lines_or_raise(
                serial_port=serial_port,
                minified_utf8_bytes=oversized_bytes,
                chunk_utf8_bytes=arguments.chunk_utf8_bytes,
                inter_frame_sleep_seconds=arguments.inter_frame_sleep_seconds,
                capture_after_run_seconds=arguments.response_read_seconds,
            )
            reject_ack = common.find_first_kibo_pkg_ack_line(reject_capture_lines)
            if reject_ack is not None and "status=ok" in reject_ack:
                print(f"FAIL: oversized package unexpectedly acked ok: {reject_ack}", file=sys.stderr)
                raise SystemExit(1)
            serial_port.reset_input_buffer()
            serial_port.reset_output_buffer()
            time.sleep(0.05)
            post_reject_recovery_lines = common.upload_minified_pico_runtime_package_utf8_via_device_protocol_v1_and_collect_serial_lines_or_raise(
                serial_port=serial_port,
                minified_utf8_bytes=recovery_minified,
                chunk_utf8_bytes=arguments.chunk_utf8_bytes,
                inter_frame_sleep_seconds=arguments.inter_frame_sleep_seconds,
                capture_after_run_seconds=arguments.response_read_seconds,
            )
            post_ack = common.find_first_kibo_pkg_ack_line(post_reject_recovery_lines)
            if post_ack is None or "status=ok" not in post_ack:
                print("FAIL: recovery after oversized reject did not ack ok.", file=sys.stderr)
                raise SystemExit(1)

        print("")
        print("--- ram_probe markdown summary ---")
        for block in all_tables:
            print(block)
            print("")
        print("--- end summary ---")
        print("OK: ram capacity probe completed.")
    finally:
        serial_port.close()
        if jsonl_handle is not None:
            jsonl_handle.close()


if __name__ == "__main__":
    main()
