// 責務: `KiboHostRuntime` の実装（fixture 用の最小 runtime semantics）。

#include "kibo_host_runtime.hpp"

#include "kibo_display_geometry.hpp"
#include "kibo_fnv1a64.hpp"
#include "kibo_json_read_integer.hpp"

#include <algorithm>
#include <cstddef>
#include <sstream>
#include <stdexcept>

namespace kibo::runtime {

namespace {

[[noreturn]] void throw_unsupported_runtime_ir(const std::string& message) {
  throw std::runtime_error(message);
}

void erase_script_string_var_if_present(
    const std::string& var_name,
    std::unordered_map<std::string, std::string>& script_string_vars
) {
  script_string_vars.erase(var_name);
}

void erase_script_int_var_if_present(
    const std::string& var_name,
    std::unordered_map<std::string, std::int64_t>& script_vars
) {
  script_vars.erase(var_name);
}

[[nodiscard]] std::string encode_script_string_var_value_for_trace(const std::string& raw_value) {
  std::string escaped;
  escaped.reserve(raw_value.size() + 2);
  for (const char character : raw_value) {
    if (character == '|') {
      escaped += "\\|";
      continue;
    }
    if (character == '=') {
      escaped += "\\=";
      continue;
    }
    escaped.push_back(character);
  }
  return std::string("\"") + escaped + "\"";
}

[[nodiscard]] bool try_read_json_string_value(const nlohmann::json& value_json, std::string& out_string) {
  if (!value_json.is_string()) {
    return false;
  }
  out_string = value_json.get<std::string>();
  return true;
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

  throw_if_compiled_program_has_unsupported_top_level_features(compiled_program_json);

  initialize_script_vars_from_program(compiled_program_json);
  initialize_const_values_from_program(compiled_program_json);
  register_every_tasks_from_program(compiled_program_json);
  register_loop_tasks_from_program(compiled_program_json);
  register_on_event_tasks_from_program(compiled_program_json);
}

void KiboHostRuntime::throw_if_compiled_program_has_unsupported_top_level_features(const nlohmann::json& compiled_program_json) {
  const auto state_machines_iterator = compiled_program_json.find("stateMachines");
  if (state_machines_iterator == compiled_program_json.end()) {
    return;
  }
  const auto& state_machines_json = *state_machines_iterator;
  if (!state_machines_json.is_array()) {
    throw_unsupported_runtime_ir("`stateMachines` must be an array.");
  }
  if (!state_machines_json.empty()) {
    throw_unsupported_runtime_ir("C++ host runtime MVP does not support `stateMachines` yet.");
  }
}

void KiboHostRuntime::initialize_script_vars_from_program(const nlohmann::json& compiled_program_json) {
  script_vars_.clear();
  script_string_vars_.clear();
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
    evaluation_context.script_string_vars = &script_string_vars_;
    evaluation_context.const_values = &const_values_;
    evaluation_context.temp_values = nullptr;
    evaluation_context.nominal_interval_milliseconds = std::nullopt;
    evaluation_context.run_mode = "init";
    const auto& expression_json = initializer.at("expression");
    const std::string expression_kind = expression_json.at("kind").get<std::string>();
    if (expression_kind == "string_literal") {
      std::string string_value;
      if (!try_read_json_string_value(expression_json.at("value"), string_value)) {
        throw_unsupported_runtime_ir("`string_literal.value` must be a JSON string.");
      }
      script_string_vars_[var_name] = std::move(string_value);
      erase_script_int_var_if_present(var_name, script_vars_);
      continue;
    }
    const std::int64_t value = evaluate_expression_json(expression_json, evaluation_context);
    script_vars_[var_name] = value;
    erase_script_string_var_if_present(var_name, script_string_vars_);
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
    evaluation_context.script_string_vars = &script_string_vars_;
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

void KiboHostRuntime::register_loop_tasks_from_program(const nlohmann::json& compiled_program_json) {
  loop_tasks_.clear();
  const auto iterator = compiled_program_json.find("loopTasks");
  if (iterator == compiled_program_json.end()) {
    return;
  }
  const auto& loop_tasks_json = *iterator;
  if (!loop_tasks_json.is_array()) {
    throw_unsupported_runtime_ir("`loopTasks` must be an array.");
  }
  for (const auto& loop_task_json : loop_tasks_json) {
    LoopTaskRuntime task{};
    task.task_name = loop_task_json.at("taskName").get<std::string>();
    task.statements_json = loop_task_json.at("statements");
    if (!task.statements_json.is_array()) {
      throw_unsupported_runtime_ir("`loopTasks[].statements` must be an array.");
    }
    if (loop_task_json.contains("stateMembershipPath")) {
      throw_unsupported_runtime_ir("C++ host runtime MVP does not support `stateMembershipPath` on loop tasks.");
    }
    loop_tasks_.push_back(std::move(task));
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
  resume_waiting_loop_tasks();
  // MVP: TypeScript `SimulationRuntime.tick` は `advanceStateMachines` も呼ぶが、state machine 未対応のため省略する。
  advance_every_tasks(elapsed_milliseconds);
  start_runnable_loop_tasks();
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

void KiboHostRuntime::resume_waiting_loop_tasks() {
  for (auto& task : loop_tasks_) {
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
    drain_loop_task_body(task);
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

void KiboHostRuntime::start_runnable_loop_tasks() {
  for (auto& task : loop_tasks_) {
    for (;;) {
      if (!task.execution_progress.has_value()) {
        TaskExecutionProgress progress{};
        progress.program_counter = 0;
        progress.resume_at_total_ms.reset();
        task.execution_progress = progress;
      } else {
        if (task.execution_progress->resume_at_total_ms.has_value()) {
          break;
        }
        if (task.execution_progress->program_counter != 0) {
          break;
        }
      }
      drain_loop_task_body(task);
      if (!task.execution_progress.has_value()) {
        break;
      }
      if (task.execution_progress->resume_at_total_ms.has_value()) {
        break;
      }
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
  evaluation_context.script_string_vars = &script_string_vars_;
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
  evaluation_context.script_string_vars = &script_string_vars_;
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

void KiboHostRuntime::drain_loop_task_body(LoopTaskRuntime& task) {
  if (!task.execution_progress.has_value()) {
    return;
  }

  EvaluationContext evaluation_context{};
  evaluation_context.script_vars = &script_vars_;
  evaluation_context.script_string_vars = &script_string_vars_;
  evaluation_context.const_values = &const_values_;
  evaluation_context.temp_values = &task.temp_values;
  evaluation_context.nominal_interval_milliseconds = std::nullopt;
  evaluation_context.run_mode = "loop";

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
      task.execution_progress->program_counter = 0;
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

void KiboHostRuntime::execute_statements_json_array_without_wait_milliseconds(
    const nlohmann::json& statements_json_array,
    EvaluationContext& evaluation_context
) {
  if (!statements_json_array.is_array()) {
    throw_unsupported_runtime_ir("Statement list must be a JSON array.");
  }
  for (const auto& statement_json : statements_json_array) {
    const std::string statement_kind = statement_json.at("kind").get<std::string>();
    if (statement_kind == "wait_milliseconds") {
      throw_unsupported_runtime_ir("wait_milliseconds is not allowed in this statement block (match/if branch).");
    }
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
    const auto& value_expression = statement_json.at("valueExpression");
    const std::string value_kind = value_expression.at("kind").get<std::string>();
    if (value_kind == "string_literal") {
      std::string string_value;
      if (!try_read_json_string_value(value_expression.at("value"), string_value)) {
        throw_unsupported_runtime_ir("`string_literal.value` must be a JSON string.");
      }
      (*evaluation_context.script_string_vars)[var_name] = std::move(string_value);
      erase_script_int_var_if_present(var_name, *evaluation_context.script_vars);
      return;
    }
    const std::int64_t next_value = evaluate_expression_json(value_expression, evaluation_context);
    (*evaluation_context.script_vars)[var_name] = next_value;
    erase_script_string_var_if_present(var_name, *evaluation_context.script_string_vars);
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

  if (statement_kind == "if_comparison") {
    const bool condition_is_truthy =
        evaluate_expression_truthy_for_if_comparison(statement_json.at("conditionExpression"), evaluation_context);
    const auto& branch_statements_json =
        condition_is_truthy ? statement_json.at("thenBranchStatements") : statement_json.at("elseBranchStatements");
    execute_statements_json_array_without_wait_milliseconds(branch_statements_json, evaluation_context);
    return;
  }

  if (statement_kind == "match_string") {
    const std::string matched_text =
        evaluate_expression_as_utf8_string_or_throw(statement_json.at("targetExpression"), evaluation_context);
    const auto& string_cases_json = statement_json.at("stringCases");
    if (!string_cases_json.is_array()) {
      throw_unsupported_runtime_ir("`match_string.stringCases` must be an array.");
    }
    const nlohmann::json* chosen_branch_statements = nullptr;
    for (const auto& string_case_json : string_cases_json) {
      const std::string pattern_string = string_case_json.at("patternString").get<std::string>();
      if (pattern_string == matched_text) {
        chosen_branch_statements = &string_case_json.at("branchStatements");
        break;
      }
    }
    if (chosen_branch_statements == nullptr) {
      chosen_branch_statements = &statement_json.at("elseBranchStatements");
    }
    execute_statements_json_array_without_wait_milliseconds(*chosen_branch_statements, evaluation_context);
    return;
  }

  std::ostringstream oss;
  oss << "Unsupported statement kind: " << statement_kind;
  throw_unsupported_runtime_ir(oss.str());
}

bool KiboHostRuntime::evaluate_expression_truthy_for_if_comparison(
    const nlohmann::json& expression_json,
    EvaluationContext& evaluation_context
) {
  const std::int64_t as_integer = evaluate_expression_json(expression_json, evaluation_context);
  return as_integer != 0;
}

std::string KiboHostRuntime::evaluate_expression_as_utf8_string_or_throw(
    const nlohmann::json& expression_json,
    EvaluationContext& evaluation_context
) {
  const std::string kind = expression_json.at("kind").get<std::string>();
  if (kind == "string_literal") {
    std::string string_value;
    if (!try_read_json_string_value(expression_json.at("value"), string_value)) {
      throw_unsupported_runtime_ir("`string_literal.value` must be a JSON string.");
    }
    return string_value;
  }
  if (kind == "var_reference") {
    const std::string var_name = expression_json.at("varName").get<std::string>();
    const auto iterator = evaluation_context.script_string_vars->find(var_name);
    if (iterator == evaluation_context.script_string_vars->end()) {
      std::ostringstream oss;
      oss << "Unknown string var in var_reference: " << var_name;
      throw_unsupported_runtime_ir(oss.str());
    }
    return iterator->second;
  }
  std::ostringstream oss;
  oss << "Unsupported expression kind for string context: " << kind;
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
  if (kind == "string_literal") {
    throw_unsupported_runtime_ir("string_literal is not valid in an integer expression context.");
  }
  if (kind == "var_reference") {
    const std::string var_name = expression_json.at("varName").get<std::string>();
    const auto iterator = evaluation_context.script_vars->find(var_name);
    if (iterator == evaluation_context.script_vars->end()) {
      std::ostringstream oss;
      oss << "Unknown int var in var_reference: " << var_name;
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
  if (kind == "comparison") {
    const std::string op = expression_json.at("operator").get<std::string>();
    const auto& left_json = expression_json.at("left");
    const auto& right_json = expression_json.at("right");

    const auto is_stringish = [&](const nlohmann::json& expr_json) -> bool {
      const std::string expr_kind = expr_json.at("kind").get<std::string>();
      if (expr_kind == "string_literal") {
        return true;
      }
      if (expr_kind == "var_reference") {
        const std::string var_name = expr_json.at("varName").get<std::string>();
        return evaluation_context.script_string_vars->find(var_name) != evaluation_context.script_string_vars->end();
      }
      return false;
    };

    const bool left_is_stringish = is_stringish(left_json);
    const bool right_is_stringish = is_stringish(right_json);
    if (left_is_stringish || right_is_stringish) {
      if (!left_is_stringish || !right_is_stringish) {
        throw_unsupported_runtime_ir("comparison between string and non-string is not supported in C++ host runtime MVP.");
      }
      const std::string left_text = evaluate_expression_as_utf8_string_or_throw(left_json, evaluation_context);
      const std::string right_text = evaluate_expression_as_utf8_string_or_throw(right_json, evaluation_context);
      if (op == "==") {
        return (left_text == right_text) ? 1 : 0;
      }
      if (op == "!=") {
        return (left_text != right_text) ? 1 : 0;
      }
      throw_unsupported_runtime_ir("Unsupported string comparison operator for MVP.");
    }

    const std::int64_t left = evaluate_expression_json(left_json, evaluation_context);
    const std::int64_t right = evaluate_expression_json(right_json, evaluation_context);
    if (op == "==") {
      return (left == right) ? 1 : 0;
    }
    if (op == "!=") {
      return (left != right) ? 1 : 0;
    }
    if (op == "<") {
      return (left < right) ? 1 : 0;
    }
    if (op == "<=") {
      return (left <= right) ? 1 : 0;
    }
    if (op == ">") {
      return (left > right) ? 1 : 0;
    }
    if (op == ">=") {
      return (left >= right) ? 1 : 0;
    }
    std::ostringstream oss;
    oss << "Unsupported comparison operator: " << op;
    throw_unsupported_runtime_ir(oss.str());
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
    const auto int_iterator = script_vars_.find(var_name);
    if (int_iterator != script_vars_.end()) {
      if (wrote_any_var) {
        vars_segment.push_back('|');
      }
      wrote_any_var = true;
      vars_segment += var_name;
      vars_segment.push_back('=');
      vars_segment += std::to_string(int_iterator->second);
      continue;
    }
    const auto string_iterator = script_string_vars_.find(var_name);
    if (string_iterator != script_string_vars_.end()) {
      if (wrote_any_var) {
        vars_segment.push_back('|');
      }
      wrote_any_var = true;
      vars_segment += var_name;
      vars_segment.push_back('=');
      vars_segment += encode_script_string_var_value_for_trace(string_iterator->second);
      continue;
    }
  }
  if (!wrote_any_var) {
    vars_segment = "-";
  }

  std::ostringstream line;
  // MVP: TypeScript は `listStateMachineInspectRows()` を出す。state machine 未対応のため常に `sm=-`。
  line << "trace schema=1"
       << " sim_ms=" << total_ms_ << " led0=" << (led0_is_on_ ? 1 : 0) << " btn0=" << (button0_is_pressed_ ? 1 : 0)
       << " dpy_fp=" << fingerprint_hex << " vars=" << vars_segment << " sm=-";
  return line.str();
}

}  // namespace kibo::runtime
