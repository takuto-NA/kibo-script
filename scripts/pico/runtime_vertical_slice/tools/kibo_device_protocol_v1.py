# pyright: reportMissingImports=false
"""
Responsibility: Kibo Device Protocol v1 binary frame encode/decode for host tools (Python).

Guard: CRC32 matches zlib / TypeScript `compute_zlib_compatible_crc32_uint32_from_uint8_array` / C++ `kibo_crc32.hpp`.
"""

from __future__ import annotations

import base64
import json
import struct
import zlib
from dataclasses import dataclass
from enum import IntEnum
from typing import Final


KIBO_DEVICE_PROTOCOL_V1_MAGIC: Final[bytes] = b"KIBO"
KIBO_DEVICE_PROTOCOL_V1_PROTOCOL_VERSION_U16: Final[int] = 1
KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH: Final[int] = 20
KIBO_DEVICE_PROTOCOL_V1_ENVELOPE_BYTE_LENGTH: Final[int] = 12
KIBO_DEVICE_PROTOCOL_V1_CODEC_ID_JSON_UTF8: Final[int] = 0
HEADER_CRC_INPUT_BYTE_LENGTH: Final[int] = 16


class KiboDeviceProtocolV1MessageKind(IntEnum):
    RESERVED = 0
    HELLO = 1
    CAPABILITIES = 2
    PING = 3
    PONG = 4
    LOG = 5
    TRACE = 6
    ERROR = 7
    FILE_BEGIN = 8
    FILE_CHUNK = 9
    FILE_COMMIT = 10
    RUN_PACKAGE = 11


def compute_crc32_ieee_over_bytes(data_bytes: bytes) -> int:
    return zlib.crc32(data_bytes) & 0xFFFFFFFF


def encode_kibo_device_protocol_v1_frame_or_raise(
    *,
    sequence: int,
    request_id: int,
    message_kind: KiboDeviceProtocolV1MessageKind | int,
    payload_utf8_bytes: bytes,
    codec_id: int = KIBO_DEVICE_PROTOCOL_V1_CODEC_ID_JSON_UTF8,
    envelope_flags: int = 0,
) -> bytes:
    if codec_id != KIBO_DEVICE_PROTOCOL_V1_CODEC_ID_JSON_UTF8:
        raise ValueError(f"unsupported codec_id: {codec_id}")

    kind_byte = int(message_kind) & 0xFF
    payload_length = len(payload_utf8_bytes)
    body_byte_length = KIBO_DEVICE_PROTOCOL_V1_ENVELOPE_BYTE_LENGTH + payload_length

    header = bytearray(KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH)
    header[0:4] = KIBO_DEVICE_PROTOCOL_V1_MAGIC
    struct.pack_into(
        "<HHII",
        header,
        4,
        KIBO_DEVICE_PROTOCOL_V1_PROTOCOL_VERSION_U16,
        0,
        sequence & 0xFFFFFFFF,
        body_byte_length & 0xFFFFFFFF,
    )
    struct.pack_into("<I", header, 16, 0)
    header_crc = compute_crc32_ieee_over_bytes(bytes(header[0:HEADER_CRC_INPUT_BYTE_LENGTH]))
    struct.pack_into("<I", header, 16, header_crc)

    envelope_and_payload = bytearray(KIBO_DEVICE_PROTOCOL_V1_ENVELOPE_BYTE_LENGTH + payload_length)
    envelope_and_payload[0] = kind_byte
    envelope_and_payload[1] = codec_id & 0xFF
    struct.pack_into(
        "<HII",
        envelope_and_payload,
        2,
        envelope_flags & 0xFFFF,
        request_id & 0xFFFFFFFF,
        payload_length & 0xFFFFFFFF,
    )
    envelope_and_payload[KIBO_DEVICE_PROTOCOL_V1_ENVELOPE_BYTE_LENGTH :] = payload_utf8_bytes

    body_crc = compute_crc32_ieee_over_bytes(bytes(envelope_and_payload))
    return bytes(header) + bytes(envelope_and_payload) + struct.pack("<I", body_crc)


@dataclass(frozen=True)
class KiboDeviceProtocolV1DecodeOk:
    sequence: int
    message_kind: int
    codec_id: int
    envelope_flags: int
    request_id: int
    payload_utf8_bytes: bytes


@dataclass(frozen=True)
class KiboDeviceProtocolV1DecodeError:
    error_code: str
    detail: str | None = None


