// 責務: Kibo Device Protocol v1 のバイナリフレームを TypeScript で encode/decode し、ホスト側の chunked file 組み立てを提供する。
//
// Guard: CRC32 は `kibo-kibo-pkg-wire-encoding.ts` と同一（C++ `kibo_crc32.hpp` / Python `zlib.crc32` と一致）。

import {
  compute_zlib_compatible_crc32_uint32_from_uint8_array,
  encode_uint8_array_to_base64_using_binary_chunks,
  format_crc32_uint32_as_lower_hex8,
} from "../runtime-conformance/kibo-kibo-pkg-wire-encoding";

export const KIBO_DEVICE_PROTOCOL_V1_MAGIC_UTF8 = "KIBO";

export const KIBO_DEVICE_PROTOCOL_V1_PROTOCOL_VERSION_U16 = 1;

/** magic(4) + protocol_version(2) + reserved(2) + sequence(4) + body_byte_length(4) + header_crc32(4) */
export const KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH = 20;

export const KIBO_DEVICE_PROTOCOL_V1_ENVELOPE_BYTE_LENGTH = 12;

/** codec_id: UTF-8 JSON text */
export const KIBO_DEVICE_PROTOCOL_V1_CODEC_ID_JSON_UTF8 = 0;

export enum KiboDeviceProtocolV1MessageKind {
  RESERVED = 0,
  HELLO = 1,
  CAPABILITIES = 2,
  PING = 3,
  PONG = 4,
  LOG = 5,
  TRACE = 6,
  ERROR = 7,
  FILE_BEGIN = 8,
  FILE_CHUNK = 9,
  FILE_COMMIT = 10,
  RUN_PACKAGE = 11,
}

export type KiboDeviceProtocolV1DecodeOk = Readonly<{
  sequence: number;
  messageKind: KiboDeviceProtocolV1MessageKind;
  codecId: number;
  envelopeFlags: number;
  requestId: number;
  payloadUtf8Bytes: Uint8Array;
}>;

export type KiboDeviceProtocolV1DecodeError = Readonly<{
  errorCode:
    | "frame_too_short"
    | "invalid_magic"
    | "unsupported_protocol_version"
    | "header_crc_mismatch"
    | "body_crc_mismatch"
    | "body_length_inconsistent"
    | "payload_length_inconsistent"
    | "unsupported_codec_id";
  detail?: string;
}>;

export type KiboDeviceProtocolV1DecodeResult =
  | Readonly<{ ok: true; value: KiboDeviceProtocolV1DecodeOk }>
  | Readonly<{ ok: false; error: KiboDeviceProtocolV1DecodeError }>;

const HEADER_CRC_BYTE_LENGTH = 16;

const TEXT_ENCODER = new TextEncoder();

function write_uint16_le(destination: Uint8Array, offset: number, value: number): void {
  new DataView(destination.buffer, destination.byteOffset + offset, 2).setUint16(0, value, true);
}

function write_uint32_le(destination: Uint8Array, offset: number, value: number): void {
  new DataView(destination.buffer, destination.byteOffset + offset, 4).setUint32(0, value >>> 0, true);
}

function read_uint16_le(source: Uint8Array, offset: number): number {
  return new DataView(source.buffer, source.byteOffset + offset, 2).getUint16(0, true);
}

function read_uint32_le(source: Uint8Array, offset: number): number {
  return new DataView(source.buffer, source.byteOffset + offset, 4).getUint32(0, true);
}

function compute_crc32_over_byte_slice(bytes: Uint8Array): number {
  return compute_zlib_compatible_crc32_uint32_from_uint8_array(bytes);
}

export function encode_utf8_json_text_to_uint8_array(json_text: string): Uint8Array {
  return TEXT_ENCODER.encode(json_text);
}

