# pyright: reportMissingImports=false
"""
Responsibility: unit tests for `pico_ram_probe_trace` line parsing.

Run: `python -m unittest scripts.pico.runtime_vertical_slice.tools.test_pico_ram_probe_trace`
"""

from __future__ import annotations

import unittest

import pico_ram_probe_trace as ram_probe


class PicoRamProbeTraceParserTest(unittest.TestCase):
    def test_parse_valid_line(self) -> None:
        line = "trace schema=1 diag=ram_probe phase=commit_after_json_parse free_heap=12000 used_heap=8000 total_heap=20000 min_free_heap=11500"
        sample = ram_probe.try_parse_ram_probe_trace_line_or_none(serial_line=line)
        self.assertIsNotNone(sample)
        assert sample is not None
        self.assertEqual(sample.phase, "commit_after_json_parse")
        self.assertEqual(sample.free_heap, 12000)
        self.assertEqual(sample.used_heap, 8000)
        self.assertEqual(sample.total_heap, 20000)
        self.assertEqual(sample.min_free_heap, 11500)

    def test_reject_non_ram_probe_line(self) -> None:
        self.assertIsNone(ram_probe.try_parse_ram_probe_trace_line_or_none(serial_line="trace schema=1 diag=replay_exception msg=oops"))


if __name__ == "__main__":
    unittest.main()
