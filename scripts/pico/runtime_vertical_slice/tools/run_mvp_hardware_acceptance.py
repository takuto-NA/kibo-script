# pyright: reportMissingImports=false
"""
Responsibility: optional hardware acceptance for Simulator-to-Pico (baseline, negatives, golden packages, samples, semantics probes).

Guard: requires pyserial, Node.js, and a connected Pico with the vertical slice firmware.

Example:

    python scripts/pico/runtime_vertical_slice/tools/run_mvp_hardware_acceptance.py --port auto --repo-root . --profile all
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run hardware acceptance profiles against a connected Pico.")
    parser.add_argument(
        "--port",
        default="auto",
        help="Serial port, e.g. COM11, or `auto` to pick a likely Pico CDC port.",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path("."),
        help="Repository root (default: current directory).",
    )
    parser.add_argument("--capture-seconds", type=int, default=8, help="Seconds for each serial capture window.")
    parser.add_argument(
        "--profile",
        default="mvp",
        choices=["mvp", "baseline", "negative", "samples", "semantics", "all"],
        help="Which gate set to run (default: mvp = baseline + negative + 3 golden packages).",
    )
    return parser.parse_args(argv)


def run_subprocess_or_exit(command: list[str]) -> None:
    completed = subprocess.run(command, check=False)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def run_baseline_gate(*, repo_root: Path, port: str, capture_seconds: int) -> None:
    link_check_script = repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "pico_link_check.py"
    golden_dir = repo_root / "tests" / "runtime-conformance" / "golden"
    package_dir = golden_dir / "pico-runtime-packages"
    run_subprocess_or_exit(
        [
            sys.executable,
            str(link_check_script),
            "--port",
            port,
            "--repo-root",
            str(repo_root),
            "--package-file",
            str(package_dir / "circle-animation.pico-runtime-package.json"),
            "--capture-seconds",
            str(capture_seconds),
            "--expected-trace-file",
            str(golden_dir / "circle-animation.conformance.trace.txt"),
        ],
    )


def run_negative_gates(*, repo_root: Path, port: str) -> None:
    negative_length_script = repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "send_invalid_kibo_pkg_length.py"
    run_subprocess_or_exit([sys.executable, str(negative_length_script), "--port", port])

    negative_crc_script = repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "send_invalid_kibo_pkg_crc.py"
    run_subprocess_or_exit([sys.executable, str(negative_crc_script), "--port", port])

    negative_oversized_script = repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "send_oversized_kibo_pkg.py"
    run_subprocess_or_exit([sys.executable, str(negative_oversized_script), "--port", port])

    negative_frame_script = repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "send_invalid_kibo_pkg_frame.py"
    run_subprocess_or_exit(
        [
            sys.executable,
            str(negative_frame_script),
            "--port",
            port,
            "--kind",
            "invalid_base64",
        ],
    )


def run_three_golden_packages_gate(*, repo_root: Path, port: str, capture_seconds: int) -> None:
    link_check_script = repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "pico_link_check.py"
    golden_dir = repo_root / "tests" / "runtime-conformance" / "golden"
    package_dir = golden_dir / "pico-runtime-packages"

    profiles = [
        ("blink-led.pico-runtime-package.json", "blink-led.conformance.trace.txt"),
        ("button-toggle-on-event.pico-runtime-package.json", "button-toggle-on-event.conformance.trace.txt"),
        ("circle-animation.pico-runtime-package.json", "circle-animation.conformance.trace.txt"),
    ]

    for package_name, trace_name in profiles:
        run_subprocess_or_exit(
            [
                sys.executable,
                str(link_check_script),
                "--port",
                port,
                "--repo-root",
                str(repo_root),
                "--package-file",
                str(package_dir / package_name),
                "--expected-trace-file",
                str(golden_dir / trace_name),
                "--capture-seconds",
                str(capture_seconds),
            ],
        )


def run_samples_gate(*, repo_root: Path, port: str) -> None:
    samples_script = repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "run_pico_runtime_samples.py"
    run_subprocess_or_exit(
        [
            sys.executable,
            str(samples_script),
            "--port",
            port,
            "--repo-root",
            str(repo_root),
            "--capture-seconds",
            "8",
        ],
    )


def run_semantics_gate(*, repo_root: Path, port: str, capture_seconds: int) -> None:
    semantics_script = repo_root / "scripts" / "pico" / "runtime_vertical_slice" / "tools" / "run_pico_semantics_probes.py"
    run_subprocess_or_exit(
        [
            sys.executable,
            str(semantics_script),
            "--port",
            port,
            "--repo-root",
            str(repo_root),
            "--capture-seconds",
            str(capture_seconds),
        ],
    )


def print_acceptance_summary(*, profile: str, port: str, repo_root: Path) -> None:
    print("")
    print("--- hardware acceptance summary (paste into docs) ---")
    print(f"profile={profile}")
    print(f"port={port}")
    print(f"repo_root={repo_root.resolve()}")
    print("status=ok")
    print("--- end summary ---")


def main() -> None:
    arguments = parse_arguments_or_exit(sys.argv[1:])
    repo_root = arguments.repo_root.resolve()
    profile = arguments.profile

    if profile in ("mvp", "baseline", "all"):
        print("GATE: baseline (circle-animation golden trace)")
        run_baseline_gate(repo_root=repo_root, port=arguments.port, capture_seconds=arguments.capture_seconds)

    if profile in ("mvp", "negative", "all"):
        print("GATE: loader negatives (length / crc / oversize / frame)")
        run_negative_gates(repo_root=repo_root, port=arguments.port)

    if profile in ("mvp", "all"):
        print("GATE: 3 golden PicoRuntimePackage uploads + trace compare")
        run_three_golden_packages_gate(repo_root=repo_root, port=arguments.port, capture_seconds=arguments.capture_seconds)

    if profile in ("samples", "all"):
        print("GATE: examples/pico-runtime-samples (run_pico_runtime_samples.py)")
        run_samples_gate(repo_root=repo_root, port=arguments.port)

    if profile in ("semantics", "all"):
        print("GATE: semantics probes (pico_link_check per probe)")
        run_semantics_gate(repo_root=repo_root, port=arguments.port, capture_seconds=arguments.capture_seconds)

    print_acceptance_summary(profile=profile, port=arguments.port, repo_root=repo_root)
    print("OK: hardware acceptance profile completed.")


if __name__ == "__main__":
    main()