export function encode_kibo_device_protocol_v1_frame_or_throw(params: {
  sequence: number;
  requestId: number;
  messageKind: KiboDeviceProtocolV1MessageKind;
  payloadUtf8Bytes: Uint8Array;
  codecId?: number;
  envelopeFlags?: number;
}): Uint8Array {
  const codec_id = params.codecId ?? KIBO_DEVICE_PROTOCOL_V1_CODEC_ID_JSON_UTF8;
  if (codec_id !== KIBO_DEVICE_PROTOCOL_V1_CODEC_ID_JSON_UTF8) {
    throw new Error(`unsupported codec_id for encoder: ${codec_id}`);
  }

  const envelope_flags = params.envelopeFlags ?? 0;
  const payload_length = params.payloadUtf8Bytes.byteLength;
  const body_byte_length = KIBO_DEVICE_PROTOCOL_V1_ENVELOPE_BYTE_LENGTH + payload_length;

  const total_byte_length =
    KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH + body_byte_length + Uint32Array.BYTES_PER_ELEMENT;
  const frame = new Uint8Array(total_byte_length);

  let offset = 0;
  frame[offset] = KIBO_DEVICE_PROTOCOL_V1_MAGIC_UTF8.charCodeAt(0);
  frame[offset + 1] = KIBO_DEVICE_PROTOCOL_V1_MAGIC_UTF8.charCodeAt(1);
  frame[offset + 2] = KIBO_DEVICE_PROTOCOL_V1_MAGIC_UTF8.charCodeAt(2);
  frame[offset + 3] = KIBO_DEVICE_PROTOCOL_V1_MAGIC_UTF8.charCodeAt(3);
  offset += 4;

  write_uint16_le(frame, offset, KIBO_DEVICE_PROTOCOL_V1_PROTOCOL_VERSION_U16);
  offset += 2;
  write_uint16_le(frame, offset, 0);
  offset += 2;
  write_uint32_le(frame, offset, params.sequence);
  offset += 4;
  write_uint32_le(frame, offset, body_byte_length);
  offset += 4;

  const header_crc_placeholder_offset = offset;
  write_uint32_le(frame, header_crc_placeholder_offset, 0);
  offset += 4;

  const header_for_crc = frame.subarray(0, HEADER_CRC_BYTE_LENGTH);
  const header_crc32_value = compute_crc32_over_byte_slice(header_for_crc);
  write_uint32_le(frame, header_crc_placeholder_offset, header_crc32_value);

  frame[offset] = params.messageKind & 0xff;
  offset += 1;
  frame[offset] = codec_id & 0xff;
  offset += 1;
  write_uint16_le(frame, offset, envelope_flags);
  offset += 2;
  write_uint32_le(frame, offset, params.requestId);
  offset += 4;
  write_uint32_le(frame, offset, payload_length);
  offset += 4;

  frame.set(params.payloadUtf8Bytes, offset);
  offset += payload_length;

  const body_bytes = frame.subarray(
    KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH,
    KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH + body_byte_length,
  );
  const body_crc32_value = compute_crc32_over_byte_slice(body_bytes);
  write_uint32_le(frame, offset, body_crc32_value);

  return frame;
}

