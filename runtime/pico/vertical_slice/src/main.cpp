// 責務: Raspberry Pi Pico 上で runtime IR contract（circle-animation）を実行し、USB Serial に conformance trace を出しつつ SSD1306 に反映する最小縦断（vertical slice）。
//
// 注意:
// - ピン配線は `docs/pico-bringup.md` の OLED / onboard LED メモに合わせる。
// - JSON 埋め込み文字列は `include/embedded_circle_runtime_ir_contract.hpp` を正とする（golden と同期）。

#include <Arduino.h>
#include <Wire.h>

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#include <nlohmann/json.hpp>

#include "embedded_circle_runtime_ir_contract.hpp"
#include "kibo_host_runtime.hpp"

namespace {

constexpr int kOledScreenWidthPixels = 128;
constexpr int kOledScreenHeightPixels = 64;
constexpr int kOledI2cSdaPin = 16;
constexpr int kOledI2cSclPin = 17;
constexpr uint8_t kOledI2cAddressSevenBit = 0x3C;

constexpr int kOnboardLedPin = LED_BUILTIN;
constexpr int kButton0Pin = 18;

Adafruit_SSD1306 g_oled_display(
    kOledScreenWidthPixels,
    kOledScreenHeightPixels,
    &Wire,
    -1,
);

void render_presented_framebuffer_pixels_to_oled_or_ignore(const kibo::runtime::KiboHostRuntime& host_runtime) {
  g_oled_display.clearDisplay();
  const auto& presented_pixels = host_runtime.presented_framebuffer_pixels();
  for (int y_pixel = 0; y_pixel < kOledScreenHeightPixels; y_pixel += 1) {
    for (int x_pixel = 0; x_pixel < kOledScreenWidthPixels; x_pixel += 1) {
      const std::size_t pixel_index =
          static_cast<std::size_t>(y_pixel * kOledScreenWidthPixels + x_pixel);
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
  digitalWrite(kOnboardLedPin, is_led_light_on ? HIGH : LOW);
}

nlohmann::json build_circle_animation_replay_document_json() {
  nlohmann::json replay_document;
  replay_document["replaySchemaVersion"] = 1;
  replay_document["runtimeIrContract"] =
      nlohmann::json::parse(kibo::pico::embedded_runtime_ir::kCircleAnimationRuntimeIrContractJson);
  replay_document["traceObservation"]["scriptVarNamesToIncludeInTrace"] = nlohmann::json::array({"circle_x"});
  replay_document["steps"] = nlohmann::json::array({
      nlohmann::json{{"kind", "collect_trace"}},
      nlohmann::json{{"kind", "tick_ms"}, {"elapsedMilliseconds", 100}},
      nlohmann::json{{"kind", "collect_trace"}},
      nlohmann::json{{"kind", "tick_ms"}, {"elapsedMilliseconds", 100}},
      nlohmann::json{{"kind", "collect_trace"}},
  });
  return replay_document;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(kOnboardLedPin, OUTPUT);
  digitalWrite(kOnboardLedPin, LOW);

  pinMode(kButton0Pin, INPUT_PULLUP);

  Wire.setSDA(kOledI2cSdaPin);
  Wire.setSCL(kOledI2cSclPin);
  Wire.begin();

  if (!g_oled_display.begin(SSD1306_SWITCHCAPVCC, kOledI2cAddressSevenBit)) {
    Serial.println("trace schema=1 diag=oled_begin_failed");
    return;
  }

  g_oled_display.clearDisplay();
  g_oled_display.display();

  Serial.println("kibo_pico_vertical_slice_boot fixture=circle-animation");

  const nlohmann::json replay_document = build_circle_animation_replay_document_json();

  try {
    kibo::runtime::KiboHostRuntime host_runtime(replay_document.at("runtimeIrContract"));
    const std::vector<std::string> script_var_names_to_include_in_trace =
        replay_document.at("traceObservation").at("scriptVarNamesToIncludeInTrace").get<std::vector<std::string>>();

    const nlohmann::json& steps = replay_document.at("steps");
    for (const auto& step : steps) {
      const std::string step_kind = step.at("kind").get<std::string>();
      if (step_kind == "collect_trace") {
        const std::string trace_line =
            host_runtime.collect_conformance_trace_line(script_var_names_to_include_in_trace);
        Serial.println(trace_line.c_str());
        apply_onboard_led_visual_from_host_runtime_or_ignore(host_runtime);
        render_presented_framebuffer_pixels_to_oled_or_ignore(host_runtime);
        continue;
      }
      if (step_kind == "tick_ms") {
        const int elapsed_milliseconds = step.at("elapsedMilliseconds").get<int>();
        host_runtime.tick_milliseconds(elapsed_milliseconds);
        continue;
      }
      if (step_kind == "dispatch_device_event") {
        const std::string device_kind = step.at("deviceKind").get<std::string>();
        const int device_id = step.at("deviceId").get<int>();
        const std::string event_name = step.at("eventName").get<std::string>();
        host_runtime.dispatch_device_event(device_kind, device_id, event_name);
        continue;
      }
    }
  } catch (const std::exception& exception) {
    Serial.print("trace schema=1 diag=exception msg=");
    Serial.println(exception.what());
  }
}

void loop() {
  const int button_raw_level = digitalRead(kButton0Pin);
  Serial.print("kibo_pico_vertical_slice_button_poll raw_level=");
  Serial.println(button_raw_level);
  delay(1000);
}
