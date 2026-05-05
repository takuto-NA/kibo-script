# pyright: reportMissingImports=false
"""
Responsibility: lightweight unit tests for `pico_link_common` (no hardware, no pyserial required for pure helpers).

Run (from repository root, same as CI / `npm test`):

    npm run test:pico-link-tools

Or:

    python -m unittest discover -s scripts/pico/runtime_vertical_slice/tools -p "test_*.py"
"""

from __future__ import annotations

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


if __name__ == "__main__":
    unittest.main()