export function decode_kibo_device_protocol_v1_frame(frame_bytes: Uint8Array): KiboDeviceProtocolV1DecodeResult {
  const minimum_length =
    KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH +
    KIBO_DEVICE_PROTOCOL_V1_ENVELOPE_BYTE_LENGTH +
    Uint32Array.BYTES_PER_ELEMENT;
  if (frame_bytes.byteLength < minimum_length) {
    return { ok: false, error: { errorCode: "frame_too_short" } };
  }

  const magic_text = String.fromCharCode(frame_bytes[0] ?? 0, frame_bytes[1] ?? 0, frame_bytes[2] ?? 0, frame_bytes[3] ?? 0);
  if (magic_text !== KIBO_DEVICE_PROTOCOL_V1_MAGIC_UTF8) {
    return { ok: false, error: { errorCode: "invalid_magic", detail: magic_text } };
  }

  const protocol_version = read_uint16_le(frame_bytes, 4);
  if (protocol_version !== KIBO_DEVICE_PROTOCOL_V1_PROTOCOL_VERSION_U16) {
    return { ok: false, error: { errorCode: "unsupported_protocol_version", detail: String(protocol_version) } };
  }

  const header_for_crc = frame_bytes.subarray(0, HEADER_CRC_BYTE_LENGTH);
  const expected_header_crc = read_uint32_le(frame_bytes, 16);
  const actual_header_crc = compute_crc32_over_byte_slice(header_for_crc);
  if (actual_header_crc !== expected_header_crc) {
    return { ok: false, error: { errorCode: "header_crc_mismatch" } };
  }

  const body_byte_length = read_uint32_le(frame_bytes, 12);
  const expected_total_length =
    KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH + body_byte_length + Uint32Array.BYTES_PER_ELEMENT;
  if (frame_bytes.byteLength !== expected_total_length) {
    return {
      ok: false,
      error: {
        errorCode: "body_length_inconsistent",
        detail: `expected_total=${expected_total_length} actual=${frame_bytes.byteLength}`,
      },
    };
  }

  const body_bytes = frame_bytes.subarray(
    KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH,
    KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH + body_byte_length,
  );
  const expected_body_crc = read_uint32_le(frame_bytes, frame_bytes.byteLength - Uint32Array.BYTES_PER_ELEMENT);
  const actual_body_crc = compute_crc32_over_byte_slice(body_bytes);
  if (actual_body_crc !== expected_body_crc) {
    return { ok: false, error: { errorCode: "body_crc_mismatch" } };
  }

  const message_kind = body_bytes[0] ?? 0;
  const codec_id = body_bytes[1] ?? 0;
  const envelope_flags = read_uint16_le(body_bytes, 2);
  const request_id = read_uint32_le(body_bytes, 4);
  const payload_length = read_uint32_le(body_bytes, 8);
  if (payload_length + KIBO_DEVICE_PROTOCOL_V1_ENVELOPE_BYTE_LENGTH !== body_byte_length) {
    return { ok: false, error: { errorCode: "payload_length_inconsistent" } };
  }

  if (codec_id !== KIBO_DEVICE_PROTOCOL_V1_CODEC_ID_JSON_UTF8) {
    return { ok: false, error: { errorCode: "unsupported_codec_id", detail: String(codec_id) } };
  }

  const payload_utf8_bytes = body_bytes.subarray(KIBO_DEVICE_PROTOCOL_V1_ENVELOPE_BYTE_LENGTH);

  return {
    ok: true,
    value: {
      sequence: read_uint32_le(frame_bytes, 8),
      messageKind: message_kind as KiboDeviceProtocolV1MessageKind,
      codecId: codec_id,
      envelopeFlags: envelope_flags,
      requestId: request_id,
      payloadUtf8Bytes: payload_utf8_bytes,
    },
  };
}

export function compute_kibo_device_protocol_v1_crc32_hex8_lower_from_utf8_bytes(payload_utf8_bytes: Uint8Array): string {
  const crc32_value = compute_crc32_over_byte_slice(payload_utf8_bytes);
  return format_crc32_uint32_as_lower_hex8(crc32_value);
}

export type KiboDeviceProtocolV1ChunkAssemblerState =
  | Readonly<{ phase: "idle" }>
  | {
      phase: "receiving";
      fileId: number;
      totalByteLength: number;
      wholePayloadCrc32HexLower: string;
      receivedBytes: Uint8Array;
      nextExpectedChunkIndex: number;
      nextExpectedByteOffset: number;
    };

/** Guard: ホスト側テストと送信ツール向け。`chunkIndex` は 0 からの連番、`byteOffset` は連続領域であること。 */
export class KiboDeviceProtocolV1OrderedChunkAssembler {
  private state: KiboDeviceProtocolV1ChunkAssemblerState = { phase: "idle" };

  public begin_or_throw(params: {
    fileId: number;
    totalByteLength: number;
    wholePayloadCrc32HexLower: string;
  }): void {
    if (params.totalByteLength < 0) {
      throw new Error("totalByteLength must be non-negative");
    }
    if (params.wholePayloadCrc32HexLower.length !== 8) {
      throw new Error("wholePayloadCrc32HexLower must be 8 hex chars");
    }
    this.state = {
      phase: "receiving",
      fileId: params.fileId,
      totalByteLength: params.totalByteLength,
      wholePayloadCrc32HexLower: params.wholePayloadCrc32HexLower.toLowerCase(),
      receivedBytes: new Uint8Array(params.totalByteLength),
      nextExpectedChunkIndex: 0,
      nextExpectedByteOffset: 0,
    };
  }

