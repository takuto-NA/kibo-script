// 責務: ブラウザ Web Serial から Pico へ送る Kibo Device Protocol v1 の chunked `PicoRuntimePackage` 転送用フレーム列を組み立てる。
//
// Guard: ペイロード JSON キー順・CRC・wire layout は Python `upload_pico_runtime_package_via_device_protocol_v1.py` と一致させること。

import {
  build_json_utf8_payload_utf8_bytes_for_file_begin,
  build_json_utf8_payload_utf8_bytes_for_file_chunk,
  build_json_utf8_payload_utf8_bytes_for_file_commit,
  build_json_utf8_payload_utf8_bytes_for_run_package,
  compute_kibo_device_protocol_v1_crc32_hex8_lower_from_utf8_bytes,
  encode_kibo_device_protocol_v1_frame_or_throw,
  encode_utf8_json_text_to_uint8_array,
  KIBO_DEVICE_PROTOCOL_V1_ENVELOPE_BYTE_LENGTH,
  KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH,
  KiboDeviceProtocolV1MessageKind,
} from "../device-protocol/kibo-device-protocol-v1";

/** Python uploader `--chunk-utf8-bytes` の既定値と一致。 */
export const KIBO_DEVICE_PROTOCOL_V1_WEB_SERIAL_DEFAULT_CHUNK_RAW_UTF8_BYTE_LENGTH = 768;

const PICO_RUNTIME_PACKAGE_JSON_FILE_KIND_FOR_DEVICE_PROTOCOL_V1 = "pico_runtime_package_json_minified_utf8";

const WEB_SERIAL_UPLOAD_HOST_NAME_FOR_DEVICE_PROTOCOL_V1 = "kibo-browser-web-serial-device-protocol-v1";

export type KiboDeviceProtocolV1WebSerialUploadFrameBuildParams = Readonly<{
  minifiedPicoRuntimePackageUtf8Bytes: Uint8Array;
  chunkRawUtf8ByteLength: number;
  fileId: number;
  requestId: number;
  initialSequence: number;
}>;

/**
 * minified UTF-8 JSON bytes を `HELLO` → `FILE_BEGIN` → `FILE_CHUNK`* → `FILE_COMMIT` → `RUN_PACKAGE` の順で送るフレーム配列を返す。
 */
