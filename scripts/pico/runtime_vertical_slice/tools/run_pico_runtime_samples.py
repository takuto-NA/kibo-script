# pyright: reportMissingImports=false
"""
Responsibility: run every Pico runtime sample script through source compile, TypeScript replay expectation generation,
USB upload, and Pico trace verification.

Guard: this is a hardware acceptance script; it requires the Pico loader firmware, pyserial, Node.js, and npm install.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pico_link_common as common

_DEFAULT_REPO_ROOT = common.resolve_repository_root_from_tools_file(tools_file_path=Path(__file__))
_TOOLS_DIRECTORY = Path(__file__).resolve().parent
_PICO_LINK_CHECK_SCRIPT_PATH = _TOOLS_DIRECTORY / "pico_link_check.py"
_DEFAULT_SAMPLES_MANIFEST_PATH = _DEFAULT_REPO_ROOT / "examples" / "pico-runtime-samples" / "samples.json"


@dataclass(frozen=True)
class PicoRuntimeSample:
    name: str
    source_path: Path
    trace_var_names: list[str]


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Pico runtime sample scripts on simulator replay and hardware.")
    parser.add_argument("--port", default="auto", help="Serial port (e.g. COM11) or `auto`.")
    parser.add_argument("--repo-root", type=Path, default=_DEFAULT_REPO_ROOT, help="Repository root.")
    parser.add_argument(
        "--samples-manifest",
        type=Path,
        default=_DEFAULT_SAMPLES_MANIFEST_PATH,
        help="Path to examples/pico-runtime-samples/samples.json.",
    )
    parser.add_argument(
        "--sample",
        action="append",
        default=[],
        help="Run only this sample name. Can be passed more than once.",
    )
    parser.add_argument(
        "--capture-seconds",
        type=float,
        default=8.0,
        help="How long each pico_link_check capture should wait for trace verification.",
    )
    return parser.parse_args(argv)


def assert_is_record(value: Any, *, description: str) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    raise SystemExit(f"FAIL: {description} must be a JSON object.")


def assert_is_string(value: Any, *, description: str) -> str:
    if isinstance(value, str):
        return value
    raise SystemExit(f"FAIL: {description} must be a string.")


def assert_is_string_list(value: Any, *, description: str) -> list[str]:
    if not isinstance(value, list):
        raise SystemExit(f"FAIL: {description} must be a string array.")
    names: list[str] = []
    for item in value:
        names.append(assert_is_string(item, description=description))
    return names


def load_samples_from_manifest_or_exit(*, manifest_path: Path) -> list[PicoRuntimeSample]:
    root = assert_is_record(json.loads(manifest_path.read_text(encoding="utf-8")), description="samples manifest")
    samples_unknown = root.get("samples")
    if not isinstance(samples_unknown, list):
        raise SystemExit("FAIL: samples manifest must contain a `samples` array.")

    manifest_directory = manifest_path.resolve().parent
    samples: list[PicoRuntimeSample] = []
    for index, sample_unknown in enumerate(samples_unknown):
        sample_record = assert_is_record(sample_unknown, description=f"samples[{index}]")
        name = assert_is_string(sample_record.get("name"), description=f"samples[{index}].name")
        source_file = assert_is_string(sample_record.get("sourceFile"), description=f"samples[{index}].sourceFile")
        trace_var_names = assert_is_string_list(sample_record.get("traceVars", []), description=f"samples[{index}].traceVars")
        source_path = manifest_directory / source_file
        if not source_path.is_file():
            raise SystemExit(f"FAIL: sample source file does not exist: {source_path}")
        samples.append(PicoRuntimeSample(name=name, source_path=source_path, trace_var_names=trace_var_names))
    return samples


def filter_samples_or_exit(*, samples: list[PicoRuntimeSample], requested_names: list[str]) -> list[PicoRuntimeSample]:
    if len(requested_names) == 0:
        return samples
    requested_name_set = set(requested_names)
    filtered = [sample for sample in samples if sample.name in requested_name_set]
    missing_names = sorted(requested_name_set.difference(sample.name for sample in filtered))
    if len(missing_names) == 0:
        return filtered
    raise SystemExit(f"FAIL: unknown sample name(s): {', '.join(missing_names)}")


def run_sample_or_exit(*, sample: PicoRuntimeSample, arguments: argparse.Namespace) -> None:
    command = [
        sys.executable,
        str(_PICO_LINK_CHECK_SCRIPT_PATH),
        "--port",
        arguments.port,
        "--repo-root",
        str(arguments.repo_root.resolve()),
        "--source-script",
        str(sample.source_path.resolve()),
        "--capture-seconds",
        str(arguments.capture_seconds),
    ]
    if len(sample.trace_var_names) > 0:
        command.extend(["--trace-var", ",".join(sample.trace_var_names)])

    print(f"=== sample: {sample.name} ===", flush=True)
    print(f"source: {sample.source_path}", flush=True)
    completed = subprocess.run(command, check=False)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def main() -> None:
    arguments = parse_arguments_or_exit(sys.argv[1:])
    samples = load_samples_from_manifest_or_exit(manifest_path=arguments.samples_manifest.resolve())
    selected_samples = filter_samples_or_exit(samples=samples, requested_names=arguments.sample)
    for sample in selected_samples:
        run_sample_or_exit(sample=sample, arguments=arguments)
    print(f"OK: {len(selected_samples)} Pico runtime sample(s) matched TypeScript replay trace on hardware.")


if __name__ == "__main__":
    main()
