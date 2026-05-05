// 責務: Raspberry Pi Pico 上で `PicoRuntimePackage`（runtime IR + replay + trace 観測 + live tick）を実行し、USB Serial に conformance trace を出しつつ SSD1306 に反映する最小縦断（vertical slice）。
//
// 注意:
// - ピン配線は `docs/pico-bringup.md` の OLED / onboard LED メモに合わせる。
// - 既定 package は `include/embedded_default_pico_runtime_package.hpp` を正とする（golden と同期）。
// - USB Serial の `KIBO_PING` で loader handshake（`kibo_loader status=ok protocol=1 ...`）を返す。
// - USB Serial の `KIBO_PKG ...` 1 行 frame で package を差し替えられる（開発用）。
// - USB Serial のバイトストリームで Kibo Device Protocol v1（`docs/kibo-device-protocol-roadmap.md`）を受理する。

#include <Arduino.h>
#include <Wire.h>

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#include <array>
#include <climits>
#include <cctype>
#include <cstring>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <memory>
#include <nlohmann/json.hpp>
#include <string>
#include <vector>

#include "embedded_default_pico_runtime_package.hpp"
#include "kibo_base64_decode.hpp"
#include "kibo_crc32.hpp"
#include "kibo_device_protocol_v1.hpp"
#include "kibo_pico_runtime_package_storage_limits.hpp"
#include "kibo_device_protocol_v1_serial_ingress.hpp"
#include "kibo_host_runtime.hpp"
#include "kibo_json_read_integer.hpp"
#include "kibo_runtime_replay_runner.hpp"

