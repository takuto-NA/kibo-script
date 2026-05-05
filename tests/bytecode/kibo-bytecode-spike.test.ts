// 責務: bytecode spike encoder / decoder の roundtrip を固定する。

import { describe, expect, it } from "vitest";
import {
  decodeKiboBytecodeSpikeBytesOrThrow,
  encodeKiboBytecodeSpikePayloadToBytes,
} from "../../src/bytecode/kibo-bytecode-spike";

describe("kibo-bytecode-spike", () => {
  it("roundtrips utf-8 payload", () => {
    const original = "hello 世界";
    const bytes = encodeKiboBytecodeSpikePayloadToBytes({ payloadUtf8Text: original });
    const decoded = decodeKiboBytecodeSpikeBytesOrThrow({ bytes });
    expect(decoded.payloadUtf8Text).toBe(original);
    expect(decoded.header.version).toBe(1);
  });

  it("decodes when bytes are a subview of a larger ArrayBuffer (byteOffset non-zero)", () => {
    const original = "subview";
    const encoded = encodeKiboBytecodeSpikePayloadToBytes({ payloadUtf8Text: original });
    const prefixLength = 16;
    const combined = new Uint8Array(prefixLength + encoded.byteLength);
    combined.set(encoded, prefixLength);
    const subview = combined.subarray(prefixLength);
    const decoded = decodeKiboBytecodeSpikeBytesOrThrow({ bytes: subview });
    expect(decoded.payloadUtf8Text).toBe(original);
  });
});