def decode_kibo_device_protocol_v1_frame(frame_bytes: bytes) -> KiboDeviceProtocolV1DecodeOk | KiboDeviceProtocolV1DecodeError:
    minimum_length = KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH + KIBO_DEVICE_PROTOCOL_V1_ENVELOPE_BYTE_LENGTH + 4
    if len(frame_bytes) < minimum_length:
        return KiboDeviceProtocolV1DecodeError(error_code="frame_too_short")

    if frame_bytes[0:4] != KIBO_DEVICE_PROTOCOL_V1_MAGIC:
        return KiboDeviceProtocolV1DecodeError(error_code="invalid_magic")

    protocol_version = struct.unpack_from("<H", frame_bytes, 4)[0]
    if protocol_version != KIBO_DEVICE_PROTOCOL_V1_PROTOCOL_VERSION_U16:
        return KiboDeviceProtocolV1DecodeError(error_code="unsupported_protocol_version", detail=str(protocol_version))

    actual_header_crc = compute_crc32_ieee_over_bytes(frame_bytes[0:HEADER_CRC_INPUT_BYTE_LENGTH])
    expected_header_crc = struct.unpack_from("<I", frame_bytes, 16)[0]
    if actual_header_crc != expected_header_crc:
        return KiboDeviceProtocolV1DecodeError(error_code="header_crc_mismatch")

    sequence = struct.unpack_from("<I", frame_bytes, 8)[0]
    body_byte_length = struct.unpack_from("<I", frame_bytes, 12)[0]

    expected_total_length = KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH + body_byte_length + 4
    if len(frame_bytes) != expected_total_length:
        return KiboDeviceProtocolV1DecodeError(
            error_code="body_length_inconsistent",
            detail=f"expected_total={expected_total_length} actual={len(frame_bytes)}",
        )

    body_start = KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH
    body_end = body_start + body_byte_length
    body_bytes = frame_bytes[body_start:body_end]

    expected_body_crc = struct.unpack_from("<I", frame_bytes, body_end)[0]
    actual_body_crc = compute_crc32_ieee_over_bytes(body_bytes)
    if actual_body_crc != expected_body_crc:
        return KiboDeviceProtocolV1DecodeError(error_code="body_crc_mismatch")

    message_kind = body_bytes[0]
    codec_id = body_bytes[1]
    envelope_flags = struct.unpack_from("<H", body_bytes, 2)[0]
    request_id = struct.unpack_from("<I", body_bytes, 4)[0]
    payload_length = struct.unpack_from("<I", body_bytes, 8)[0]

    if payload_length + KIBO_DEVICE_PROTOCOL_V1_ENVELOPE_BYTE_LENGTH != body_byte_length:
        return KiboDeviceProtocolV1DecodeError(error_code="payload_length_inconsistent")

    if codec_id != KIBO_DEVICE_PROTOCOL_V1_CODEC_ID_JSON_UTF8:
        return KiboDeviceProtocolV1DecodeError(error_code="unsupported_codec_id", detail=str(codec_id))

    payload_utf8_bytes = body_bytes[KIBO_DEVICE_PROTOCOL_V1_ENVELOPE_BYTE_LENGTH :]

    return KiboDeviceProtocolV1DecodeOk(
        sequence=sequence,
        message_kind=message_kind,
        codec_id=codec_id,
        envelope_flags=envelope_flags,
        request_id=request_id,
        payload_utf8_bytes=payload_utf8_bytes,
    )


def compute_crc32_hex8_lower_from_utf8_bytes(payload_utf8_bytes: bytes) -> str:
    crc_value = compute_crc32_ieee_over_bytes(payload_utf8_bytes)
    return f"{crc_value:08x}"