namespace {

constexpr int k_oled_screen_width_pixels = 128;
constexpr int k_oled_screen_height_pixels = 64;
constexpr int k_oled_i2c_sda_pin = 16;
constexpr int k_oled_i2c_scl_pin = 17;
constexpr uint8_t k_oled_i2c_address_seven_bit = 0x3C;
constexpr unsigned long k_trace_replay_repeat_interval_milliseconds = 5000;
constexpr unsigned long k_button_state_log_interval_milliseconds = 1000;
constexpr unsigned long k_button_event_poll_interval_milliseconds = 10;
constexpr unsigned long k_button_debounce_milliseconds = 30;
constexpr unsigned long k_live_animation_reset_interval_milliseconds = 3200;

constexpr int k_onboard_led_pin = LED_BUILTIN;
constexpr int k_button_pressed_raw_level = LOW;
constexpr int k_button_released_raw_level = HIGH;
constexpr const char* k_button_pressed_event_name = "pressed";
constexpr const char* k_button_device_kind_name = "button";
constexpr std::array<int, 5> k_button_gpio_pins_by_device_id = {18, 19, 20, 21, 22};

constexpr std::size_t k_max_serial_line_characters = 16384;
constexpr std::size_t k_max_decoded_package_bytes =
    kibo::pico::runtime_package::k_max_minified_utf8_byte_length_for_vertical_slice;

constexpr std::size_t k_max_kibo_device_protocol_v1_binary_frame_byte_length =
    kibo::device_protocol::v1::k_frame_header_byte_length +
    kibo::device_protocol::v1::k_max_body_byte_length_vertical_slice + 4;

// Host tools (`pico_link_doctor`, uploader preflight) use this to distinguish loader-capable firmware from older builds.
constexpr int k_kibo_loader_protocol_version = 1;
constexpr const char* k_serial_ping_command_line = "KIBO_PING";

constexpr const char* k_boot_fixture_name_for_default_embedded_package = "circle-animation";

Adafruit_SSD1306 g_oled_display(
    k_oled_screen_width_pixels,
    k_oled_screen_height_pixels,
    &Wire,
    -1
);

unsigned long g_last_trace_replay_milliseconds = 0;
unsigned long g_last_button_state_log_milliseconds = 0;
unsigned long g_last_button_event_poll_milliseconds = 0;
unsigned long g_last_live_animation_tick_milliseconds = 0;
unsigned long g_live_animation_started_milliseconds = 0;
std::array<int, k_button_gpio_pins_by_device_id.size()> g_last_button_raw_levels{};
std::array<int, k_button_gpio_pins_by_device_id.size()> g_stable_button_raw_levels{};
std::array<unsigned long, k_button_gpio_pins_by_device_id.size()> g_last_button_raw_change_milliseconds{};

nlohmann::json g_active_pico_runtime_package_json;
int g_live_tick_interval_milliseconds = 100;
bool g_live_runtime_periodic_reset_enabled = true;
std::string g_boot_fixture_name_text = k_boot_fixture_name_for_default_embedded_package;
std::unique_ptr<kibo::runtime::KiboHostRuntime> g_live_animation_runtime;

KiboDeviceProtocolV1UsbSerialIngress g_kibo_device_protocol_v1_usb_serial_ingress(
    k_max_serial_line_characters,
    k_max_kibo_device_protocol_v1_binary_frame_byte_length);

struct FileReceiveSessionForDeviceProtocolV1 {
  bool active = false;
  std::uint32_t file_id = 0;
  std::uint32_t total_byte_length = 0;
  std::uint32_t whole_crc32 = 0;
  std::vector<std::uint8_t> buffer{};
  std::uint32_t next_expected_chunk_index = 0;
  std::uint32_t next_expected_byte_offset = 0;
};

FileReceiveSessionForDeviceProtocolV1 g_file_receive_session_for_device_protocol_v1{};
std::vector<std::uint8_t> g_staged_pico_runtime_package_utf8_bytes{};
bool g_has_staged_pico_runtime_package_utf8_bytes = false;

// Earle Philhower Arduino-Pico の `rp2040` でヒープ統計を取り、USB Serial に `diag=ram_probe` の trace 1 行を出す（RAM 余裕のフェーズ別観測用）。
int g_ram_probe_watermark_min_free_heap_bytes = INT_MAX;

void emit_ram_diagnostic_heap_probe_trace_line(const char* phase_text) {
  const int free_heap_bytes = rp2040.getFreeHeap();
  const int used_heap_bytes = rp2040.getUsedHeap();
  const int total_heap_bytes = rp2040.getTotalHeap();
  if (free_heap_bytes < g_ram_probe_watermark_min_free_heap_bytes) {
    g_ram_probe_watermark_min_free_heap_bytes = free_heap_bytes;
  }
  Serial.print("trace schema=1 diag=ram_probe phase=");
  Serial.print(phase_text);
  Serial.print(" free_heap=");
  Serial.print(free_heap_bytes);
  Serial.print(" used_heap=");
  Serial.print(used_heap_bytes);
  Serial.print(" total_heap=");
  Serial.print(total_heap_bytes);
  Serial.print(" min_free_heap=");
  Serial.println(g_ram_probe_watermark_min_free_heap_bytes);
}

void render_presented_framebuffer_pixels_to_oled_or_ignore(const kibo::runtime::KiboHostRuntime& host_runtime) {
  g_oled_display.clearDisplay();
  const auto& presented_pixels = host_runtime.presented_framebuffer_pixels();
  for (int y_pixel = 0; y_pixel < k_oled_screen_height_pixels; y_pixel += 1) {
    for (int x_pixel = 0; x_pixel < k_oled_screen_width_pixels; x_pixel += 1) {
      const std::size_t pixel_index =
          static_cast<std::size_t>(y_pixel * k_oled_screen_width_pixels + x_pixel);
      const bool is_pixel_on = presented_pixels.at(pixel_index) != 0;
      if (!is_pixel_on) {
        continue;
      }
      g_oled_display.drawPixel(x_pixel, y_pixel, SSD1306_WHITE);
    }
  }
  g_oled_display.display();
}

void apply_onboard_led_visual_from_host_runtime_or_ignore(const kibo::runtime::KiboHostRuntime& host_runtime) {
  const bool is_led_light_on = host_runtime.is_led0_light_on();
  digitalWrite(k_onboard_led_pin, is_led_light_on ? HIGH : LOW);
}

void render_outputs_from_live_runtime_or_ignore() {
  if (!g_live_animation_runtime) {
    return;
  }
  apply_onboard_led_visual_from_host_runtime_or_ignore(*g_live_animation_runtime);
  render_presented_framebuffer_pixels_to_oled_or_ignore(*g_live_animation_runtime);
}

nlohmann::json build_runtime_conformance_replay_document_from_active_pico_runtime_package_or_throw() {
  nlohmann::json replay_document;
  replay_document["replaySchemaVersion"] = 1;
  replay_document["runtimeIrContract"] = g_active_pico_runtime_package_json.at("runtimeIrContract");
  replay_document["traceObservation"] = g_active_pico_runtime_package_json.at("traceObservation");
  replay_document["steps"] = g_active_pico_runtime_package_json.at("replay").at("steps");
  return replay_document;
}

void emit_trace_lines_from_active_package_replay_or_log_exception() {
  try {
    const nlohmann::json replay_document = build_runtime_conformance_replay_document_from_active_pico_runtime_package_or_throw();
    kibo::runtime::run_runtime_conformance_replay_document(replay_document, [](const std::string& trace_line) {
      Serial.println(trace_line.c_str());
    });
  } catch (const std::exception& exception) {
    Serial.print("trace schema=1 diag=replay_exception msg=");
    Serial.println(exception.what());
  }
}

void reset_live_animation_runtime_from_active_package_or_log_exception() {
  try {
    const nlohmann::json& runtime_ir_contract = g_active_pico_runtime_package_json.at("runtimeIrContract");
    g_live_animation_runtime = std::make_unique<kibo::runtime::KiboHostRuntime>(runtime_ir_contract);
    g_live_animation_started_milliseconds = millis();
    g_last_live_animation_tick_milliseconds = millis();
    render_outputs_from_live_runtime_or_ignore();
    Serial.print("kibo_pico_vertical_slice_live_animation_reset fixture=");
    Serial.println(g_boot_fixture_name_text.c_str());
  } catch (const std::exception& exception) {
    Serial.print("trace schema=1 diag=live_runtime_reset_exception msg=");
    Serial.println(exception.what());
  }
}

void read_live_tick_interval_milliseconds_from_active_package_or_use_default() {
  constexpr int k_default_live_tick_interval_milliseconds = 100;
  constexpr int k_minimum_live_tick_interval_milliseconds = 1;

  const auto iterator = g_active_pico_runtime_package_json.find("live");
  if (iterator == g_active_pico_runtime_package_json.end()) {
    g_live_tick_interval_milliseconds = k_default_live_tick_interval_milliseconds;
    return;
  }
  const auto& live_object = *iterator;
  if (!live_object.is_object()) {
    g_live_tick_interval_milliseconds = k_default_live_tick_interval_milliseconds;
    return;
  }
  if (!live_object.contains("tickIntervalMilliseconds")) {
    g_live_tick_interval_milliseconds = k_default_live_tick_interval_milliseconds;
    return;
  }
  int tick_interval_milliseconds =
      kibo::runtime::read_json_number_as_int_or_throw(live_object.at("tickIntervalMilliseconds"));
  // Guard: non-positive tick would break unsigned interval comparisons in the main loop.
  if (tick_interval_milliseconds < k_minimum_live_tick_interval_milliseconds) {
    tick_interval_milliseconds = k_default_live_tick_interval_milliseconds;
  }
  g_live_tick_interval_milliseconds = tick_interval_milliseconds;
}

void tick_live_animation_if_due(unsigned long now_milliseconds) {
  if (!g_live_animation_runtime) {
    reset_live_animation_runtime_from_active_package_or_log_exception();
    return;
  }

  if (
      g_live_runtime_periodic_reset_enabled &&
      now_milliseconds - g_live_animation_started_milliseconds >= k_live_animation_reset_interval_milliseconds) {
    reset_live_animation_runtime_from_active_package_or_log_exception();
    return;
  }

  if (now_milliseconds - g_last_live_animation_tick_milliseconds <
      static_cast<unsigned long>(g_live_tick_interval_milliseconds)) {
    return;
  }

  g_live_animation_runtime->tick_milliseconds(g_live_tick_interval_milliseconds);
  render_outputs_from_live_runtime_or_ignore();
  g_last_live_animation_tick_milliseconds = now_milliseconds;
}

bool parse_hex_uint32_from_text_or_false(const std::string& hex_text, std::uint32_t& out_value) {
  if (hex_text.size() != 8) {
    return false;
  }
  std::uint32_t value = 0;
  for (char character : hex_text) {
    value <<= 4U;
    if (character >= '0' && character <= '9') {
      value += static_cast<std::uint32_t>(character - '0');
      continue;
    }
    if (character >= 'a' && character <= 'f') {
      value += static_cast<std::uint32_t>(character - 'a' + 10);
      continue;
    }
    if (character >= 'A' && character <= 'F') {
      value += static_cast<std::uint32_t>(character - 'A' + 10);
      continue;
    }
    return false;
  }
  out_value = value;
  return true;
}

bool parse_kibo_pkg_meta_key_values_or_false(
    const std::string& meta_text,
    int& out_schema_version,
    std::size_t& out_byte_count,
    std::uint32_t& out_crc32
) {
  out_schema_version = 0;
  out_byte_count = 0;
  out_crc32 = 0;

  std::vector<std::string> tokens;
  {
    std::string current_token;
    for (char character : meta_text) {
      if (character == ' ') {
        if (!current_token.empty()) {
          tokens.push_back(current_token);
          current_token.clear();
        }
        continue;
      }
      current_token.push_back(character);
    }
    if (!current_token.empty()) {
      tokens.push_back(current_token);
    }
  }

  if (tokens.size() < 4) {
    return false;
  }
  if (tokens[0] != "KIBO_PKG") {
    return false;
  }

  try {
    for (std::size_t token_index = 1; token_index < tokens.size(); token_index += 1) {
      const std::string& token = tokens[token_index];
      const std::size_t equals_index = token.find('=');
      if (equals_index == std::string::npos) {
        return false;
      }
      const std::string key = token.substr(0, equals_index);
      const std::string value = token.substr(equals_index + 1);
      if (key == "schema") {
        out_schema_version = std::stoi(value);
        continue;
      }
      if (key == "bytes") {
        out_byte_count = static_cast<std::size_t>(std::stoull(value));
        continue;
      }
      if (key == "crc32") {
        if (!parse_hex_uint32_from_text_or_false(value, out_crc32)) {
          return false;
        }
        continue;
      }
    }
  } catch (const std::exception&) {
    return false;
  }

  return out_schema_version == 1 && out_byte_count > 0;
}

void emit_kibo_pkg_ack_line(const char* status_text, const char* reason_text) {
  Serial.print("kibo_pkg_ack status=");
  Serial.print(status_text);
  if (reason_text != nullptr && reason_text[0] != '\0') {
    Serial.print(" reason=");
    Serial.print(reason_text);
  }
  Serial.println();
}

void write_usb_serial_bytes_from_vector(const std::vector<std::uint8_t>& bytes) {
  Serial.write(bytes.data(), bytes.size());
}

void emit_device_protocol_v1_json_payload_frame_or_ignore(
    std::uint32_t sequence,
    std::uint32_t request_id,
    kibo::device_protocol::v1::MessageKind message_kind,
    const nlohmann::json& payload_json_object
) {
  try {
    const std::string dumped_json_text = payload_json_object.dump();
    std::vector<std::uint8_t> payload_utf8_bytes(dumped_json_text.begin(), dumped_json_text.end());
    const std::vector<std::uint8_t> frame_bytes =
        kibo::device_protocol::v1::encode_kibo_device_protocol_v1_frame_or_throw(
            sequence,
            request_id,
            message_kind,
            payload_utf8_bytes);
    write_usb_serial_bytes_from_vector(frame_bytes);
  } catch (const std::exception& exception) {
    Serial.print("trace schema=1 diag=kibo_device_protocol_v1_encode_failed msg=");
    Serial.println(exception.what());
  }
}

void emit_device_protocol_v1_error_payload_frame_or_ignore(
    std::uint32_t sequence,
    std::uint32_t request_id,
    const char* error_code_text,
    const char* human_message_text
) {
  nlohmann::json payload_json_object;
  payload_json_object["code"] = error_code_text;
  payload_json_object["message"] = human_message_text;
  emit_device_protocol_v1_json_payload_frame_or_ignore(
      sequence,
      request_id,
      kibo::device_protocol::v1::MessageKind::ERROR,
      payload_json_object);
}

void reset_file_receive_session_for_device_protocol_v1_or_ignore() {
  g_file_receive_session_for_device_protocol_v1 = FileReceiveSessionForDeviceProtocolV1{};
}

bool parse_crc32_hex8_lower_text_or_false(const std::string& hex_text, std::uint32_t& out_crc32) {
  return parse_hex_uint32_from_text_or_false(hex_text, out_crc32);
}

bool try_commit_pico_runtime_package_from_utf8_json_bytes_with_legacy_ack_or_emit_errors(
    const std::vector<std::uint8_t>& decoded_utf8_json_bytes,
    bool emit_legacy_kibo_pkg_ack_line_on_success
) {
  if (decoded_utf8_json_bytes.size() > k_max_decoded_package_bytes) {
    emit_kibo_pkg_ack_line("error", "package_too_large");
    return false;
  }

  emit_ram_diagnostic_heap_probe_trace_line("commit_before_json_parse");

  nlohmann::json parsed_package;
  try {
    parsed_package = nlohmann::json::parse(decoded_utf8_json_bytes.begin(), decoded_utf8_json_bytes.end());
  } catch (const std::exception&) {
    emit_kibo_pkg_ack_line("error", "json_parse_failed");
    return false;
  }

  emit_ram_diagnostic_heap_probe_trace_line("commit_after_json_parse");

  if (!parsed_package.is_object()) {
    emit_kibo_pkg_ack_line("error", "package_not_object");
    return false;
  }

  if (!parsed_package.contains("packageSchemaVersion")) {
    emit_kibo_pkg_ack_line("error", "missing_package_schema_version");
    return false;
  }
  const int package_schema_version =
      kibo::runtime::read_json_number_as_int_or_throw(parsed_package.at("packageSchemaVersion"));
  if (package_schema_version != 1) {
    emit_kibo_pkg_ack_line("error", "unsupported_package_schema_version");
    return false;
  }

  if (!parsed_package.contains("runtimeIrContract") || !parsed_package.contains("replay") ||
      !parsed_package.contains("traceObservation")) {
    emit_kibo_pkg_ack_line("error", "missing_required_fields");
    return false;
  }
  if (!parsed_package.at("replay").is_object() || !parsed_package.at("replay").contains("steps")) {
    emit_kibo_pkg_ack_line("error", "missing_replay_steps");
    return false;
  }

  emit_ram_diagnostic_heap_probe_trace_line("commit_after_schema_validation");

  try {
    const nlohmann::json replay_document = [&parsed_package]() -> nlohmann::json {
      nlohmann::json replay_document_local;
      replay_document_local["replaySchemaVersion"] = 1;
      replay_document_local["runtimeIrContract"] = parsed_package.at("runtimeIrContract");
      replay_document_local["traceObservation"] = parsed_package.at("traceObservation");
      replay_document_local["steps"] = parsed_package.at("replay").at("steps");
      return replay_document_local;
    }();

    // Guard: dry-run replay to validate package before switching live runtime. Serial trace is emitted again after commit.
    kibo::runtime::run_runtime_conformance_replay_document(replay_document, [](const std::string&) {});
  } catch (const std::exception&) {
    emit_kibo_pkg_ack_line("error", "runtime_or_replay_failed");
    return false;
  }

  emit_ram_diagnostic_heap_probe_trace_line("commit_after_dry_run_replay_ok");

  g_active_pico_runtime_package_json = std::move(parsed_package);
  read_live_tick_interval_milliseconds_from_active_package_or_use_default();
  g_boot_fixture_name_text = "loaded-package";
  g_live_runtime_periodic_reset_enabled = false;

  emit_ram_diagnostic_heap_probe_trace_line("commit_after_active_package_assigned");

  emit_trace_lines_from_active_package_replay_or_log_exception();
  emit_ram_diagnostic_heap_probe_trace_line("commit_after_emit_trace_replay");

  reset_live_animation_runtime_from_active_package_or_log_exception();
  emit_ram_diagnostic_heap_probe_trace_line("commit_after_live_runtime_reset");

  if (emit_legacy_kibo_pkg_ack_line_on_success) {
    emit_kibo_pkg_ack_line("ok", "");
  }
  return true;
}

void handle_device_protocol_v1_complete_frame_bytes(const std::vector<std::uint8_t>& frame_bytes) {
  kibo::device_protocol::v1::DecodedFrame decoded_frame;
  kibo::device_protocol::v1::DecodeFrameErrorCode decode_error_code =
      kibo::device_protocol::v1::DecodeFrameErrorCode::FRAME_TOO_SHORT;
  if (!kibo::device_protocol::v1::try_decode_kibo_device_protocol_v1_frame_from_bytes(
          frame_bytes,
          decoded_frame,
          decode_error_code)) {
    Serial.println("trace schema=1 diag=kibo_device_protocol_v1_decode_failed");
    emit_device_protocol_v1_error_payload_frame_or_ignore(
        0,
        0,
        "decode_failed",
        "device failed to decode v1 frame");
    return;
  }

  const std::uint32_t sequence = decoded_frame.sequence;
  const std::uint32_t request_id = decoded_frame.request_id;

  try {
    switch (decoded_frame.message_kind) {
      case kibo::device_protocol::v1::MessageKind::HELLO: {
        nlohmann::json capabilities_payload;
        capabilities_payload["deviceProtocolVersion"] = 1;
        capabilities_payload["maxBodyByteLength"] =
            kibo::device_protocol::v1::k_max_body_byte_length_vertical_slice;
        capabilities_payload["maxCommittedFileByteLength"] =
            kibo::device_protocol::v1::k_max_committed_file_byte_length_vertical_slice;
        capabilities_payload["supportsFlashCommit"] = false;
        emit_device_protocol_v1_json_payload_frame_or_ignore(
            sequence,
            request_id,
            kibo::device_protocol::v1::MessageKind::CAPABILITIES,
            capabilities_payload);

        nlohmann::json pong_payload = nlohmann::json::object();
        emit_device_protocol_v1_json_payload_frame_or_ignore(
            sequence,
            request_id,
            kibo::device_protocol::v1::MessageKind::PONG,
            pong_payload);
        return;
      }
      case kibo::device_protocol::v1::MessageKind::PING: {
        nlohmann::json pong_payload = nlohmann::json::object();
        emit_device_protocol_v1_json_payload_frame_or_ignore(
            sequence,
            request_id,
            kibo::device_protocol::v1::MessageKind::PONG,
            pong_payload);
        return;
      }
      case kibo::device_protocol::v1::MessageKind::FILE_BEGIN: {
        const nlohmann::json payload_json =
            nlohmann::json::parse(decoded_frame.payload_utf8_bytes.begin(), decoded_frame.payload_utf8_bytes.end());
        const std::uint32_t file_id =
            static_cast<std::uint32_t>(payload_json.at("fileId").get<std::uint64_t>());
        const std::string kind_text = payload_json.at("kind").get<std::string>();
        const std::uint32_t total_byte_length =
            static_cast<std::uint32_t>(payload_json.at("totalByteLength").get<std::uint64_t>());
        const std::string whole_crc_hex_text = payload_json.at("wholePayloadCrc32HexLower").get<std::string>();

        // Guard: 新しい file 受信を始める前に常に staging と receive session を捨てる。`totalByteLength` 超過で return しても
        // 直前の成功 upload の staged bytes が残ると、後続の RUN_PACKAGE が誤って旧 package を commit する。
        reset_file_receive_session_for_device_protocol_v1_or_ignore();
        g_has_staged_pico_runtime_package_utf8_bytes = false;
        g_staged_pico_runtime_package_utf8_bytes.clear();

        if (kind_text != "pico_runtime_package_json_minified_utf8") {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "unsupported_file_kind",
              "only pico_runtime_package_json_minified_utf8 is supported");
          return;
        }
        if (total_byte_length > kibo::device_protocol::v1::k_max_committed_file_byte_length_vertical_slice) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "file_too_large",
              "totalByteLength exceeds device limit");
          return;
        }

        std::uint32_t whole_crc32 = 0;
        if (!parse_crc32_hex8_lower_text_or_false(whole_crc_hex_text, whole_crc32)) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "invalid_whole_crc_hex",
              "wholePayloadCrc32HexLower must be 8 hex chars");
          return;
        }

        g_file_receive_session_for_device_protocol_v1.active = true;
        g_file_receive_session_for_device_protocol_v1.file_id = file_id;
        g_file_receive_session_for_device_protocol_v1.total_byte_length = total_byte_length;
        g_file_receive_session_for_device_protocol_v1.whole_crc32 = whole_crc32;
        g_file_receive_session_for_device_protocol_v1.buffer.assign(total_byte_length, 0);
        g_file_receive_session_for_device_protocol_v1.next_expected_chunk_index = 0;
        g_file_receive_session_for_device_protocol_v1.next_expected_byte_offset = 0;
        emit_ram_diagnostic_heap_probe_trace_line("v1_file_begin_after_buffer_reserved");
        return;
      }
      case kibo::device_protocol::v1::MessageKind::FILE_CHUNK: {
        if (!g_file_receive_session_for_device_protocol_v1.active) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "no_active_file_session",
              "file_begin must precede file_chunk");
          return;
        }

        const nlohmann::json payload_json =
            nlohmann::json::parse(decoded_frame.payload_utf8_bytes.begin(), decoded_frame.payload_utf8_bytes.end());
        const std::uint32_t file_id =
            static_cast<std::uint32_t>(payload_json.at("fileId").get<std::uint64_t>());
        const std::uint32_t chunk_index =
            static_cast<std::uint32_t>(payload_json.at("chunkIndex").get<std::uint64_t>());
        const std::uint32_t byte_offset =
            static_cast<std::uint32_t>(payload_json.at("byteOffset").get<std::uint64_t>());
        const std::string chunk_crc_hex_text = payload_json.at("chunkCrc32HexLower").get<std::string>();
        const std::string payload_base64_text = payload_json.at("payloadBase64").get<std::string>();

        if (file_id != g_file_receive_session_for_device_protocol_v1.file_id) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "file_id_mismatch",
              "chunk fileId does not match active session");
          return;
        }
        if (chunk_index != g_file_receive_session_for_device_protocol_v1.next_expected_chunk_index) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "chunk_out_of_order",
              "chunkIndex must arrive in ascending order without gaps");
          return;
        }
        if (byte_offset != g_file_receive_session_for_device_protocol_v1.next_expected_byte_offset) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "byte_offset_mismatch",
              "byteOffset must be contiguous");
          return;
        }

        std::uint32_t expected_chunk_crc32 = 0;
        if (!parse_crc32_hex8_lower_text_or_false(chunk_crc_hex_text, expected_chunk_crc32)) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "invalid_chunk_crc_hex",
              "chunkCrc32HexLower must be 8 hex chars");
          return;
        }

        const std::vector<std::uint8_t> chunk_bytes =
            kibo::runtime::decode_base64_string_to_bytes_or_empty(payload_base64_text);
        if (chunk_bytes.empty() && !payload_base64_text.empty()) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "chunk_base64_decode_failed",
              "payloadBase64 could not be decoded");
          return;
        }

        const std::size_t chunk_byte_length = chunk_bytes.size();
        if (byte_offset + chunk_byte_length > g_file_receive_session_for_device_protocol_v1.buffer.size()) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "chunk_overflow",
              "chunk exceeds declared totalByteLength");
          return;
        }

        const std::uint32_t actual_chunk_crc32 =
            kibo::runtime::compute_crc32_over_bytes(chunk_bytes.data(), chunk_bytes.size());
        if (actual_chunk_crc32 != expected_chunk_crc32) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "chunk_crc_mismatch",
              "chunk bytes do not match chunkCrc32HexLower");
          return;
        }

        std::memcpy(
            g_file_receive_session_for_device_protocol_v1.buffer.data() + byte_offset,
            chunk_bytes.data(),
            chunk_byte_length);

        g_file_receive_session_for_device_protocol_v1.next_expected_chunk_index += 1;
        g_file_receive_session_for_device_protocol_v1.next_expected_byte_offset +=
            static_cast<std::uint32_t>(chunk_byte_length);
        return;
      }
      case kibo::device_protocol::v1::MessageKind::FILE_COMMIT: {
        if (!g_file_receive_session_for_device_protocol_v1.active) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "no_active_file_session",
              "file_begin must precede file_commit");
          return;
        }

        const nlohmann::json payload_json =
            nlohmann::json::parse(decoded_frame.payload_utf8_bytes.begin(), decoded_frame.payload_utf8_bytes.end());
        const std::uint32_t file_id =
            static_cast<std::uint32_t>(payload_json.at("fileId").get<std::uint64_t>());
        if (file_id != g_file_receive_session_for_device_protocol_v1.file_id) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "file_id_mismatch",
              "commit fileId does not match active session");
          return;
        }

        if (g_file_receive_session_for_device_protocol_v1.next_expected_byte_offset !=
            g_file_receive_session_for_device_protocol_v1.total_byte_length) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "file_incomplete",
              "all chunks must arrive before commit");
          reset_file_receive_session_for_device_protocol_v1_or_ignore();
          return;
        }

        const std::uint32_t actual_whole_crc32 = kibo::runtime::compute_crc32_over_bytes(
            g_file_receive_session_for_device_protocol_v1.buffer.data(),
            g_file_receive_session_for_device_protocol_v1.buffer.size());
        if (actual_whole_crc32 != g_file_receive_session_for_device_protocol_v1.whole_crc32) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "whole_crc_mismatch",
              "reassembled bytes do not match wholePayloadCrc32HexLower");
          reset_file_receive_session_for_device_protocol_v1_or_ignore();
          return;
        }

        g_staged_pico_runtime_package_utf8_bytes = g_file_receive_session_for_device_protocol_v1.buffer;
        g_has_staged_pico_runtime_package_utf8_bytes = true;
        reset_file_receive_session_for_device_protocol_v1_or_ignore();
        emit_ram_diagnostic_heap_probe_trace_line("v1_file_commit_after_staged_bytes");

        nlohmann::json ok_payload;
        ok_payload["status"] = "ok";
        ok_payload["phase"] = "staged";
        emit_device_protocol_v1_json_payload_frame_or_ignore(
            sequence,
            request_id,
            kibo::device_protocol::v1::MessageKind::LOG,
            ok_payload);
        return;
      }
      case kibo::device_protocol::v1::MessageKind::RUN_PACKAGE: {
        if (!g_has_staged_pico_runtime_package_utf8_bytes) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "no_staged_package",
              "file_commit must succeed before run_package");
          return;
        }

        const bool committed_ok =
            try_commit_pico_runtime_package_from_utf8_json_bytes_with_legacy_ack_or_emit_errors(
                g_staged_pico_runtime_package_utf8_bytes,
                true);
        if (!committed_ok) {
          emit_device_protocol_v1_error_payload_frame_or_ignore(
              sequence,
              request_id,
              "run_package_failed",
              "see kibo_pkg_ack status=error for legacy loader diagnostics");
          return;
        }

        nlohmann::json ok_payload;
        ok_payload["status"] = "ok";
        ok_payload["phase"] = "ran";
        emit_device_protocol_v1_json_payload_frame_or_ignore(
            sequence,
            request_id,
            kibo::device_protocol::v1::MessageKind::LOG,
            ok_payload);
        return;
      }
      default: {
        emit_device_protocol_v1_error_payload_frame_or_ignore(
            sequence,
            request_id,
            "unsupported_message_kind",
            "this firmware build does not handle the requested message_kind");
        return;
      }
    }
  } catch (const std::exception& exception) {
    emit_device_protocol_v1_error_payload_frame_or_ignore(
        sequence,
        request_id,
        "payload_json_exception",
        exception.what());
    reset_file_receive_session_for_device_protocol_v1_or_ignore();
  }
}

