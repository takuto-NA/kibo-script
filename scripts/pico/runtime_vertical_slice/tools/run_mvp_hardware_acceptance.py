# pyright: reportMissingImports=false
"""
Responsibility: optional one-shot hardware acceptance for the Simulator-to-Pico MVP (baseline, upload 3 packages, trace compare).

Guard: requires pyserial, Node.js, and a connected Pico with the vertical slice firmware. Intended for developer machines only.

Example:

    python scripts/pico/runtime_vertical_slice/tools/run_mvp_hardware_acceptance.py --port COM11 --repo-root .
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run MVP hardware acceptance against a connected Pico.")
    parser.add_argument("--port", required=True, help="Serial port, e.g. COM11.")
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path("."),
        help="Repository root (default: current directory).",
    )
    parser.add_argument("--capture-seconds", type=int, default=8, help="Seconds for each serial capture window.")
    return parser.parse_args(argv)


def run_subprocess_or_exit(command: list[str]) -> None:
    completed = subprocess.run(command, check=False)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def main() -> None:
    arguments = parse_arguments_or_exit(sys.argv[1:])
    repo_root = arguments.repo_root.resolve()

    baseline_script = repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "check_pico_baseline.py"
    upload_script = repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "upload_pico_runtime_package.py"
    compare_script = repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "compare_usb_serial_trace_lines.mjs"
    golden_dir = repo_root / "tests" / "runtime-conformance" / "golden"
    package_dir = golden_dir / "pico-runtime-packages"

    run_subprocess_or_exit(
        [
            sys.executable,
            str(baseline_script),
            "--port",
            arguments.port,
            "--capture-seconds",
            str(arguments.capture_seconds),
            "--expected-trace-file",
            str(golden_dir / "circle-animation.conformance.trace.txt"),
        ]
    )

    negative_length_script = (
        repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "send_invalid_kibo_pkg_length.py"
    )
    run_subprocess_or_exit([sys.executable, str(negative_length_script), "--port", arguments.port])

    profiles = [
        ("blink-led.pico-runtime-package.json", "blink-led.conformance.trace.txt"),
        ("button-toggle-on-event.pico-runtime-package.json", "button-toggle-on-event.conformance.trace.txt"),
        ("circle-animation.pico-runtime-package.json", "circle-animation.conformance.trace.txt"),
    ]

    for package_name, trace_name in profiles:
        run_subprocess_or_exit(
            [
                sys.executable,
                str(upload_script),
                "--port",
                arguments.port,
                "--package-file",
                str(package_dir / package_name),
            ]
        )
        run_subprocess_or_exit(
            [
                "node",
                str(compare_script),
                "--capturePort",
                arguments.port,
                "--captureSeconds",
                str(arguments.capture_seconds),
                "--expectedTraceFile",
                str(golden_dir / trace_name),
            ]
        )

    print("OK: MVP hardware acceptance completed.")


if __name__ == "__main__":
    main()
