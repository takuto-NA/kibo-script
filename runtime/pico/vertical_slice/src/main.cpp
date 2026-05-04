// 責務: Raspberry Pi Pico 上で `PicoRuntimePackage`（runtime IR + replay + trace 観測 + live tick）を実行し、USB Serial に conformance trace を出しつつ SSD1306 に反映する最小縦断（vertical slice）。
//
// 注意:
// - ピン配線は `docs/pico-bringup.md` の OLED / onboard LED メモに合わせる。
// - 既定 package は `include/embedded_default_pico_runtime_package.hpp` を正とする（golden と同期）。
// - USB Serial の `KIBO_PING` で loader handshake（`kibo_loader status=ok protocol=1 ...`）を返す。
// - USB Serial の `KIBO_PKG ...` 1 行 frame で package を差し替えられる（開発用）。

#include <Arduino.h>
#include <Wire.h>

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#include <array>
#include <cctype>
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
constexpr std::size_t k_max_decoded_package_bytes = 12288;

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
std::string g_serial_incoming_line_characters;

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

  nlohmann::json parsed_package;
  try {
    parsed_package = nlohmann::json::parse(decoded_bytes.begin(), decoded_bytes.end());
  } catch (const std::exception&) {
    emit_kibo_pkg_ack_line("error", "json_parse_failed");
    return true;
  }

  if (!parsed_package.is_object()) {
    emit_kibo_pkg_ack_line("error", "package_not_object");
    return true;
  }

  if (!parsed_package.contains("packageSchemaVersion")) {
    emit_kibo_pkg_ack_line("error", "missing_package_schema_version");
    return true;
  }
  const int package_schema_version =
      kibo::runtime::read_json_number_as_int_or_throw(parsed_package.at("packageSchemaVersion"));
  if (package_schema_version != 1) {
    emit_kibo_pkg_ack_line("error", "unsupported_package_schema_version");
    return true;
  }

  if (!parsed_package.contains("runtimeIrContract") || !parsed_package.contains("replay") ||
      !parsed_package.contains("traceObservation")) {
    emit_kibo_pkg_ack_line("error", "missing_required_fields");
    return true;
  }
  if (!parsed_package.at("replay").is_object() || !parsed_package.at("replay").contains("steps")) {
    emit_kibo_pkg_ack_line("error", "missing_replay_steps");
    return true;
  }

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
    return true;
  }

  g_active_pico_runtime_package_json = std::move(parsed_package);
  read_live_tick_interval_milliseconds_from_active_package_or_use_default();
  g_boot_fixture_name_text = "loaded-package";
  g_live_runtime_periodic_reset_enabled = false;

  emit_trace_lines_from_active_package_replay_or_log_exception();
  reset_live_animation_runtime_from_active_package_or_log_exception();

  emit_kibo_pkg_ack_line("ok", "");
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
    const char next_character = static_cast<char>(next_character_code);
    if (next_character == '\n') {
      std::string completed_line = g_serial_incoming_line_characters;
      g_serial_incoming_line_characters.clear();
      if (completed_line.empty()) {
        continue;
      }
      if (!completed_line.empty() && completed_line.back() == '\r') {
        completed_line.pop_back();
      }
      // Guard: explicit loader handshake line (not a JSON package frame).
      if (completed_line == k_serial_ping_command_line) {
        emit_kibo_loader_ping_response_line();
        continue;
      }
      if (try_apply_pico_runtime_package_from_kibo_pkg_serial_line(completed_line)) {
        continue;
      }
      continue;
    }

    if (g_serial_incoming_line_characters.size() >= k_max_serial_line_characters) {
      g_serial_incoming_line_characters.clear();
      Serial.println("trace schema=1 diag=serial_line_too_long");
      continue;
    }
    g_serial_incoming_line_characters.push_back(next_character);
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
