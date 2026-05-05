# pyright: reportMissingImports=false
"""
Responsibility: unit tests for `kibo_device_protocol_v1.py` (host-only, no hardware).

Guard: golden frame bytes must stay aligned with TypeScript `encode_kibo_device_protocol_v1_frame_or_throw`.
"""

from __future__ import annotations

import unittest

import kibo_device_protocol_v1 as kdp


class KiboDeviceProtocolV1Test(unittest.TestCase):
    def test_encode_decode_roundtrip_ping(self) -> None:
        payload = b"{}"
        frame = kdp.encode_kibo_device_protocol_v1_frame_or_raise(
            sequence=7,
            request_id=9,
            message_kind=kdp.KiboDeviceProtocolV1MessageKind.PING,
            payload_utf8_bytes=payload,
        )
        decoded = kdp.decode_kibo_device_protocol_v1_frame(frame)
        self.assertIsInstance(decoded, kdp.KiboDeviceProtocolV1DecodeOk)
        assert isinstance(decoded, kdp.KiboDeviceProtocolV1DecodeOk)
        self.assertEqual(decoded.sequence, 7)
        self.assertEqual(decoded.request_id, 9)
        self.assertEqual(decoded.message_kind, int(kdp.KiboDeviceProtocolV1MessageKind.PING))
        self.assertEqual(decoded.payload_utf8_bytes, payload)

    def test_encode_matches_typescript_reference_vector(self) -> None:
        """Guard: Update this hex if wire format intentionally changes; sync with TS tests."""
        frame = kdp.encode_kibo_device_protocol_v1_frame_or_raise(
            sequence=7,
            request_id=9,
            message_kind=kdp.KiboDeviceProtocolV1MessageKind.PING,
            payload_utf8_bytes=b"{}",
        )
        expected_hex = (
            "4b49424f01000000070000000e00000087bf026f0300000009000000020000007b7d617b78fe"
        )
        self.assertEqual(frame.hex(), expected_hex)

    def test_chunk_assembler_matches_whole_crc(self) -> None:
        file_utf8 = b'{"x":1}'
        whole_crc = kdp.compute_crc32_hex8_lower_from_utf8_bytes(file_utf8)
        first = file_utf8[0:3]
        second = file_utf8[3:]
        assembler = kdp.KiboDeviceProtocolV1OrderedChunkAssembler()
        assembler.begin_or_raise(file_id=1, total_byte_length=len(file_utf8), whole_payload_crc32_hex_lower=whole_crc)
        assembler.append_chunk_or_raise(
            file_id=1,
            chunk_index=0,
            byte_offset=0,
            chunk_crc32_hex_lower=kdp.compute_crc32_hex8_lower_from_utf8_bytes(first),
            chunk_payload_utf8_bytes=first,
        )
        assembler.append_chunk_or_raise(
            file_id=1,
            chunk_index=1,
            byte_offset=len(first),
            chunk_crc32_hex_lower=kdp.compute_crc32_hex8_lower_from_utf8_bytes(second),
            chunk_payload_utf8_bytes=second,
        )
        committed = assembler.commit_or_raise()
        self.assertEqual(committed, file_utf8)


if __name__ == "__main__":
    unittest.main()
