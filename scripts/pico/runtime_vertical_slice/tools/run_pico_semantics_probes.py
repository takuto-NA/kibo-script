# pyright: reportMissingImports=false
"""
Responsibility: run `pico_link_check.py` for semantics probe fixtures (host-generated package + trace golden).

Guard: requires pyserial + npm/tsx (same as `pico_link_check.py`).

Example:

    python scripts/pico/runtime_vertical_slice/tools/run_pico_semantics_probes.py --port auto --repo-root .
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload semantics probe scripts and verify Pico serial traces.")
    parser.add_argument("--port", default="auto", help="Serial port or `auto`.")
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path("."),
        help="Repository root.",
    )
    parser.add_argument("--capture-seconds", type=float, default=8.0, help="Serial capture window for trace compare.")
    return parser.parse_args(argv)


def main() -> None:
    arguments = parse_arguments_or_exit(sys.argv[1:])
    repo_root = arguments.repo_root.resolve()
    tools_dir = repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools"
    link_check = tools_dir / "pico_link_check.py"
    fixtures_dir = repo_root / "tests" / "compiler" / "fixtures"
    golden_dir = repo_root / "tests" / "runtime-conformance" / "golden"

    probes: list[tuple[str, str, str]] = [
        ("semantics-if-led-branch.sc", "semantics-if-led-branch.conformance.trace.txt", "branch_toggle"),
        ("semantics-wait-skew.sc", "semantics-wait-skew.conformance.trace.txt", "waited_count"),
        ("semantics-loop-budget.sc", "semantics-loop-budget.conformance.trace.txt", ""),
        ("semantics-match-string.sc", "semantics-match-string.conformance.trace.txt", "mode"),
    ]

    for source_name, trace_name, trace_var in probes:
        source_path = fixtures_dir / source_name
        trace_path = golden_dir / trace_name
        if not source_path.is_file():
            print(f"FAIL: missing fixture {source_path}", file=sys.stderr)
            raise SystemExit(2)
        if not trace_path.is_file():
            print(f"FAIL: missing golden trace {trace_path}", file=sys.stderr)
            raise SystemExit(2)

        command = [
            sys.executable,
            str(link_check),
            "--port",
            arguments.port,
            "--repo-root",
            str(repo_root),
            "--source-script",
            str(source_path),
            "--expected-trace-file",
            str(trace_path),
            "--capture-seconds",
            str(arguments.capture_seconds),
        ]
        if trace_var != "":
            command.extend(["--trace-var", trace_var])

        print(f"PROBE: {source_name}")
        completed = subprocess.run(command, check=False)
        if completed.returncode != 0:
            print("FAIL: semantics probe gate failed.", file=sys.stderr)
            print(f"Replay with:\n  {' '.join(command)}", file=sys.stderr)
            raise SystemExit(completed.returncode)

    print("OK: all semantics probes passed.")


if __name__ == "__main__":
    main()
