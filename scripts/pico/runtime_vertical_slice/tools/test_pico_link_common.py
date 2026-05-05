# pyright: reportMissingImports=false
"""
Responsibility: lightweight unit tests for `pico_link_common` (no hardware, no pyserial required for pure helpers).

Run (from repository root, same as CI / `npm test`):

    npm run test:pico-link-tools

Or:

    python -m unittest discover -s scripts/pico/runtime_vertical_slice/tools -p "test_*.py"
"""

from __future__ import annotations

import contextlib
import io
import json
import unittest
from pathlib import Path

import pico_link_common as common


class PicoLinkCommonPureHelpersTest(unittest.TestCase):
    def test_split_non_empty_lines_from_text_normalizes_crlf(self) -> None:
        text = "a\r\n\r\nb\n"
        self.assertEqual(common.split_non_empty_lines_from_text(text), ["a", "b"])

    def test_contains_expected_trace_sequence_finds_subsequence(self) -> None:
        actual = ["x", "trace a", "trace b", "y"]
        expected = ["trace a", "trace b"]
        self.assertTrue(
            common.contains_expected_trace_sequence(actual_trace_lines=actual, expected_trace_lines=expected),
        )

    def test_parse_loader_protocol_version(self) -> None:
        line = "kibo_loader status=ok protocol=1 active=circle-animation"
        self.assertEqual(common.parse_loader_protocol_version_from_loader_status_line(line), 1)

    def test_compute_crc32_hex_matches_embedded_token_in_kibo_pkg_line(self) -> None:
        payload_utf8_bytes = b'{"x":1}'
        line_text = common.build_kibo_pkg_serial_line_from_utf8_json_bytes(payload_utf8_bytes)
        expected_crc_hex = common.compute_crc32_hex32_lower_from_bytes(payload_bytes=payload_utf8_bytes)
        self.assertIn(f"bytes={len(payload_utf8_bytes)}", line_text)
        self.assertIn(f"crc32={expected_crc_hex}", line_text)

    def test_crc_override_line_contains_explicit_crc_hex(self) -> None:
        payload_utf8_bytes = b'{"x":1}'
        explicit_wrong_crc_hex = "aaaaaaaa"
        line_text = common.build_kibo_pkg_serial_line_from_utf8_json_bytes_with_crc32_hex_override(
            json_utf8_bytes=payload_utf8_bytes,
            crc32_hex_text_lower_eight=explicit_wrong_crc_hex,
        )
        self.assertIn(f"crc32={explicit_wrong_crc_hex}", line_text)
        correct_crc_hex = common.compute_crc32_hex32_lower_from_bytes(payload_bytes=payload_utf8_bytes)
        self.assertNotIn(f"crc32={correct_crc_hex}", line_text)

    def test_oversized_builder_exceeds_firmware_decode_cap(self) -> None:
        repository_root = Path(__file__).resolve().parents[4]
        blink_led_package_path = common.resolve_default_blink_led_golden_pico_runtime_package_json_path_or_raise(
            repository_root=repository_root,
        )
        template_object = json.loads(blink_led_package_path.read_text(encoding="utf-8"))
        oversized_utf8_bytes = common.build_oversized_minified_package_utf8_bytes_from_template_object_or_raise(
            template_package_object=template_object,
            minimum_decoded_byte_count=common.KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES + 1,
        )
        self.assertGreater(len(oversized_utf8_bytes), common.KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES)

    def test_oversized_builder_rejects_minimum_at_or_below_firmware_decode_cap(self) -> None:
        with self.assertRaises(ValueError):
            common.build_oversized_minified_package_utf8_bytes_from_template_object_or_raise(
                template_package_object={"packageSchemaVersion": 1},
                minimum_decoded_byte_count=common.KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES,
            )

    def test_oversized_utf8_that_exceeds_decode_cap_produces_kibo_pkg_line_over_serial_limit(self) -> None:
        repository_root = Path(__file__).resolve().parents[4]
        blink_led_package_path = common.resolve_default_blink_led_golden_pico_runtime_package_json_path_or_raise(
            repository_root=repository_root,
        )
        template_object = json.loads(blink_led_package_path.read_text(encoding="utf-8"))
        oversized_utf8_bytes = common.build_oversized_minified_package_utf8_bytes_from_template_object_or_raise(
            template_package_object=template_object,
            minimum_decoded_byte_count=common.KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES + 1,
        )
        line_text = common.build_kibo_pkg_serial_line_from_utf8_json_bytes(oversized_utf8_bytes)
        line_character_count = common.count_kibo_pkg_serial_line_characters_excluding_final_newline(
            kibo_pkg_line_text=line_text,
        )
        self.assertGreater(len(oversized_utf8_bytes), common.KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES)
        self.assertGreater(line_character_count, common.KIBO_FIRMWARE_MAX_SERIAL_LINE_CHARACTERS)

    def test_preflight_ok_for_blink_led_golden_minified(self) -> None:
        repository_root = Path(__file__).resolve().parents[4]
        path = common.resolve_default_blink_led_golden_pico_runtime_package_json_path_or_raise(repository_root=repository_root)
        obj = json.loads(path.read_text(encoding="utf-8"))
        minified = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        line = common.build_kibo_pkg_serial_line_from_utf8_json_bytes(minified)
        try:
            common.evaluate_pico_package_payload_preflight_or_raise(
                minified_utf8_bytes=minified,
                kibo_pkg_line_text_without_newline=line.rstrip("\n"),
            )
        except SystemExit as exc:  # pragma: no cover - failure path
            self.fail(f"unexpected SystemExit from preflight: {exc.code}")

    def test_preflight_rejects_when_minified_utf8_exceeds_firmware_decode_cap(self) -> None:
        """Guard: TS `kibo-pico-package-preflight.test.ts` の oversized reject と同じ境界（12288 超）。"""
        oversized_minified_utf8_bytes = b"x" * (common.KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES + 1)
        line_text = common.build_kibo_pkg_serial_line_from_utf8_json_bytes(oversized_minified_utf8_bytes)
        stderr_capture = io.StringIO()
        with contextlib.redirect_stderr(stderr_capture):
            with self.assertRaises(SystemExit) as context:
                common.evaluate_pico_package_payload_preflight_or_raise(
                    minified_utf8_bytes=oversized_minified_utf8_bytes,
                    kibo_pkg_line_text_without_newline=line_text.rstrip("\n"),
                )
        self.assertEqual(context.exception.code, 1)
        self.assertIn("package_too_large", stderr_capture.getvalue())

    def test_v1_byte_only_preflight_rejects_12289(self) -> None:
        oversized = b"y" * (common.KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES + 1)
        stderr_capture = io.StringIO()
        with contextlib.redirect_stderr(stderr_capture):
            with self.assertRaises(SystemExit) as context:
                common.evaluate_pico_package_minified_utf8_byte_preflight_for_device_protocol_v1_or_raise(
                    minified_utf8_bytes=oversized,
                )
        self.assertEqual(context.exception.code, 1)
        self.assertIn("package_too_large", stderr_capture.getvalue())

    def test_ram_probe_padding_builder_hits_exact_firmware_limit(self) -> None:
        repository_root = Path(__file__).resolve().parents[4]
        path = common.resolve_default_blink_led_golden_pico_runtime_package_json_path_or_raise(repository_root=repository_root)
        template_object = json.loads(path.read_text(encoding="utf-8"))
        padded = common.build_minified_pico_runtime_package_utf8_bytes_with_ram_probe_padding_target_length_or_raise(
            template_package_object=template_object,
            target_minified_utf8_byte_count=common.KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES,
        )
        self.assertEqual(len(padded), common.KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES)
        common.evaluate_pico_package_minified_utf8_byte_preflight_for_device_protocol_v1_or_raise(minified_utf8_bytes=padded)

    def test_extract_conformance_trace_lines_strips_ram_probe_diagnostics(self) -> None:
        lines = [
            "trace schema=1 sim_ms=0 led0=0",
            "trace schema=1 diag=ram_probe phase=x free_heap=1 used_heap=2 total_heap=3 min_free_heap=1",
            "trace schema=1 sim_ms=1000 led0=1",
        ]
        filtered = common.extract_conformance_trace_lines_from_serial_lines_excluding_ram_probe_diagnostics(lines)
        self.assertEqual(
            filtered,
            ["trace schema=1 sim_ms=0 led0=0", "trace schema=1 sim_ms=1000 led0=1"],
        )
        self.assertTrue(
            common.contains_expected_trace_sequence(actual_trace_lines=filtered, expected_trace_lines=filtered),
        )

    def test_build_one_byte_over_firmware_limit_from_template(self) -> None:
        repository_root = Path(__file__).resolve().parents[4]
        path = common.resolve_default_blink_led_golden_pico_runtime_package_json_path_or_raise(repository_root=repository_root)
        template_object = json.loads(path.read_text(encoding="utf-8"))
        over_bytes = common.build_minified_utf8_one_byte_over_firmware_decode_limit_from_template_or_raise(
            template_package_object=template_object,
        )
        self.assertEqual(len(over_bytes), common.KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES + 1)

    def test_v1_preflight_reject_then_valid_preflight_succeeds(self) -> None:
        oversized = b"z" * (common.KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES + 1)
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                common.evaluate_pico_package_minified_utf8_byte_preflight_for_device_protocol_v1_or_raise(
                    minified_utf8_bytes=oversized,
                )
        repository_root = Path(__file__).resolve().parents[4]
        path = common.resolve_default_blink_led_golden_pico_runtime_package_json_path_or_raise(repository_root=repository_root)
        ok_obj = json.loads(path.read_text(encoding="utf-8"))
        ok_minified = json.dumps(ok_obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        try:
            common.evaluate_pico_package_minified_utf8_byte_preflight_for_device_protocol_v1_or_raise(minified_utf8_bytes=ok_minified)
        except SystemExit as exc:  # pragma: no cover
            self.fail(f"unexpected exit: {exc.code}")


if __name__ == "__main__":
    unittest.main()