bool try_apply_pico_runtime_package_from_kibo_pkg_serial_line(const std::string& line) {
  const std::string kibo_pkg_prefix = "KIBO_PKG ";
  if (line.rfind(kibo_pkg_prefix, 0) != 0) {
    return false;
  }

  const std::string base64_marker = " b64=";
  const std::size_t base64_marker_index = line.find(base64_marker);
  if (base64_marker_index == std::string::npos) {
    emit_kibo_pkg_ack_line("error", "missing_b64");
    return true;
  }

  const std::string meta_text = line.substr(0, base64_marker_index);
  const std::string base64_payload = line.substr(base64_marker_index + base64_marker.size());

  int schema_version = 0;
  std::size_t expected_byte_count = 0;
  std::uint32_t expected_crc32 = 0;
  if (!parse_kibo_pkg_meta_key_values_or_false(meta_text, schema_version, expected_byte_count, expected_crc32)) {
    emit_kibo_pkg_ack_line("error", "invalid_meta");
    return true;
  }

  const std::vector<std::uint8_t> decoded_bytes = kibo::runtime::decode_base64_string_to_bytes_or_empty(base64_payload);
  if (decoded_bytes.empty()) {
    emit_kibo_pkg_ack_line("error", "base64_decode_failed");
    return true;
  }

  if (decoded_bytes.size() != expected_byte_count) {
    emit_kibo_pkg_ack_line("error", "length_mismatch");
    return true;
  }

  if (decoded_bytes.size() > k_max_decoded_package_bytes) {
    emit_kibo_pkg_ack_line("error", "package_too_large");
    return true;
  }

  const std::uint32_t actual_crc32 =
      kibo::runtime::compute_crc32_over_bytes(decoded_bytes.data(), decoded_bytes.size());
  if (actual_crc32 != expected_crc32) {
    emit_kibo_pkg_ack_line("error", "crc_mismatch");
    return true;
  }

  try_commit_pico_runtime_package_from_utf8_json_bytes_with_legacy_ack_or_emit_errors(decoded_bytes, true);
  return true;
}

