// 責務: bytecode 移行の第 1 歩として、極小ヘッダ（magic + version + payload length）の encode / decode roundtrip を提供する。
//
// Guard: 本モジュールは spike 用。Pico ファームウェアへ載せる前に schema / versioning を設計レビューすること。

const KIBO_BYTECODE_SPIKE_MAGIC_UTF8_BYTES = new TextEncoder().encode("KIBOBC0");
const KIBO_BYTECODE_SPIKE_VERSION_UINT32 = 1;
const KIBO_BYTECODE_SPIKE_HEADER_BYTE_LENGTH =
  KIBO_BYTECODE_SPIKE_MAGIC_UTF8_BYTES.byteLength + 4 + 4;

export type KiboBytecodeSpikeHeader = {
  readonly version: number;
  readonly payloadByteLength: number;
};

export function encodeKiboBytecodeSpikePayloadToBytes(params: { readonly payloadUtf8Text: string }): Uint8Array {
  const payloadBytes = new TextEncoder().encode(params.payloadUtf8Text);
  const header = new ArrayBuffer(KIBO_BYTECODE_SPIKE_HEADER_BYTE_LENGTH);
  const view = new DataView(header);
  let offset = 0;
  new Uint8Array(header).set(KIBO_BYTECODE_SPIKE_MAGIC_UTF8_BYTES, offset);
  offset += KIBO_BYTECODE_SPIKE_MAGIC_UTF8_BYTES.byteLength;
  view.setUint32(offset, KIBO_BYTECODE_SPIKE_VERSION_UINT32, true);
  offset += 4;
  view.setUint32(offset, payloadBytes.byteLength, true);
  offset += 4;
  if (offset !== KIBO_BYTECODE_SPIKE_HEADER_BYTE_LENGTH) {
    throw new Error("Internal error: bytecode spike header length mismatch.");
  }
  const combined = new Uint8Array(KIBO_BYTECODE_SPIKE_HEADER_BYTE_LENGTH + payloadBytes.byteLength);
  combined.set(new Uint8Array(header), 0);
  combined.set(payloadBytes, KIBO_BYTECODE_SPIKE_HEADER_BYTE_LENGTH);
  return combined;
}

export function decodeKiboBytecodeSpikeBytesOrThrow(params: { readonly bytes: Uint8Array }): {
  readonly header: KiboBytecodeSpikeHeader;
  readonly payloadUtf8Text: string;
} {
  if (params.bytes.byteLength < KIBO_BYTECODE_SPIKE_HEADER_BYTE_LENGTH) {
    throw new Error("Bytecode spike: buffer too small for header.");
  }
  const magicActual = params.bytes.slice(0, KIBO_BYTECODE_SPIKE_MAGIC_UTF8_BYTES.byteLength);
  if (!magicActual.every((value, index) => value === KIBO_BYTECODE_SPIKE_MAGIC_UTF8_BYTES[index])) {
    throw new Error("Bytecode spike: magic mismatch.");
  }
  const view = new DataView(params.bytes.buffer, params.bytes.byteOffset, params.bytes.byteLength);
  let offset = KIBO_BYTECODE_SPIKE_MAGIC_UTF8_BYTES.byteLength;
  const version = view.getUint32(offset, true);
  offset += 4;
  const payloadLength = view.getUint32(offset, true);
  offset += 4;
  if (version !== KIBO_BYTECODE_SPIKE_VERSION_UINT32) {
    throw new Error(`Bytecode spike: unsupported version ${version}.`);
  }
  const expectedTotal = KIBO_BYTECODE_SPIKE_HEADER_BYTE_LENGTH + payloadLength;
  if (params.bytes.byteLength !== expectedTotal) {
    throw new Error(
      `Bytecode spike: length mismatch (actual ${params.bytes.byteLength}, expected ${expectedTotal}).`,
    );
  }
  const payloadBytes = params.bytes.slice(KIBO_BYTECODE_SPIKE_HEADER_BYTE_LENGTH);
  return {
    header: { version, payloadByteLength: payloadLength },
    payloadUtf8Text: new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes),
  };
}
