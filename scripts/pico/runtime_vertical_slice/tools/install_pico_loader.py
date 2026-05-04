# pyright: reportMissingImports=false
"""
Responsibility: automate first-time loader firmware install by copying `firmware.uf2` to the BOOTSEL `RPI-RP2` USB volume,
then verify CDC serial returns a `KIBO_PING` loader handshake.

Guard: UF2 copy automation is Windows-first (volume letter detection). Other hosts print manual steps.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pico_link_common as common

_DEFAULT_REPO_ROOT = common.resolve_repository_root_from_tools_file(tools_file_path=Path(__file__))
_POST_COPY_HANDSHAKE_WAIT_TIMEOUT_SECONDS = 45.0
_POST_COPY_HANDSHAKE_POLL_INTERVAL_SECONDS = 1.0


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install vertical slice loader firmware via BOOTSEL UF2 copy + serial verify.")
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=_DEFAULT_REPO_ROOT,
        help="Repository root.",
    )
    parser.add_argument(
        "--port",
        default="auto",
        help="Serial port after reboot (e.g. COM11) or `auto`.",
    )
    parser.add_argument("--baud-rate", type=int, default=common.KIBO_USB_SERIAL_BAUD_RATE, help="Serial baud rate.")
    parser.add_argument(
        "--pio-exe",
        type=Path,
        default=None,
        help="Path to pio.exe (PlatformIO). Required with --build when pio is not on PATH.",
    )
    parser.add_argument("--build", action="store_true", help="Run `pio run` under runtime/pico/vertical_slice before copying.")
    parser.add_argument("--dry-run", action="store_true", help="Print paths and exit before copying.")
    return parser.parse_args(argv)


def run_platform_io_build_or_exit(*, pio_executable: Path, vertical_slice_directory: Path) -> None:
    completed = subprocess.run([str(pio_executable), "run"], check=False, cwd=str(vertical_slice_directory))
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def resolve_pio_executable_or_exit(*, pio_path_argument: Path | None) -> Path | None:
    if pio_path_argument is not None:
        return pio_path_argument
    from shutil import which

    found = which("pio")
    if found is None:
        return None
    return Path(found)


def wait_for_loader_handshake_on_serial_or_exit(
    *,
    serial_module: object,
    port_argument: str,
    baud_rate: int,
    overall_timeout_seconds: float,
) -> None:
    deadline = time.monotonic() + overall_timeout_seconds
    while time.monotonic() < deadline:
        try:
            port_path = common.resolve_serial_port_path_for_vertical_slice_or_raise_value_error(
                port_argument=port_argument,
            )
            serial_port = common.open_serial_port_for_kibo_vertical_slice_or_raise(
                serial_module=serial_module,
                port_path=port_path,
                baud_rate=baud_rate,
                read_timeout_seconds=common.DEFAULT_SERIAL_READ_TIMEOUT_SECONDS,
                write_timeout_seconds=common.DEFAULT_SERIAL_WRITE_TIMEOUT_SECONDS,
            )
        except (PermissionError, OSError, ValueError):
            time.sleep(_POST_COPY_HANDSHAKE_POLL_INTERVAL_SECONDS)
            continue
        try:
            preflight = common.run_loader_preflight_on_open_serial_port(serial_port=serial_port)
            if preflight.loader_protocol_version == 1:
                return
        finally:
            serial_port.close()
        time.sleep(_POST_COPY_HANDSHAKE_POLL_INTERVAL_SECONDS)

    print("FAIL: timed out waiting for loader handshake after UF2 install.", file=sys.stderr)
    print("Next: run scripts/pico/runtime_vertical_slice/tools/pico_link_doctor.py --port auto", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    arguments = parse_arguments_or_exit(sys.argv[1:])
    repo_root = arguments.repo_root.resolve()
    vertical_slice_directory = repo_root / "runtime" / "pico" / "vertical_slice"

    if arguments.build:
        pio_executable = resolve_pio_executable_or_exit(pio_path_argument=arguments.pio_exe)
        if pio_executable is None:
            print("FAIL: --build was set but pio was not found. Pass --pio-exe path/to/pio.exe", file=sys.stderr)
            raise SystemExit(2)
        run_platform_io_build_or_exit(pio_executable=pio_executable, vertical_slice_directory=vertical_slice_directory)

    firmware_path = common.resolve_vertical_slice_firmware_uf2_path_or_none(repository_root=repo_root)
    if firmware_path is None:
        print(
            "FAIL: firmware.uf2 not found. Build first (see runtime/pico/vertical_slice/README.md), or pass --build with pio available.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    if not sys.platform.lower().startswith("win"):
        print("This installer currently automates UF2 copy on Windows only.")
        print(f"Manually copy this file to the BOOTSEL volume while it shows as {common.RP2040_UF2_VOLUME_LABEL}:")
        print(f"  {firmware_path}")
        raise SystemExit(2)

    bootsel_letter = common.find_rp2040_bootsel_volume_drive_letter_or_none()
    if bootsel_letter is None:
        print("FAIL: BOOTSEL UF2 volume not detected.")
        print("Hold BOOTSEL, plug in USB, and confirm a drive labeled RPI-RP2 appears, then retry.")
        raise SystemExit(2)

    destination_path = Path(f"{bootsel_letter}:/firmware.uf2")
    print(f"BOOTSEL detected at {bootsel_letter}: ({common.RP2040_UF2_VOLUME_LABEL})")
    print(f"Source firmware: {firmware_path}")
    print(f"Destination: {destination_path}")
    if arguments.dry_run:
        print("OK: dry-run only; not copying.")
        return

    shutil.copy2(firmware_path, destination_path)
    print("OK: UF2 copy completed; waiting for CDC serial to return...")

    serial_module = common.try_import_pyserial_serial_module_or_exit()
    wait_for_loader_handshake_on_serial_or_exit(
        serial_module=serial_module,
        port_argument=arguments.port,
        baud_rate=arguments.baud_rate,
        overall_timeout_seconds=_POST_COPY_HANDSHAKE_WAIT_TIMEOUT_SECONDS,
    )
    print("OK: loader firmware handshake verified (protocol=1).")


if __name__ == "__main__":
    main()