void emit_kibo_loader_ping_response_line() {
  Serial.print("kibo_loader status=ok protocol=");
  Serial.print(k_kibo_loader_protocol_version);
  Serial.print(" active=");
  Serial.println(g_boot_fixture_name_text.c_str());
}

void poll_incoming_usb_serial_line_for_package_frames() {
  while (Serial.available() > 0) {
    const int next_character_code = Serial.read();
    if (next_character_code < 0) {
      return;
    }
    const auto next_byte = static_cast<std::uint8_t>(next_character_code);

    g_kibo_device_protocol_v1_usb_serial_ingress.feed_byte(
        next_byte,
        [](const std::string& completed_line_without_newline) {
          // Guard: explicit loader handshake line (not a JSON package frame).
          if (completed_line_without_newline == k_serial_ping_command_line) {
            emit_kibo_loader_ping_response_line();
            return;
          }
          if (try_apply_pico_runtime_package_from_kibo_pkg_serial_line(completed_line_without_newline)) {
            return;
          }
        },
        [](const std::vector<std::uint8_t>& complete_frame_bytes) {
          handle_device_protocol_v1_complete_frame_bytes(complete_frame_bytes);
        },
        [](const char* diag_text) { Serial.println(diag_text); });
  }
}

void configure_button_input_pins_and_seed_state() {
  for (std::size_t button_device_id = 0; button_device_id < k_button_gpio_pins_by_device_id.size(); button_device_id += 1) {
    const int gpio_pin = k_button_gpio_pins_by_device_id.at(button_device_id);
    pinMode(gpio_pin, INPUT_PULLUP);
    const int raw_level = digitalRead(gpio_pin);
    g_last_button_raw_levels.at(button_device_id) = raw_level;
    g_stable_button_raw_levels.at(button_device_id) = raw_level;
    g_last_button_raw_change_milliseconds.at(button_device_id) = millis();
  }
}

