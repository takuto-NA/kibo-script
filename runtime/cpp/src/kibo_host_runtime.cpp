// 責務: `KiboHostRuntime` の実装（fixture 用の最小 runtime semantics）。

#include "kibo_host_runtime.hpp"

#include "kibo_display_geometry.hpp"
#include "kibo_fnv1a64.hpp"
#include "kibo_json_read_integer.hpp"

#include <algorithm>
#include <sstream>
#include <stdexcept>

namespace kibo::runtime {

namespace {

[[noreturn]] void throw_unsupported_runtime_ir(const std::string& message) {
  throw std::runtime_error(message);
}

}  // namespace

KiboHostRuntime::KiboHostRuntime(const nlohmann::json& runtime_ir_contract_root) {
  if (!runtime_ir_contract_root.is_object()) {
    throw_unsupported_runtime_ir("runtime IR contract root must be a JSON object.");
  }
  if (!runtime_ir_contract_root.contains("runtimeIrContractSchemaVersion")) {
    throw_unsupported_runtime_ir("runtime IR contract missing `runtimeIrContractSchemaVersion`.");
  }
  const int schema_version = read_json_number_as_int_or_throw(runtime_ir_contract_root.at("runtimeIrContractSchemaVersion"));
  if (schema_version != 1) {
    std::ostringstream oss;
    oss << "Unsupported runtimeIrContractSchemaVersion: " << schema_version;
    throw_unsupported_runtime_ir(oss.str());
  }
  const auto& compiled_program_json = runtime_ir_contract_root.at("compiledProgram");
  if (!compiled_program_json.is_object()) {
    throw_unsupported_runtime_ir("`compiledProgram` must be a JSON object.");
  }

  initialize_script_vars_from_program(compiled_program_json);
  initialize_const_values_from_program(compiled_program_json);
  register_every_tasks_from_program(compiled_program_json);
  register_on_event_tasks_from_program(compiled_program_json);
}

void KiboHostRuntime::initialize_script_vars_from_program(const nlohmann::json& compiled_program_json) {
  script_vars_.clear();
  const auto iterator = compiled_program_json.find("varInitializers");
  if (iterator == compiled_program_json.end()) {
    return;
  }
  const auto& initializers = *iterator;
  if (!initializers.is_array()) {
    throw_unsupported_runtime_ir("`varInitializers` must be an array.");
  }
  for (const auto& initializer : initializers) {
    const std::string var_name = initializer.at("varName").get<std::string>();
    EvaluationContext evaluation_context{};
    evaluation_context.script_vars = &script_vars_;
    evaluation_context.const_values = &const_values_;
    evaluation_context.temp_values = nullptr;
    evaluation_context.nominal_interval_milliseconds = std::nullopt;
    evaluation_context.run_mode = "init";
    const std::int64_t value = evaluate_expression_json(initializer.at("expression"), evaluation_context);
    script_vars_[var_name] = value;
  }
}

void KiboHostRuntime::initialize_const_values_from_program(const nlohmann::json& compiled_program_json) {
  const_values_.clear();
  const auto iterator = compiled_program_json.find("constInitializers");
  if (iterator == compiled_program_json.end()) {
    return;
  }
  const auto& initializers = *iterator;
  if (!initializers.is_array()) {
    throw_unsupported_runtime_ir("`constInitializers` must be an array.");
  }
  for (const auto& initializer : initializers) {
    const std::string const_name = initializer.at("constName").get<std::string>();
    EvaluationContext evaluation_context{};
    evaluation_context.script_vars = &script_vars_;
    evaluation_context.const_values = &const_values_;
    evaluation_context.temp_values = nullptr;
    evaluation_context.nominal_interval_milliseconds = std::nullopt;
    evaluation_context.run_mode = "init";
    const std::int64_t value = evaluate_expression_json(initializer.at("expression"), evaluation_context);
    const_values_[const_name] = value;
  }
}

void KiboHostRuntime::register_every_tasks_from_program(const nlohmann::json& compiled_program_json) {
  every_tasks_.clear();
  const auto iterator = compiled_program_json.find("everyTasks");
  if (iterator == compiled_program_json.end()) {
    return;
  }
  const auto& every_tasks_json = *iterator;
  if (!every_tasks_json.is_array()) {
    throw_unsupported_runtime_ir("`everyTasks` must be an array.");
  }
  for (const auto& every_task_json : every_tasks_json) {
    EveryTaskRuntime task{};
    task.task_name = every_task_json.at("taskName").get<std::string>();
    task.interval_milliseconds = read_json_number_as_int_or_throw(every_task_json.at("intervalMilliseconds"));
    task.accumulated_milliseconds = 0;
    task.statements_json = every_task_json.at("statements");
    if (!task.statements_json.is_array()) {
      throw_unsupported_runtime_ir("`everyTasks[].statements` must be an array.");
    }
    if (every_task_json.contains("stateMembershipPath")) {
      throw_unsupported_runtime_ir("C++ host runtime MVP does not support `stateMembershipPath` on every tasks.");
    }
    every_tasks_.push_back(std::move(task));
  }
}

void KiboHostRuntime::register_on_event_tasks_from_program(const nlohmann::json& compiled_program_json) {
  on_event_tasks_.clear();
  const auto iterator = compiled_program_json.find("onEventTasks");
  if (iterator == compiled_program_json.end()) {
    return;
  }
  const auto& on_event_tasks_json = *iterator;
  if (!on_event_tasks_json.is_array()) {
    throw_unsupported_runtime_ir("`onEventTasks` must be an array.");
  }
  for (const auto& on_task_json : on_event_tasks_json) {
    const std::string trigger_kind = on_task_json.at("triggerKind").get<std::string>();
    if (trigger_kind != "device_event") {
      std::ostringstream oss;
      oss << "Unsupported onEvent triggerKind: " << trigger_kind;
      throw_unsupported_runtime_ir(oss.str());
    }
    OnEventTaskRuntime task{};
    task.task_name = on_task_json.at("taskName").get<std::string>();
    const auto& device_address = on_task_json.at("deviceAddress");
    task.device_kind = device_address.at("kind").get<std::string>();
    task.device_id = read_json_number_as_int_or_throw(device_address.at("id"));
    task.event_name = on_task_json.at("eventName").get<std::string>();
    task.statements_json = on_task_json.at("statements");
    if (!task.statements_json.is_array()) {
      throw_unsupported_runtime_ir("`onEventTasks[].statements` must be an array.");
    }
    if (on_task_json.contains("stateMembershipPath")) {
      throw_unsupported_runtime_ir("C++ host runtime MVP does not support `stateMembershipPath` on on_event tasks.");
    }
    on_event_tasks_.push_back(std::move(task));
  }
}

void KiboHostRuntime::tick_milliseconds(int elapsed_milliseconds) {
  if (elapsed_milliseconds <= 0) {
    return;
  }
  total_ms_ += static_cast<std::int64_t>(elapsed_milliseconds);
  resume_waiting_every_tasks();
  // MVP: TypeScript `SimulationRuntime.tick` は `advanceStateMachines` と `startRunnableLoopTasks` も呼ぶ。
  // fixture（blink / button / circle）の範囲ではどちらも実質 noop のため、ここでは省略する。
  advance_every_tasks(elapsed_milliseconds);
}

void KiboHostRuntime::resume_waiting_every_tasks() {
  for (auto& task : every_tasks_) {
    if (!task.execution_progress.has_value()) {
      continue;
    }
    if (!task.execution_progress->resume_at_total_ms.has_value()) {
      continue;
    }
    if (total_ms_ < task.execution_progress->resume_at_total_ms.value()) {
      continue;
    }
    task.execution_progress->resume_at_total_ms.reset();
    drain_every_task_body(task);
  }
}

void KiboHostRuntime::advance_every_tasks(int elapsed_milliseconds) {
  for (auto& task : every_tasks_) {
    const int interval_milliseconds = task.interval_milliseconds;
    if (interval_milliseconds <= 0) {
      continue;
    }
    task.accumulated_milliseconds += elapsed_milliseconds;
    while (task.accumulated_milliseconds >= interval_milliseconds) {
      task.accumulated_milliseconds -= interval_milliseconds;
      if (task.execution_progress.has_value()) {
        continue;
      }
      TaskExecutionProgress progress{};
      progress.program_counter = 0;
      progress.resume_at_total_ms.reset();
      task.execution_progress = progress;
      drain_every_task_body(task);
    }
  }
}

void KiboHostRuntime::dispatch_device_event(
    const std::string& device_kind,
    int device_id,
    const std::string& event_name
) {
  for (auto& task : on_event_tasks_) {
    if (task.device_kind != device_kind) {
      continue;
    }
    if (task.device_id != device_id) {
      continue;
    }
    if (task.event_name != event_name) {
      continue;
    }
    if (task.statements_json.empty()) {
      continue;
    }
    drain_on_event_task_body(task);
  }
}

void KiboHostRuntime::drain_on_event_task_body(OnEventTaskRuntime& task) {
  EvaluationContext evaluation_context{};
  evaluation_context.script_vars = &script_vars_;
  evaluation_context.const_values = &const_values_;
  evaluation_context.temp_values = &task.temp_values;
  evaluation_context.nominal_interval_milliseconds = std::nullopt;
  evaluation_context.run_mode = "on_event";
  task.temp_values.clear();
  execute_statements_json_array(task.statements_json, evaluation_context);
}

void KiboHostRuntime::drain_every_task_body(EveryTaskRuntime& task) {
  if (!task.execution_progress.has_value()) {
    return;
  }

  EvaluationContext evaluation_context{};
  evaluation_context.script_vars = &script_vars_;
  evaluation_context.const_values = &const_values_;
  evaluation_context.temp_values = &task.temp_values;
  evaluation_context.nominal_interval_milliseconds = task.interval_milliseconds;
  evaluation_context.run_mode = "every";

  for (;;) {
    if (!task.execution_progress.has_value()) {
      return;
    }

    const int program_counter = task.execution_progress->program_counter;
    if (program_counter == 0) {
      task.temp_values.clear();
    }

    const int statement_count = static_cast<int>(task.statements_json.size());
    if (program_counter >= statement_count) {
      task.execution_progress.reset();
      return;
    }

    const auto& statement_json = task.statements_json.at(static_cast<std::size_t>(program_counter));
    const std::string statement_kind = statement_json.at("kind").get<std::string>();
    if (statement_kind == "wait_milliseconds") {
      const auto& duration_expression = statement_json.at("durationMillisecondsExpression");
      const std::int64_t wait_ms = evaluate_expression_json(duration_expression, evaluation_context);
      if (wait_ms <= 0) {
        task.execution_progress.reset();
        return;
      }
      task.execution_progress->resume_at_total_ms = total_ms_ + wait_ms;
      task.execution_progress->program_counter = program_counter + 1;
      return;
    }

    execute_statement_json(statement_json, evaluation_context);
    task.execution_progress->program_counter = program_counter + 1;
  }
}

void KiboHostRuntime::execute_statements_json_array(
    const nlohmann::json& statements_json_array,
    EvaluationContext& evaluation_context
) {
  if (!statements_json_array.is_array()) {
    throw_unsupported_runtime_ir("Statement list must be a JSON array.");
  }
  for (const auto& statement_json : statements_json_array) {
    execute_statement_json(statement_json, evaluation_context);
  }
}

void KiboHostRuntime::execute_statement_json(
    const nlohmann::json& statement_json,
    EvaluationContext& evaluation_context
) {
  const std::string statement_kind = statement_json.at("kind").get<std::string>();
  if (statement_kind == "do_method_call") {
    const auto& device_address = statement_json.at("deviceAddress");
    const std::string device_kind = device_address.at("kind").get<std::string>();
    const int device_id = device_address.at("id").get<int>();
    const std::string method_name = statement_json.at("methodName").get<std::string>();
    const auto& arguments_json = statement_json.at("arguments");
    if (!arguments_json.is_array()) {
      throw_unsupported_runtime_ir("`do_method_call.arguments` must be an array.");
    }

    if (device_kind == "led" && device_id == 0) {
      if (method_name == "toggle" && arguments_json.empty()) {
        apply_led_effect("led.toggle");
        return;
      }
      if (method_name == "on" && arguments_json.empty()) {
        apply_led_effect("led.on");
        return;
      }
      if (method_name == "off" && arguments_json.empty()) {
        apply_led_effect("led.off");
        return;
      }
    }

    if (device_kind == "display" && device_id == 0) {
      if (method_name == "clear" && arguments_json.empty()) {
        apply_display_clear();
        return;
      }
      if (method_name == "present" && arguments_json.empty()) {
        apply_display_present();
        return;
      }
      if (method_name == "circle" && arguments_json.size() == 3) {
        const int center_x = static_cast<int>(evaluate_expression_json(arguments_json.at(0), evaluation_context));
        const int center_y = static_cast<int>(evaluate_expression_json(arguments_json.at(1), evaluation_context));
        const int radius = static_cast<int>(evaluate_expression_json(arguments_json.at(2), evaluation_context));
        apply_display_circle(center_x, center_y, radius);
        return;
      }
    }

    std::ostringstream oss;
    oss << "Unsupported do_method_call: " << device_kind << "#" << device_id << "." << method_name;
    throw_unsupported_runtime_ir(oss.str());
  }

  if (statement_kind == "assign_var") {
    const std::string var_name = statement_json.at("varName").get<std::string>();
    const std::int64_t next_value = evaluate_expression_json(statement_json.at("valueExpression"), evaluation_context);
    (*evaluation_context.script_vars)[var_name] = next_value;
    return;
  }

  if (statement_kind == "assign_temp") {
    if (evaluation_context.temp_values == nullptr) {
      throw_unsupported_runtime_ir("`assign_temp` requires temp storage (internal error).");
    }
    const std::string temp_name = statement_json.at("tempName").get<std::string>();
    const std::int64_t next_value = evaluate_expression_json(statement_json.at("valueExpression"), evaluation_context);
    (*evaluation_context.temp_values)[temp_name] = next_value;
    return;
  }

  std::ostringstream oss;
  oss << "Unsupported statement kind: " << statement_kind;
  throw_unsupported_runtime_ir(oss.str());
}

std::int64_t KiboHostRuntime::evaluate_expression_json(
    const nlohmann::json& expression_json,
    EvaluationContext& evaluation_context
) {
  const std::string kind = expression_json.at("kind").get<std::string>();
  if (kind == "integer_literal") {
    return read_json_number_as_int64_or_throw(expression_json.at("value"));
  }
  if (kind == "var_reference") {
    const std::string var_name = expression_json.at("varName").get<std::string>();
    const auto iterator = evaluation_context.script_vars->find(var_name);
    if (iterator == evaluation_context.script_vars->end()) {
      std::ostringstream oss;
      oss << "Unknown var in var_reference: " << var_name;
      throw_unsupported_runtime_ir(oss.str());
    }
    return iterator->second;
  }
  if (kind == "const_reference") {
    const std::string const_name = expression_json.at("constName").get<std::string>();
    const auto iterator = evaluation_context.const_values->find(const_name);
    if (iterator == evaluation_context.const_values->end()) {
      std::ostringstream oss;
      oss << "Unknown const in const_reference: " << const_name;
      throw_unsupported_runtime_ir(oss.str());
    }
    return iterator->second;
  }
  if (kind == "temp_reference") {
    if (evaluation_context.temp_values == nullptr) {
      throw_unsupported_runtime_ir("`temp_reference` used without temp storage (internal error).");
    }
    const std::string temp_name = expression_json.at("tempName").get<std::string>();
    const auto iterator = evaluation_context.temp_values->find(temp_name);
    if (iterator == evaluation_context.temp_values->end()) {
      std::ostringstream oss;
      oss << "Unknown temp in temp_reference: " << temp_name;
      throw_unsupported_runtime_ir(oss.str());
    }
    return iterator->second;
  }
  if (kind == "binary_add") {
    const std::int64_t left = evaluate_expression_json(expression_json.at("left"), evaluation_context);
    const std::int64_t right = evaluate_expression_json(expression_json.at("right"), evaluation_context);
    return left + right;
  }
  if (kind == "binary_sub") {
    const std::int64_t left = evaluate_expression_json(expression_json.at("left"), evaluation_context);
    const std::int64_t right = evaluate_expression_json(expression_json.at("right"), evaluation_context);
    return left - right;
  }
  if (kind == "binary_mul") {
    const std::int64_t left = evaluate_expression_json(expression_json.at("left"), evaluation_context);
    const std::int64_t right = evaluate_expression_json(expression_json.at("right"), evaluation_context);
    return left * right;
  }
  if (kind == "binary_div") {
    const std::int64_t left = evaluate_expression_json(expression_json.at("left"), evaluation_context);
    const std::int64_t right = evaluate_expression_json(expression_json.at("right"), evaluation_context);
    if (right == 0) {
      throw_unsupported_runtime_ir("Division by zero in binary_div.");
    }
    return left / right;
  }
  if (kind == "unary_minus") {
    const std::int64_t operand = evaluate_expression_json(expression_json.at("operand"), evaluation_context);
    return -operand;
  }
  if (kind == "dt_interval_ms") {
    if (evaluation_context.run_mode != "every") {
      throw_unsupported_runtime_ir("`dt_interval_ms` is only supported in every-task evaluation context.");
    }
    if (!evaluation_context.nominal_interval_milliseconds.has_value()) {
      throw_unsupported_runtime_ir("`dt_interval_ms` requires nominal interval milliseconds (internal error).");
    }
    return static_cast<std::int64_t>(evaluation_context.nominal_interval_milliseconds.value());
  }

  std::ostringstream oss;
  oss << "Unsupported expression kind: " << kind;
  throw_unsupported_runtime_ir(oss.str());
}

void KiboHostRuntime::apply_led_effect(const std::string& effect_kind) {
  if (effect_kind == "led.toggle") {
    led0_is_on_ = !led0_is_on_;
    return;
  }
  if (effect_kind == "led.on") {
    led0_is_on_ = true;
    return;
  }
  if (effect_kind == "led.off") {
    led0_is_on_ = false;
    return;
  }
  throw_unsupported_runtime_ir("Unsupported LED effect kind.");
}

void KiboHostRuntime::apply_display_clear() {
  draft_pixels_.fill(0);
}

void KiboHostRuntime::apply_display_circle(int center_x, int center_y, int radius) {
  draw_circle_midpoint(draft_pixels_, center_x, center_y, radius);
}

void KiboHostRuntime::apply_display_present() {
  presented_pixels_ = draft_pixels_;
}

std::string KiboHostRuntime::collect_conformance_trace_line(
    const std::vector<std::string>& script_var_names_to_include_in_trace
) const {
  const std::uint64_t fingerprint = compute_fnv1a64_over_presented_frame_bytes(presented_pixels_);
  const std::string fingerprint_hex = format_fnv1a64_as_lower_hex16(fingerprint);

  std::vector<std::string> sorted_names = script_var_names_to_include_in_trace;
  std::sort(sorted_names.begin(), sorted_names.end());

  std::string vars_segment;
  bool wrote_any_var = false;
  for (const std::string& var_name : sorted_names) {
    const auto iterator = script_vars_.find(var_name);
    if (iterator == script_vars_.end()) {
      continue;
    }
    if (wrote_any_var) {
      vars_segment.push_back('|');
    }
    wrote_any_var = true;
    vars_segment += var_name;
    vars_segment.push_back('=');
    vars_segment += std::to_string(iterator->second);
  }
  if (!wrote_any_var) {
    vars_segment = "-";
  }

  std::ostringstream line;
  // MVP: TypeScript は `listStateMachineInspectRows()` を出す。fixture 範囲では常に `sm=-` と一致するため固定する。
  line << "trace schema=1"
       << " sim_ms=" << total_ms_ << " led0=" << (led0_is_on_ ? 1 : 0) << " btn0=" << (button0_is_pressed_ ? 1 : 0)
       << " dpy_fp=" << fingerprint_hex << " vars=" << vars_segment << " sm=-";
  return line.str();
}

}  // namespace kibo::runtime
