import { describe, expect, it } from "vitest";
import {
  build_json_utf8_payload_utf8_bytes_for_file_begin,
  build_json_utf8_payload_utf8_bytes_for_file_chunk,
  decode_kibo_device_protocol_v1_frame,
  encode_kibo_device_protocol_v1_frame_or_throw,
  encode_utf8_json_text_to_uint8_array,
  KiboDeviceProtocolV1MessageKind,
  KiboDeviceProtocolV1OrderedChunkAssembler,
  compute_kibo_device_protocol_v1_crc32_hex8_lower_from_utf8_bytes,
} from "../../src/device-protocol/kibo-device-protocol-v1";

describe("kibo-device-protocol-v1", () => {
  // Guard: keep hex in sync with `scripts/pico/runtime_vertical_slice/tools/test_kibo_device_protocol_v1.py`.
  it("encode_matches_python_reference_vector", () => {
    const frame = encode_kibo_device_protocol_v1_frame_or_throw({
      sequence: 7,
      requestId: 9,
      messageKind: KiboDeviceProtocolV1MessageKind.PING,
      payloadUtf8Bytes: encode_utf8_json_text_to_uint8_array("{}"),
    });
    const expected_hex_lower =
      "4b49424f01000000070000000e00000087bf026f0300000009000000020000007b7d617b78fe";
    expect(Buffer.from(frame).toString("hex")).toBe(expected_hex_lower);
  });

  it("encode_decode_roundtrip_ping_payload", () => {
    const payload = encode_utf8_json_text_to_uint8_array("{}");
    const frame = encode_kibo_device_protocol_v1_frame_or_throw({
      sequence: 7,
      requestId: 9,
      messageKind: KiboDeviceProtocolV1MessageKind.PING,
      payloadUtf8Bytes: payload,
    });
    const decoded = decode_kibo_device_protocol_v1_frame(frame);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    expect(decoded.value.sequence).toBe(7);
    expect(decoded.value.requestId).toBe(9);
    expect(decoded.value.messageKind).toBe(KiboDeviceProtocolV1MessageKind.PING);
    expect(new TextDecoder().decode(decoded.value.payloadUtf8Bytes)).toBe("{}");
  });

  it("reject_header_crc_corruption", () => {
    const frame = encode_kibo_device_protocol_v1_frame_or_throw({
      sequence: 1,
      requestId: 2,
      messageKind: KiboDeviceProtocolV1MessageKind.PING,
      payloadUtf8Bytes: encode_utf8_json_text_to_uint8_array("{}"),
    });
    const corrupted = new Uint8Array(frame);
    corrupted[17] ^= 0xff;
    const decoded = decode_kibo_device_protocol_v1_frame(corrupted);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) {
      return;
    }
    expect(decoded.error.errorCode).toBe("header_crc_mismatch");
  });

  it("reject_body_crc_corruption", () => {
    const frame = encode_kibo_device_protocol_v1_frame_or_throw({
      sequence: 1,
      requestId: 2,
      messageKind: KiboDeviceProtocolV1MessageKind.PING,
      payloadUtf8Bytes: encode_utf8_json_text_to_uint8_array("{}"),
    });
    const corrupted = new Uint8Array(frame);
    corrupted[corrupted.length - 1] ^= 0xff;
    const decoded = decode_kibo_device_protocol_v1_frame(corrupted);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) {
      return;
    }
    expect(decoded.error.errorCode).toBe("body_crc_mismatch");
  });

  it("chunk_assembler_commit_matches_whole_crc", () => {
    const file_utf8 = encode_utf8_json_text_to_uint8_array('{"x":1}');
    const whole_crc = compute_kibo_device_protocol_v1_crc32_hex8_lower_from_utf8_bytes(file_utf8);
    const first = file_utf8.subarray(0, 3);
    const second = file_utf8.subarray(3);
    const first_crc = compute_kibo_device_protocol_v1_crc32_hex8_lower_from_utf8_bytes(first);
    const second_crc = compute_kibo_device_protocol_v1_crc32_hex8_lower_from_utf8_bytes(second);

    const assembler = new KiboDeviceProtocolV1OrderedChunkAssembler();
    assembler.begin_or_throw({
      fileId: 1,
      totalByteLength: file_utf8.byteLength,
      wholePayloadCrc32HexLower: whole_crc,
    });
    assembler.append_chunk_or_throw({
      fileId: 1,
      chunkIndex: 0,
      byteOffset: 0,
      chunkCrc32HexLower: first_crc,
      chunkPayloadUtf8Bytes: first,
    });
    assembler.append_chunk_or_throw({
      fileId: 1,
      chunkIndex: 1,
      byteOffset: first.byteLength,
      chunkCrc32HexLower: second_crc,
      chunkPayloadUtf8Bytes: second,
    });
    const committed = assembler.commit_or_throw();
    expect(new TextDecoder().decode(committed)).toBe('{"x":1}');
  });

  it("file_chunk_json_helpers_roundtrip_payload_fields", () => {
    const chunk_bytes = new Uint8Array([1, 2, 3]);
    const crc = compute_kibo_device_protocol_v1_crc32_hex8_lower_from_utf8_bytes(chunk_bytes);
    const payload_json = build_json_utf8_payload_utf8_bytes_for_file_chunk({
      fileId: 99,
      chunkIndex: 3,
      byteOffset: 12,
      chunkCrc32HexLower: crc,
      chunkPayloadUtf8Bytes: chunk_bytes,
    });
    const parsed = JSON.parse(new TextDecoder().decode(payload_json)) as {
      fileId: number;
      chunkIndex: number;
      byteOffset: number;
      chunkCrc32HexLower: string;
      payloadBase64: string;
    };
    expect(parsed.fileId).toBe(99);
    expect(parsed.chunkIndex).toBe(3);
    expect(parsed.byteOffset).toBe(12);
    expect(parsed.chunkCrc32HexLower).toBe(crc);

    const decoded_binary = Uint8Array.from(atob(parsed.payloadBase64), (character) => character.charCodeAt(0));
    expect(decoded_binary).toEqual(chunk_bytes);
  });

  it("file_begin_json_helper_contains_required_keys", () => {
    const payload_text_bytes = build_json_utf8_payload_utf8_bytes_for_file_begin({
      fileId: 5,
      kind: "pico_runtime_package_json_minified_utf8",
      totalByteLength: 100,
      wholePayloadCrc32HexLower: "aabbccdd",
    });
    const parsed = JSON.parse(new TextDecoder().decode(payload_text_bytes)) as Record<string, unknown>;
    expect(parsed.fileId).toBe(5);
    expect(parsed.kind).toBe("pico_runtime_package_json_minified_utf8");
    expect(parsed.totalByteLength).toBe(100);
    expect(parsed.wholePayloadCrc32HexLower).toBe("aabbccdd");
  });
});