void dispatch_button_pressed_event_to_live_runtime_or_ignore(std::size_t button_device_id) {
  if (!g_live_animation_runtime) {
    return;
  }
  const int device_id = static_cast<int>(button_device_id);
  g_live_animation_runtime->dispatch_device_event(
      k_button_device_kind_name,
      device_id,
      k_button_pressed_event_name);
  render_outputs_from_live_runtime_or_ignore();
  Serial.print("kibo_pico_vertical_slice_button_event device=button#");
  Serial.print(device_id);
  Serial.print(" gpio=");
  Serial.print(k_button_gpio_pins_by_device_id.at(button_device_id));
  Serial.println(" event=pressed");
}

void poll_physical_button_events_if_due(unsigned long now_milliseconds) {
  if (now_milliseconds - g_last_button_event_poll_milliseconds < k_button_event_poll_interval_milliseconds) {
    return;
  }
  g_last_button_event_poll_milliseconds = now_milliseconds;

  for (std::size_t button_device_id = 0; button_device_id < k_button_gpio_pins_by_device_id.size(); button_device_id += 1) {
    const int gpio_pin = k_button_gpio_pins_by_device_id.at(button_device_id);
    const int raw_level = digitalRead(gpio_pin);
    if (raw_level != g_last_button_raw_levels.at(button_device_id)) {
      g_last_button_raw_levels.at(button_device_id) = raw_level;
      g_last_button_raw_change_milliseconds.at(button_device_id) = now_milliseconds;
      continue;
    }

    if (now_milliseconds - g_last_button_raw_change_milliseconds.at(button_device_id) < k_button_debounce_milliseconds) {
      continue;
    }
    if (raw_level == g_stable_button_raw_levels.at(button_device_id)) {
      continue;
    }

    const int previous_stable_raw_level = g_stable_button_raw_levels.at(button_device_id);
    g_stable_button_raw_levels.at(button_device_id) = raw_level;
    if (previous_stable_raw_level == k_button_released_raw_level && raw_level == k_button_pressed_raw_level) {
      dispatch_button_pressed_event_to_live_runtime_or_ignore(button_device_id);
    }
  }
}

