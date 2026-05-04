#pragma once

#include <nlohmann/json.hpp>

#include "kibo_display_geometry.hpp"

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace kibo::runtime {

/**
 * 責務: runtime IR contract（JSON）を読み込み、TypeScript `SimulationRuntime` の最小サブセットとして tick / event / trace を再現する。
 *
 * 注意:
 * - このクラスは **MVP** である。未対応の IR に遭遇した場合は `std::runtime_error` を投げる。
 * - デバイスは `led#0` / `button#0..#4` event / `display#0` のみを想定する（fixture / Pico sample 用）。
 */
class KiboHostRuntime final {
public:
  explicit KiboHostRuntime(const nlohmann::json& runtime_ir_contract_root);

  void tick_milliseconds(int elapsed_milliseconds);

  void dispatch_device_event(const std::string& device_kind, int device_id, const std::string& event_name);

  [[nodiscard]] std::string collect_conformance_trace_line(
      const std::vector<std::string>& script_var_names_to_include_in_trace) const;

  [[nodiscard]] std::int64_t total_simulation_milliseconds() const noexcept { return total_ms_; }

  [[nodiscard]] bool is_led0_light_on() const noexcept { return led0_is_on_; }

  [[nodiscard]] const std::array<std::uint8_t, kDisplayPixelCount>& presented_framebuffer_pixels() const noexcept {
    return presented_pixels_;
  }

private:
  struct TaskExecutionProgress final {
    int program_counter{0};
    std::optional<std::int64_t> resume_at_total_ms;
  };

  struct EveryTaskRuntime final {
    std::string task_name;
    int interval_milliseconds{0};
    int accumulated_milliseconds{0};
    nlohmann::json statements_json;
    std::unordered_map<std::string, std::int64_t> temp_values;
    std::optional<TaskExecutionProgress> execution_progress;
  };

  struct OnEventTaskRuntime final {
    std::string task_name;
    std::string device_kind;
    int device_id{0};
    std::string event_name;
    nlohmann::json statements_json;
    std::unordered_map<std::string, std::int64_t> temp_values;
  };

  struct EvaluationContext final {
    std::unordered_map<std::string, std::int64_t>* script_vars{};
    std::unordered_map<std::string, std::int64_t>* const_values{};
    std::unordered_map<std::string, std::int64_t>* temp_values{};
    std::optional<int> nominal_interval_milliseconds{};
    std::string_view run_mode{};
  };

  std::int64_t total_ms_{0};
  std::unordered_map<std::string, std::int64_t> script_vars_;
  std::unordered_map<std::string, std::int64_t> const_values_;
  bool led0_is_on_{false};
  bool button0_is_pressed_{false};
  std::array<std::uint8_t, kDisplayPixelCount> draft_pixels_{};
  std::array<std::uint8_t, kDisplayPixelCount> presented_pixels_{};
  std::vector<EveryTaskRuntime> every_tasks_;
  std::vector<OnEventTaskRuntime> on_event_tasks_;

  void initialize_script_vars_from_program(const nlohmann::json& compiled_program_json);
  void initialize_const_values_from_program(const nlohmann::json& compiled_program_json);
  void register_every_tasks_from_program(const nlohmann::json& compiled_program_json);
  void register_on_event_tasks_from_program(const nlohmann::json& compiled_program_json);

  void resume_waiting_every_tasks();
  void advance_every_tasks(int elapsed_milliseconds);
  void drain_every_task_body(EveryTaskRuntime& task);
  void drain_on_event_task_body(OnEventTaskRuntime& task);

  std::int64_t evaluate_expression_json(
      const nlohmann::json& expression_json,
      EvaluationContext& evaluation_context);

  void execute_statement_json(const nlohmann::json& statement_json, EvaluationContext& evaluation_context);
  void execute_statements_json_array(const nlohmann::json& statements_json_array, EvaluationContext& evaluation_context);

  void apply_led_effect(const std::string& effect_kind);
  void apply_display_clear();
  void apply_display_circle(int center_x, int center_y, int radius);
  void apply_display_present();
};

}  // namespace kibo::runtime