  public append_chunk_or_throw(params: {
    fileId: number;
    chunkIndex: number;
    byteOffset: number;
    chunkCrc32HexLower: string;
    chunkPayloadUtf8Bytes: Uint8Array;
  }): void {
    if (this.state.phase !== "receiving") {
      throw new Error("assembler not started");
    }
    if (params.fileId !== this.state.fileId) {
      throw new Error("fileId mismatch");
    }
    if (params.chunkIndex !== this.state.nextExpectedChunkIndex) {
      throw new Error(
        `chunkIndex out of order: expected ${this.state.nextExpectedChunkIndex} got ${params.chunkIndex}`,
      );
    }

    const chunk_length = params.chunkPayloadUtf8Bytes.byteLength;
    if (params.byteOffset !== this.state.nextExpectedByteOffset) {
      throw new Error(
        `byteOffset discontinuity: expected ${this.state.nextExpectedByteOffset} got ${params.byteOffset}`,
      );
    }
    if (params.byteOffset + chunk_length > this.state.totalByteLength) {
      throw new Error("chunk overflows declared totalByteLength");
    }

    const expected_chunk_crc = params.chunkCrc32HexLower.toLowerCase();
    const actual_chunk_crc = compute_kibo_device_protocol_v1_crc32_hex8_lower_from_utf8_bytes(params.chunkPayloadUtf8Bytes);
    if (actual_chunk_crc !== expected_chunk_crc) {
      throw new Error(`chunk crc mismatch: expected ${expected_chunk_crc} actual ${actual_chunk_crc}`);
    }

    this.state.receivedBytes.set(params.chunkPayloadUtf8Bytes, params.byteOffset);
    this.state.nextExpectedChunkIndex += 1;
    this.state.nextExpectedByteOffset += chunk_length;
  }

  public commit_or_throw(): Uint8Array {
    if (this.state.phase !== "receiving") {
      throw new Error("assembler not started");
    }

    if (this.state.nextExpectedByteOffset !== this.state.totalByteLength) {
      throw new Error(
        `incomplete file: filled ${this.state.nextExpectedByteOffset} of ${this.state.totalByteLength} bytes`,
      );
    }

    const whole_crc = compute_kibo_device_protocol_v1_crc32_hex8_lower_from_utf8_bytes(this.state.receivedBytes);
    if (whole_crc !== this.state.wholePayloadCrc32HexLower) {
      throw new Error(`whole crc mismatch: expected ${this.state.wholePayloadCrc32HexLower} actual ${whole_crc}`);
    }

    const result = this.state.receivedBytes;
    this.state = { phase: "idle" };
    return result;
  }
}

export function build_json_utf8_payload_utf8_bytes_for_file_begin(params: {
  fileId: number;
  kind: string;
  totalByteLength: number;
  wholePayloadCrc32HexLower: string;
}): Uint8Array {
  const json_text = JSON.stringify({
    fileId: params.fileId,
    kind: params.kind,
    totalByteLength: params.totalByteLength,
    wholePayloadCrc32HexLower: params.wholePayloadCrc32HexLower.toLowerCase(),
  });
  return TEXT_ENCODER.encode(json_text);
}

export function build_json_utf8_payload_utf8_bytes_for_file_chunk(params: {
  fileId: number;
  chunkIndex: number;
  byteOffset: number;
  chunkCrc32HexLower: string;
  chunkPayloadUtf8Bytes: Uint8Array;
}): Uint8Array {
  const payload_base64 = encode_uint8_array_to_base64_using_binary_chunks(params.chunkPayloadUtf8Bytes);
  const json_text = JSON.stringify({
    fileId: params.fileId,
    chunkIndex: params.chunkIndex,
    byteOffset: params.byteOffset,
    chunkCrc32HexLower: params.chunkCrc32HexLower.toLowerCase(),
    payloadBase64: payload_base64,
  });
  return TEXT_ENCODER.encode(json_text);
}

export function build_json_utf8_payload_utf8_bytes_for_file_commit(params: { fileId: number }): Uint8Array {
  return TEXT_ENCODER.encode(JSON.stringify({ fileId: params.fileId }));
}

export function build_json_utf8_payload_utf8_bytes_for_run_package(): Uint8Array {
  return TEXT_ENCODER.encode(JSON.stringify({}));
}
