# pyright: reportMissingImports=false
"""
Responsibility: one-shot Pico link check: optional BOOTSEL loader install, script/runtime IR -> package (tsx), upload,
then USB serial trace verification against TypeScript replay expectations.

Guard: requires pyserial + `npm install` (tsx) at the repository root. Intended for developer machines.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pico_link_common as common

_DEFAULT_REPO_ROOT = common.resolve_repository_root_from_tools_file(tools_file_path=Path(__file__))
_TOOLS_DIRECTORY = Path(__file__).resolve().parent
_INSTALL_SCRIPT_PATH = _TOOLS_DIRECTORY / "install_pico_loader.py"
_UPLOAD_SCRIPT_PATH = _TOOLS_DIRECTORY / "upload_pico_runtime_package.py"


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build (optional), upload, and trace-verify a PicoRuntimePackage.")
    parser.add_argument(
        "--port",
        default="auto",
        help="Serial port (e.g. COM11) or `auto`.",
    )
    parser.add_argument("--baud-rate", type=int, default=common.KIBO_USB_SERIAL_BAUD_RATE, help="Serial baud rate.")
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=_DEFAULT_REPO_ROOT,
        help="Repository root.",
    )
    parser.add_argument(
        "--runtime-ir",
        type=Path,
        default=None,
        help="Path to runtime IR contract JSON (simulator export).",
    )
    parser.add_argument(
        "--source-script",
        type=Path,
        default=None,
        help="Path to Kibo Script source (.sc). Compiles with TypeScript compiler before packaging.",
    )
    parser.add_argument(
        "--package-file",
        type=Path,
        default=None,
        help="Path to an existing PicoRuntimePackage JSON.",
    )
    parser.add_argument(
        "--trace-var",
        default=None,
        help="Comma-separated script var names for trace observation (passed to package build CLI).",
    )
    parser.add_argument(
        "--capture-seconds",
        type=float,
        default=8.0,
        help="How long to capture USB serial for trace verification after upload.",
    )
    parser.add_argument(
        "--install-loader-if-bootsel",
        action="store_true",
        help="If BOOTSEL UF2 volume is visible on Windows, run install_pico_loader.py before continuing.",
    )
    parser.add_argument(
        "--expected-trace-file",
        type=Path,
        default=None,
        help="Optional golden trace file. If omitted, expected trace lines are generated from the package via tsx.",
    )
    return parser.parse_args(argv)


def maybe_install_loader_if_bootsel_requested_or_exit(*, arguments: argparse.Namespace) -> None:
    if not arguments.install_loader_if_bootsel:
        return
    if not sys.platform.lower().startswith("win"):
        print("NOTE: --install-loader-if-bootsel is ignored on non-Windows hosts (UF2 automation is Windows-only).")
        return
    bootsel_letter = common.find_rp2040_bootsel_volume_drive_letter_or_none()
    if bootsel_letter is None:
        return
    print(f"NOTE: BOOTSEL volume detected ({bootsel_letter}:). Running install_pico_loader.py ...")
    completed = subprocess.run(
        [
            sys.executable,
            str(_INSTALL_SCRIPT_PATH),
            "--repo-root",
            str(arguments.repo_root.resolve()),
            "--port",
            arguments.port,
        ],
        check=False,
    )
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def resolve_package_path_and_generated_flag_or_exit(*, arguments: argparse.Namespace) -> tuple[Path, bool]:
    provided_input_count = sum(
        input_path is not None
        for input_path in [arguments.runtime_ir, arguments.source_script, arguments.package_file]
    )
    if provided_input_count != 1:
        print("FAIL: pass exactly one of --source-script, --runtime-ir, or --package-file.", file=sys.stderr)
        raise SystemExit(2)

    if arguments.package_file is not None:
        return arguments.package_file.resolve(), False

    repo_root = arguments.repo_root.resolve()
    candidate_parent_directory = repo_root / ".pico-work"
    output_parent_directory = candidate_parent_directory if candidate_parent_directory.is_dir() else Path(tempfile.gettempdir())
    temporary_file = tempfile.NamedTemporaryFile(
        suffix=".pico-runtime-package.json",
        delete=False,
        dir=str(output_parent_directory),
    )
    temporary_path = Path(temporary_file.name)
    temporary_file.close()

    if arguments.runtime_ir is not None:
        common.build_pico_runtime_package_using_tsx_cli_or_exit(
            repository_root=repo_root,
            runtime_ir_contract_json_path=arguments.runtime_ir.resolve(),
            output_package_json_path=temporary_path,
            trace_var_names_comma_separated=arguments.trace_var,
        )
    else:
        common.build_pico_runtime_package_from_source_using_tsx_cli_or_exit(
            repository_root=repo_root,
            source_script_path=arguments.source_script.resolve(),
            output_package_json_path=temporary_path,
            trace_var_names_comma_separated=arguments.trace_var,
        )
    return temporary_path, True


def verify_trace_capture_or_exit(
    *,
    serial_module: object,
    port_path: str,
    baud_rate: int,
    capture_seconds: float,
    expected_trace_lines: list[str],
) -> None:
    serial_port = common.open_serial_port_for_kibo_vertical_slice_or_raise(
        serial_module=serial_module,
        port_path=port_path,
        baud_rate=baud_rate,
        read_timeout_seconds=0.1,
        write_timeout_seconds=common.DEFAULT_SERIAL_WRITE_TIMEOUT_SECONDS,
    )
    try:
        time.sleep(0.2)
        captured_lines = common.read_serial_lines_for_seconds(serial_port=serial_port, capture_seconds=capture_seconds)
    finally:
        serial_port.close()

    actual_trace_lines = common.extract_trace_lines_from_serial_lines(captured_lines)
    if not common.contains_expected_trace_sequence(actual_trace_lines=actual_trace_lines, expected_trace_lines=expected_trace_lines):
        print("FAIL: expected trace sequence was not found in captured trace lines.", file=sys.stderr)
        print("--- expected ---", file=sys.stderr)
        print("\n".join(expected_trace_lines), file=sys.stderr)
        print("--- actual trace lines ---", file=sys.stderr)
        print("\n".join(actual_trace_lines), file=sys.stderr)
        raise SystemExit(1)


def print_success_tip(*, arguments: argparse.Namespace, tools_directory: Path, upload_script_path: Path, port_path: str, package_path: Path, package_was_generated: bool) -> None:
    print("OK: upload + trace verification succeeded.")
    print(f"Tip: inspect the active loader with:\n  python {tools_directory / 'pico_link_doctor.py'} --port {port_path}")
    if package_was_generated:
        print("Tip: repeat the same check from source/runtime IR with the same pico_link_check command.")
        return
    print(
        "Tip: upload the same package again with:\n"
        f"  python {upload_script_path} --port {port_path} --package-file {package_path}",
    )


def main() -> None:
    arguments = parse_arguments_or_exit(sys.argv[1:])
    repo_root = arguments.repo_root.resolve()

    maybe_install_loader_if_bootsel_requested_or_exit(arguments=arguments)

    package_path: Path | None = None
    package_was_generated = False
    try:
        package_path, package_was_generated = resolve_package_path_and_generated_flag_or_exit(arguments=arguments)

        serial_module = common.try_import_pyserial_serial_module_or_exit()
        port_path = common.resolve_serial_port_path_for_vertical_slice_or_exit(port_argument=arguments.port)

        preflight_serial_port = common.open_serial_port_for_kibo_vertical_slice_or_raise(
            serial_module=serial_module,
            port_path=port_path,
            baud_rate=arguments.baud_rate,
            read_timeout_seconds=common.DEFAULT_SERIAL_READ_TIMEOUT_SECONDS,
            write_timeout_seconds=common.DEFAULT_SERIAL_WRITE_TIMEOUT_SECONDS,
        )
        try:
            preflight = common.run_loader_preflight_on_open_serial_port(serial_port=preflight_serial_port)
        finally:
            preflight_serial_port.close()

        if preflight.loader_protocol_version != 1:
            print("FAIL: loader firmware not ready (KIBO_PING did not return protocol=1).", file=sys.stderr)
            print("Next:", file=sys.stderr)
            print(f"  python {_INSTALL_SCRIPT_PATH} --repo-root {repo_root} --port {arguments.port}", file=sys.stderr)
            raise SystemExit(1)

        if arguments.expected_trace_file is not None:
            expected_text = arguments.expected_trace_file.read_text(encoding="utf-8")
            expected_trace_lines = common.extract_trace_lines_from_serial_lines(
                common.split_non_empty_lines_from_text(expected_text),
            )
        else:
            expected_trace_lines = list(
                common.print_expected_conformance_trace_lines_from_package_using_tsx_or_exit(
                    repository_root=repo_root,
                    package_json_path=package_path,
                ),
            )

        completed = subprocess.run(
            [
                sys.executable,
                str(_UPLOAD_SCRIPT_PATH),
                "--port",
                port_path,
                "--baud-rate",
                str(arguments.baud_rate),
                "--package-file",
                str(package_path),
                "--no-preflight",
                "--post-upload-trace-capture-seconds",
                "0",
            ],
            check=False,
        )
        if completed.returncode != 0:
            raise SystemExit(completed.returncode)

        verify_trace_capture_or_exit(
            serial_module=serial_module,
            port_path=port_path,
            baud_rate=arguments.baud_rate,
            capture_seconds=arguments.capture_seconds,
            expected_trace_lines=expected_trace_lines,
        )

        print_success_tip(
            arguments=arguments,
            tools_directory=_TOOLS_DIRECTORY,
            upload_script_path=_UPLOAD_SCRIPT_PATH,
            port_path=port_path,
            package_path=package_path,
            package_was_generated=package_was_generated,
        )
    finally:
        if package_was_generated and package_path is not None:
            try:
                package_path.unlink(missing_ok=True)
            except OSError:
                pass


if __name__ == "__main__":
    main()
