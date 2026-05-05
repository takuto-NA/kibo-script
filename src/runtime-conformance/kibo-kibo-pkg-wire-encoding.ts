// 責務: `KIBO_PKG schema=1 bytes=<n> crc32=<hex> b64=<payload>` 行向けの CRC32（zlib `crc32` と同じ多項式・初期値）と Base64 を、ブラウザと Node で同一結果になるよう提供する。
//
// Guard: Python `zlib.crc32` / `pico_link_common.build_kibo_pkg_serial_line_from_utf8_json_bytes` と一致させること。

const CRC32_POLYNOMIAL = 0xedb88320;
const CRC32_INITIAL_VALUE = 0xffffffff;
const CRC32_FINAL_XOR_VALUE = 0xffffffff;
const CRC32_BITS_PER_BYTE = 8;
const BYTE_VALUE_MASK = 0xff;
const BASE64_BINARY_CHUNK_SIZE_BYTES = 0x8000;
const CRC32_HEX_DIGIT_COUNT = 8;
const HEX_RADIX = 16;

function build_crc32_table(): readonly number[] {
  const table: number[] = [];
  for (let byte = 0; byte <= BYTE_VALUE_MASK; byte += 1) {
    let crc = byte;
    for (let bit_index = 0; bit_index < CRC32_BITS_PER_BYTE; bit_index += 1) {
      const least_significant_bit_is_set = (crc & 1) === 1;
      crc = least_significant_bit_is_set ? (crc >>> 1) ^ CRC32_POLYNOMIAL : crc >>> 1;
    }
    table.push(crc >>> 0);
  }
  return table;
}

const CRC32_TABLE = build_crc32_table();

/** zlib / Node `crc32` と同じ 32bit 結果（unsigned）。 */
export function compute_zlib_compatible_crc32_uint32_from_uint8_array(bytes: Uint8Array): number {
  let crc = CRC32_INITIAL_VALUE;
  for (const byte of bytes) {
    const table_index = (crc ^ byte) & BYTE_VALUE_MASK;
    crc = (crc >>> 8) ^ (CRC32_TABLE[table_index] ?? 0);
  }
  return (crc ^ CRC32_FINAL_XOR_VALUE) >>> 0;
}

export function format_crc32_uint32_as_lower_hex8(crc32_value: number): string {
  return crc32_value.toString(HEX_RADIX).padStart(CRC32_HEX_DIGIT_COUNT, "0");
}

/** `btoa` 向けに大きなバイト列をチャンク化して連結する（スタックオーバーフロー回避）。 */
export function encode_uint8_array_to_base64_using_binary_chunks(bytes: Uint8Array): string {
  let binary_text = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_BINARY_CHUNK_SIZE_BYTES) {
    const chunk = bytes.subarray(offset, offset + BASE64_BINARY_CHUNK_SIZE_BYTES);
    binary_text += String.fromCharCode(...chunk);
  }
  return btoa(binary_text);
}

/** 末尾改行なしの 1 行（シリアル送信側で `\n` を付与する想定）。 */
export function build_kibo_pkg_schema1_serial_line_text_without_newline_from_minified_utf8_bytes(
  minified_utf8_bytes: Uint8Array,
): string {
  const byte_length = minified_utf8_bytes.byteLength;
  const crc32_value = compute_zlib_compatible_crc32_uint32_from_uint8_array(minified_utf8_bytes);
  const crc32_text = format_crc32_uint32_as_lower_hex8(crc32_value);
  const base64_payload = encode_uint8_array_to_base64_using_binary_chunks(minified_utf8_bytes);
  return `KIBO_PKG schema=1 bytes=${byte_length} crc32=${crc32_text} b64=${base64_payload}`;
}