void log_button_state_summary_if_due(unsigned long now_milliseconds) {
  if (now_milliseconds - g_last_button_state_log_milliseconds < k_button_state_log_interval_milliseconds) {
    return;
  }
  Serial.print("kibo_pico_vertical_slice_button_poll");
  for (std::size_t button_device_id = 0; button_device_id < k_button_gpio_pins_by_device_id.size(); button_device_id += 1) {
    Serial.print(" button");
    Serial.print(static_cast<int>(button_device_id));
    Serial.print("_raw=");
    Serial.print(g_stable_button_raw_levels.at(button_device_id));
  }
  Serial.println();
  g_last_button_state_log_milliseconds = now_milliseconds;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(k_onboard_led_pin, OUTPUT);
  digitalWrite(k_onboard_led_pin, LOW);

  configure_button_input_pins_and_seed_state();

  Wire.setSDA(k_oled_i2c_sda_pin);
  Wire.setSCL(k_oled_i2c_scl_pin);
  Wire.begin();

  if (!g_oled_display.begin(SSD1306_SWITCHCAPVCC, k_oled_i2c_address_seven_bit)) {
    Serial.println("trace schema=1 diag=oled_begin_failed");
    return;
  }

  g_oled_display.clearDisplay();
  g_oled_display.display();

  try {
    g_active_pico_runtime_package_json =
        nlohmann::json::parse(kibo::pico::embedded_runtime_package::kDefaultPicoRuntimePackageJson);
  } catch (const std::exception& exception) {
    Serial.print("trace schema=1 diag=embedded_default_package_parse_failed msg=");
    Serial.println(exception.what());
    return;
  }

  read_live_tick_interval_milliseconds_from_active_package_or_use_default();
  g_boot_fixture_name_text = k_boot_fixture_name_for_default_embedded_package;

  Serial.print("kibo_pico_vertical_slice_boot fixture=");
  Serial.print(g_boot_fixture_name_text.c_str());
  Serial.print(" loader_protocol=");
  Serial.println(k_kibo_loader_protocol_version);

  emit_trace_lines_from_active_package_replay_or_log_exception();
  reset_live_animation_runtime_from_active_package_or_log_exception();
  emit_ram_diagnostic_heap_probe_trace_line("boot_after_embedded_default_package_live_reset");
  g_last_trace_replay_milliseconds = millis();
  g_last_button_state_log_milliseconds = millis();
  g_last_button_event_poll_milliseconds = millis();
}

void loop() {
  const unsigned long now_milliseconds = millis();
  poll_incoming_usb_serial_line_for_package_frames();
  poll_physical_button_events_if_due(now_milliseconds);
  tick_live_animation_if_due(now_milliseconds);

  if (now_milliseconds - g_last_trace_replay_milliseconds >= k_trace_replay_repeat_interval_milliseconds) {
    Serial.print("kibo_pico_vertical_slice_trace_replay_repeat fixture=");
    Serial.println(g_boot_fixture_name_text.c_str());
    emit_trace_lines_from_active_package_replay_or_log_exception();
    g_last_trace_replay_milliseconds = now_milliseconds;
  }

  log_button_state_summary_if_due(now_milliseconds);
}
