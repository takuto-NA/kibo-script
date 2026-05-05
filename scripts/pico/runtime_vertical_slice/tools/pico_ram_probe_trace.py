# pyright: reportMissingImports=false
"""
Responsibility: parse `trace schema=1 diag=ram_probe ...` lines emitted by Pico vertical slice firmware for RAM capacity experiments.

Guard: field names and integer shape must stay aligned with `runtime/pico/vertical_slice/src/main.cpp` output.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

_RAM_PROBE_LINE_PATTERN = re.compile(
    r"^trace schema=1 diag=ram_probe phase=(?P<phase>\S+) "
    r"free_heap=(?P<free>\d+) used_heap=(?P<used>\d+) total_heap=(?P<total>\d+) min_free_heap=(?P<min_free>\d+)$"
)


@dataclass(frozen=True)
class RamProbeTraceSample:
    phase: str
    free_heap: int
    used_heap: int
    total_heap: int
    min_free_heap: int


def try_parse_ram_probe_trace_line_or_none(*, serial_line: str) -> RamProbeTraceSample | None:
    stripped = serial_line.strip()
    match = _RAM_PROBE_LINE_PATTERN.match(stripped)
    if match is None:
        return None
    return RamProbeTraceSample(
        phase=match.group("phase"),
        free_heap=int(match.group("free"), 10),
        used_heap=int(match.group("used"), 10),
        total_heap=int(match.group("total"), 10),
        min_free_heap=int(match.group("min_free"), 10),
    )


def extract_ram_probe_trace_samples_from_serial_lines(*, serial_lines: Iterable[str]) -> list[RamProbeTraceSample]:
    samples: list[RamProbeTraceSample] = []
    for line in serial_lines:
        sample = try_parse_ram_probe_trace_line_or_none(serial_line=line)
        if sample is not None:
            samples.append(sample)
    return samples
