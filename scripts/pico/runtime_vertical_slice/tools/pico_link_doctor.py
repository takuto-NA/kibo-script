# pyright: reportMissingImports=false
"""
Responsibility: diagnose Pico vertical slice USB serial connectivity: COM port selection, BOOTSEL UF2 volume visibility,
loader firmware handshake (`KIBO_PING`), and common failure modes (port busy / old firmware).

Guard: requires pyserial on the host. Intended for developer machines (Windows-first helpers).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pico_link_common as common

_DEFAULT_REPO_ROOT = common.resolve_repository_root_from_tools_file(tools_file_path=Path(__file__))


def parse_arguments_or_exit(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Diagnose Pico vertical slice serial link (loader handshake, BOOTSEL, port).")
    parser.add_argument(
        "--port",
        default="auto",
        help="Serial port (e.g. COM11) or `auto` to pick a likely Pico CDC port.",
    )
    parser.add_argument("--baud-rate", type=int, default=common.KIBO_USB_SERIAL_BAUD_RATE, help="Serial baud rate.")
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=_DEFAULT_REPO_ROOT,
        help="Repository root (used for firmware.uf2 existence hints).",
    )
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON to stdout.")
    return parser.parse_args(argv)


def main() -> None:
    arguments = parse_arguments_or_exit(sys.argv[1:])
    serial_module = common.try_import_pyserial_serial_module_or_exit()

    repo_root = arguments.repo_root.resolve()
    firmware_path = common.resolve_vertical_slice_firmware_uf2_path_or_none(repository_root=repo_root)

    bootsel_letter = None
    if sys.platform.lower().startswith("win"):
        bootsel_letter = common.find_rp2040_bootsel_volume_drive_letter_or_none()

    resolved_port: str | None = None
    port_resolution_error: str | None = None
    try:
        resolved_port = common.resolve_serial_port_path_for_vertical_slice_or_raise_value_error(port_argument=arguments.port)
    except ValueError as value_error:
        port_resolution_error = str(value_error)

    open_error_text: str | None = None
    preflight: common.LoaderPreflightResult | None = None
    if resolved_port is not None:
        try:
            serial_port = common.open_serial_port_for_kibo_vertical_slice_or_raise(
                serial_module=serial_module,
                port_path=resolved_port,
                baud_rate=arguments.baud_rate,
                read_timeout_seconds=common.DEFAULT_SERIAL_READ_TIMEOUT_SECONDS,
                write_timeout_seconds=common.DEFAULT_SERIAL_WRITE_TIMEOUT_SECONDS,
            )
            try:
                preflight = common.run_loader_preflight_on_open_serial_port(serial_port=serial_port)
            finally:
                serial_port.close()
        except PermissionError as permission_error:
            open_error_text = str(permission_error)
        except OSError as os_error:
            open_error_text = str(os_error)

    diagnosis_lines: list[str] = []
    if resolved_port is None:
        diagnosis_lines.append("Could not resolve a serial port.")
        if port_resolution_error is not None:
            diagnosis_lines.append(port_resolution_error)
    else:
        diagnosis_lines.append(f"Resolved serial port: {resolved_port}")

    if open_error_text is not None:
        diagnosis_lines.append(f"Serial open failed: {open_error_text}")
        diagnosis_lines.append(common.format_permission_error_hint_for_serial_port(port_path=resolved_port or arguments.port))
    elif preflight is not None:
        diagnosis_lines.append(f"KIBO_PING captured {len(preflight.captured_lines)} line(s) after ping.")
        diagnosis_lines.append(f"Boot banner substring present: {preflight.boot_banner_found}")
        if preflight.loader_status_line is None:
            diagnosis_lines.append("Loader handshake: MISSING (no kibo_loader status=ok line).")
            diagnosis_lines.append("Likely causes:")
            diagnosis_lines.append("  - Old vertical slice firmware without KIBO_PING support.")
            diagnosis_lines.append("  - Wrong serial port, or device stuck in a non-CDC mode.")
            diagnosis_lines.append("Next:")
            diagnosis_lines.append("  - Flash latest firmware.uf2 via BOOTSEL (see install_pico_loader.py).")
        else:
            diagnosis_lines.append(f"Loader handshake: OK ({preflight.loader_status_line})")
            if preflight.loader_protocol_version != 1:
                diagnosis_lines.append(f"Unexpected loader protocol version: {preflight.loader_protocol_version}")

    if bootsel_letter is not None:
        diagnosis_lines.append(f"BOOTSEL UF2 volume detected: {bootsel_letter}: ({common.RP2040_UF2_VOLUME_LABEL})")
        diagnosis_lines.append("Next: copy firmware.uf2 to the drive root, then reconnect CDC serial.")
    else:
        diagnosis_lines.append("BOOTSEL UF2 volume: not detected (normal when not holding BOOTSEL).")

    if firmware_path is not None:
        diagnosis_lines.append(f"Built firmware.uf2 exists: {firmware_path}")
    else:
        diagnosis_lines.append("Built firmware.uf2 not found (run PlatformIO build under runtime/pico/vertical_slice).")

    exit_code = 0
    if resolved_port is None:
        exit_code = 2
    elif open_error_text is not None:
        exit_code = 1
    elif preflight is None or preflight.loader_status_line is None or preflight.loader_protocol_version != 1:
        exit_code = 1

    if arguments.json:
        payload = {
            "bootBannerFound": preflight.boot_banner_found if preflight else False,
            "firmwareUf2Path": str(firmware_path) if firmware_path is not None else None,
            "loaderProtocolVersion": preflight.loader_protocol_version if preflight else None,
            "loaderStatusLine": preflight.loader_status_line if preflight else None,
            "portResolutionError": port_resolution_error,
            "resolvedPortPath": resolved_port,
            "rpiRp2BootDriveLetter": bootsel_letter,
            "serialOpenError": open_error_text,
        }
        print(json.dumps(payload, indent=2, sort_keys=True))
        raise SystemExit(exit_code)

    print("\n".join(diagnosis_lines))
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