class KiboDeviceProtocolV1OrderedChunkAssembler:
    """Guard: host-side ordered chunks with contiguous byte offsets (matches TS assembler)."""

    def __init__(self) -> None:
        self._phase = "idle"
        self._file_id: int | None = None
        self._total_byte_length: int | None = None
        self._whole_crc_hex_lower: str | None = None
        self._buffer: bytearray | None = None
        self._next_chunk_index = 0
        self._next_byte_offset = 0

    def begin_or_raise(self, *, file_id: int, total_byte_length: int, whole_payload_crc32_hex_lower: str) -> None:
        if total_byte_length < 0:
            raise ValueError("total_byte_length must be non-negative")
        if len(whole_payload_crc32_hex_lower) != 8:
            raise ValueError("whole_payload_crc32_hex_lower must be 8 hex chars")
        self._phase = "receiving"
        self._file_id = file_id
        self._total_byte_length = total_byte_length
        self._whole_crc_hex_lower = whole_payload_crc32_hex_lower.lower()
        self._buffer = bytearray(total_byte_length)
        self._next_chunk_index = 0
        self._next_byte_offset = 0

    def append_chunk_or_raise(
        self,
        *,
        file_id: int,
        chunk_index: int,
        byte_offset: int,
        chunk_crc32_hex_lower: str,
        chunk_payload_utf8_bytes: bytes,
    ) -> None:
        if self._phase != "receiving":
            raise RuntimeError("assembler not started")
        assert self._file_id is not None
        assert self._buffer is not None
        assert self._total_byte_length is not None

        if file_id != self._file_id:
            raise ValueError("file_id mismatch")
        if chunk_index != self._next_chunk_index:
            raise ValueError(f"chunkIndex out of order: expected {self._next_chunk_index} got {chunk_index}")
        if byte_offset != self._next_byte_offset:
            raise ValueError(f"byteOffset discontinuity: expected {self._next_byte_offset} got {byte_offset}")

        chunk_length = len(chunk_payload_utf8_bytes)
        if byte_offset + chunk_length > self._total_byte_length:
            raise ValueError("chunk overflows declared totalByteLength")

        expected_chunk_crc = chunk_crc32_hex_lower.lower()
        actual_chunk_crc = compute_crc32_hex8_lower_from_utf8_bytes(chunk_payload_utf8_bytes)
        if actual_chunk_crc != expected_chunk_crc:
            raise ValueError(f"chunk crc mismatch: expected {expected_chunk_crc} actual {actual_chunk_crc}")

        self._buffer[byte_offset : byte_offset + chunk_length] = chunk_payload_utf8_bytes
        self._next_chunk_index += 1
        self._next_byte_offset += chunk_length

    def commit_or_raise(self) -> bytes:
        if self._phase != "receiving":
            raise RuntimeError("assembler not started")
        assert self._buffer is not None
        assert self._total_byte_length is not None
        assert self._whole_crc_hex_lower is not None

        if self._next_byte_offset != self._total_byte_length:
            raise ValueError(f"incomplete file: filled {self._next_byte_offset} of {self._total_byte_length} bytes")

        whole_crc = compute_crc32_hex8_lower_from_utf8_bytes(bytes(self._buffer))
        if whole_crc != self._whole_crc_hex_lower:
            raise ValueError(f"whole crc mismatch: expected {self._whole_crc_hex_lower} actual {whole_crc}")

        result = bytes(self._buffer)
        self._phase = "idle"
        self._buffer = None
        self._file_id = None
        self._total_byte_length = None
        self._whole_crc_hex_lower = None
        self._next_chunk_index = 0
        self._next_byte_offset = 0
        return result


def build_json_utf8_payload_text_for_file_begin(
    *,
    file_id: int,
    kind: str,
    total_byte_length: int,
    whole_payload_crc32_hex_lower: str,
) -> bytes:
    text = json.dumps(
        {
            "fileId": file_id,
            "kind": kind,
            "totalByteLength": total_byte_length,
            "wholePayloadCrc32HexLower": whole_payload_crc32_hex_lower.lower(),
        },
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return text.encode("utf-8")


def build_json_utf8_payload_text_for_file_chunk(
    *,
    file_id: int,
    chunk_index: int,
    byte_offset: int,
    chunk_crc32_hex_lower: str,
    chunk_payload_utf8_bytes: bytes,
) -> bytes:
    payload_b64 = base64.standard_b64encode(chunk_payload_utf8_bytes).decode("ascii")
    text = json.dumps(
        {
            "fileId": file_id,
            "chunkIndex": chunk_index,
            "byteOffset": byte_offset,
            "chunkCrc32HexLower": chunk_crc32_hex_lower.lower(),
            "payloadBase64": payload_b64,
        },
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return text.encode("utf-8")


def build_json_utf8_payload_text_for_file_commit(*, file_id: int) -> bytes:
    return json.dumps({"fileId": file_id}, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def build_json_utf8_payload_text_for_run_package() -> bytes:
    return json.dumps({}, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