export function build_kibo_device_protocol_v1_web_serial_upload_frames_or_throw(
  params: KiboDeviceProtocolV1WebSerialUploadFrameBuildParams,
): readonly Uint8Array[] {
  if (params.chunkRawUtf8ByteLength < 1) {
    throw new Error("chunkRawUtf8ByteLength must be at least 1.");
  }

  const frames: Uint8Array[] = [];
  let sequence = params.initialSequence;

  const next_sequence = (): number => {
    sequence += 1;
    return sequence;
  };

  const hello_payload_json_text = JSON.stringify({
    hostProtocolVersion: 1,
    hostName: WEB_SERIAL_UPLOAD_HOST_NAME_FOR_DEVICE_PROTOCOL_V1,
  });
  frames.push(
    encode_kibo_device_protocol_v1_frame_or_throw({
      sequence: next_sequence(),
      requestId: params.requestId,
      messageKind: KiboDeviceProtocolV1MessageKind.HELLO,
      payloadUtf8Bytes: encode_utf8_json_text_to_uint8_array(hello_payload_json_text),
    }),
  );

  const whole_crc_hex_lower = compute_kibo_device_protocol_v1_crc32_hex8_lower_from_utf8_bytes(
    params.minifiedPicoRuntimePackageUtf8Bytes,
  );
  frames.push(
    encode_kibo_device_protocol_v1_frame_or_throw({
      sequence: next_sequence(),
      requestId: params.requestId,
      messageKind: KiboDeviceProtocolV1MessageKind.FILE_BEGIN,
      payloadUtf8Bytes: build_json_utf8_payload_utf8_bytes_for_file_begin({
        fileId: params.fileId,
        kind: PICO_RUNTIME_PACKAGE_JSON_FILE_KIND_FOR_DEVICE_PROTOCOL_V1,
        totalByteLength: params.minifiedPicoRuntimePackageUtf8Bytes.byteLength,
        wholePayloadCrc32HexLower: whole_crc_hex_lower,
      }),
    }),
  );

  let chunk_index = 0;
  let byte_offset = 0;
  const package_byte_length = params.minifiedPicoRuntimePackageUtf8Bytes.byteLength;
  while (byte_offset < package_byte_length) {
    const end_offset = Math.min(byte_offset + params.chunkRawUtf8ByteLength, package_byte_length);
    const chunk_payload_utf8_bytes = params.minifiedPicoRuntimePackageUtf8Bytes.subarray(byte_offset, end_offset);
    const chunk_crc_hex_lower = compute_kibo_device_protocol_v1_crc32_hex8_lower_from_utf8_bytes(chunk_payload_utf8_bytes);
    frames.push(
      encode_kibo_device_protocol_v1_frame_or_throw({
        sequence: next_sequence(),
        requestId: params.requestId,
        messageKind: KiboDeviceProtocolV1MessageKind.FILE_CHUNK,
        payloadUtf8Bytes: build_json_utf8_payload_utf8_bytes_for_file_chunk({
          fileId: params.fileId,
          chunkIndex: chunk_index,
          byteOffset: byte_offset,
          chunkCrc32HexLower: chunk_crc_hex_lower,
          chunkPayloadUtf8Bytes: chunk_payload_utf8_bytes,
        }),
      }),
    );
    byte_offset = end_offset;
    chunk_index += 1;
  }

  frames.push(
    encode_kibo_device_protocol_v1_frame_or_throw({
      sequence: next_sequence(),
      requestId: params.requestId,
      messageKind: KiboDeviceProtocolV1MessageKind.FILE_COMMIT,
      payloadUtf8Bytes: build_json_utf8_payload_utf8_bytes_for_file_commit({ fileId: params.fileId }),
    }),
  );

  frames.push(
    encode_kibo_device_protocol_v1_frame_or_throw({
      sequence: next_sequence(),
      requestId: params.requestId,
      messageKind: KiboDeviceProtocolV1MessageKind.RUN_PACKAGE,
      payloadUtf8Bytes: build_json_utf8_payload_utf8_bytes_for_run_package(),
    }),
  );

  return frames;
}

const KIBO_DEVICE_PROTOCOL_V1_RUN_PACKAGE_MESSAGE_KIND_BYTE = KiboDeviceProtocolV1MessageKind.RUN_PACKAGE & 0xff;

/** Guard: Playwright fake serial などが `RUN_PACKAGE` 完了を検知するための最小検査（完全 decode はしない）。 */
export function is_kibo_device_protocol_v1_run_package_frame_bytes(frame_bytes: Uint8Array): boolean {
  const minimum_frame_byte_length =
    KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH + KIBO_DEVICE_PROTOCOL_V1_ENVELOPE_BYTE_LENGTH + 4;
  if (frame_bytes.byteLength < minimum_frame_byte_length) {
    return false;
  }
  if (
    frame_bytes[0] !== 0x4b ||
    frame_bytes[1] !== 0x49 ||
    frame_bytes[2] !== 0x42 ||
    frame_bytes[3] !== 0x4f
  ) {
    return false;
  }
  const body_byte_length = new DataView(
    frame_bytes.buffer,
    frame_bytes.byteOffset + 12,
    4,
  ).getUint32(0, true);
  const expected_total_byte_length =
    KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH + body_byte_length + 4;
  if (frame_bytes.byteLength !== expected_total_byte_length) {
    return false;
  }
  return (
    frame_bytes[KIBO_DEVICE_PROTOCOL_V1_FRAME_HEADER_BYTE_LENGTH] === KIBO_DEVICE_PROTOCOL_V1_RUN_PACKAGE_MESSAGE_KIND_BYTE
  );
}

