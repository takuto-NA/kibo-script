# pyright: reportMissingImports=false
"""
Responsibility: lightweight unit tests for `pico_link_common` (no hardware, no pyserial required for pure helpers).

Run (from repository root, same as CI / `npm test`):

    npm run test:pico-link-tools

Or:

    python -m unittest discover -s scripts/pico/runtime_vertical_slice/tools -p "test_*.py"
"""

from __future__ import annotations

import unittest

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


if __name__ == "__main__":
    unittest.main()
