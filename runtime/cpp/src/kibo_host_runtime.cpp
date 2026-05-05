// 責務: `KiboHostRuntime` の実装（fixture 用の最小 runtime semantics）。

#include "kibo_host_runtime.hpp"

#include "kibo_display_geometry.hpp"
#include "kibo_display_glcd_text.hpp"
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

[[nodiscard]] std::vector<std::string> split_dot_segments(const std::string& full_path) {
  std::vector<std::string> segments;
  std::string current;
  for (const char character : full_path) {
    if (character == '.') {
      segments.push_back(current);
      current.clear();
      continue;
    }
    current.push_back(character);
  }
  segments.push_back(current);
  return segments;
}

[[nodiscard]] std::vector<std::string> enumerate_dot_path_prefixes(const std::string& full_path) {
  const std::vector<std::string> segments = split_dot_segments(full_path);
  std::vector<std::string> prefixes;
  std::string built;
  for (std::size_t index = 0; index < segments.size(); index += 1) {
    if (index > 0) {
      built.push_back('.');
    }
    built += segments[index];
    prefixes.push_back(built);
  }
  return prefixes;
}

[[nodiscard]] std::optional<std::string> parent_dot_path_string(const std::string& path) {
  const std::size_t last_dot_index = path.rfind('.');
  if (last_dot_index == std::string::npos) {
    return std::nullopt;
  }
  return path.substr(0, last_dot_index);
}

[[nodiscard]] std::string longest_common_dot_path_prefix(const std::string& left_path, const std::string& right_path) {
  const std::vector<std::string> left_segments = split_dot_segments(left_path);
  const std::vector<std::string> right_segments = split_dot_segments(right_path);
  std::vector<std::string> common_segments;
  const std::size_t maximum_shared_segment_count = std::min(left_segments.size(), right_segments.size());
  for (std::size_t index = 0; index < maximum_shared_segment_count; index += 1) {
    if (left_segments[index] != right_segments[index]) {
      break;
    }
    common_segments.push_back(left_segments[index]);
  }
  if (common_segments.empty()) {
    return "";
  }
  std::string joined = common_segments[0];
  for (std::size_t index = 1; index < common_segments.size(); index += 1) {
    joined.push_back('.');
    joined += common_segments[index];
  }
  return joined;
}

[[nodiscard]] std::vector<std::string> compute_exit_path_sequence_strings(const std::string& old_leaf_path, const std::string& new_leaf_path) {
  const std::string longest_common_prefix_path = longest_common_dot_path_prefix(old_leaf_path, new_leaf_path);
  std::vector<std::string> exit_paths;
  std::optional<std::string> cursor_path = old_leaf_path;
  while (cursor_path.has_value() && *cursor_path != longest_common_prefix_path) {
    exit_paths.push_back(*cursor_path);
    cursor_path = parent_dot_path_string(*cursor_path);
  }
  return exit_paths;
}

[[nodiscard]] std::vector<std::string> compute_enter_path_sequence_strings_initial_boot(const std::string& new_leaf_path) {
  return enumerate_dot_path_prefixes(new_leaf_path);
}

[[nodiscard]] std::vector<std::string> compute_enter_path_sequence_strings_transition(const std::string& old_leaf_path, const std::string& new_leaf_path) {
  if (old_leaf_path == new_leaf_path) {
    return {};
  }
  const std::string longest_common_prefix_path = longest_common_dot_path_prefix(old_leaf_path, new_leaf_path);
  std::vector<std::string> enter_paths;
  for (const std::string& path : enumerate_dot_path_prefixes(new_leaf_path)) {
    if (path == longest_common_prefix_path) {
      continue;
    }
    if (path.length() <= longest_common_prefix_path.length()) {
      continue;
    }
    if (longest_common_prefix_path.empty()) {
      enter_paths.push_back(path);
      continue;
    }
    const std::string expected_prefix = longest_common_prefix_path + ".";
    if (path.rfind(expected_prefix, 0) == 0) {
      enter_paths.push_back(path);
    }
  }
  return enter_paths;
}

[[nodiscard]] std::string escape_state_path_for_trace_segment(const std::string& active_leaf_path) {
  std::string escaped;
  escaped.reserve(active_leaf_path.size() + 8);
  for (const char character : active_leaf_path) {
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
  return escaped;
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
  initialize_state_machines_from_program(compiled_program_json);
  dispatch_initial_state_enter_lifecycle();
  // Guard: TypeScript SimulationRuntime starts `task ... loop` bodies at simulation time 0 before the first trace.
  start_runnable_loop_tasks();
}

void KiboHostRuntime::throw_if_compiled_program_has_unsupported_top_level_features(const nlohmann::json& compiled_program_json) {
  const auto animator_definitions_iterator = compiled_program_json.find("animatorDefinitions");
  if (animator_definitions_iterator != compiled_program_json.end()) {
    const auto& animator_definitions_json = *animator_definitions_iterator;
    if (!animator_definitions_json.is_array()) {
      throw_unsupported_runtime_ir("`animatorDefinitions` must be an array.");
    }
    if (!animator_definitions_json.empty()) {
      throw_unsupported_runtime_ir("C++ host runtime MVP does not support non-empty `animatorDefinitions`.");
    }
  }

  const auto state_machines_iterator = compiled_program_json.find("stateMachines");
  if (state_machines_iterator != compiled_program_json.end()) {
    const auto& state_machines_json = *state_machines_iterator;
    if (!state_machines_json.is_array()) {
      throw_unsupported_runtime_ir("`stateMachines` must be an array.");
    }
  }
}

void KiboHostRuntime::initialize_state_machines_from_program(const nlohmann::json& compiled_program_json) {
  state_machines_.clear();
  state_path_entry_simulation_ms_.clear();

  const auto state_machines_iterator = compiled_program_json.find("stateMachines");
  if (state_machines_iterator == compiled_program_json.end()) {
    return;
  }
  const auto& state_machines_json = *state_machines_iterator;
  if (!state_machines_json.is_array()) {
    throw_unsupported_runtime_ir("`stateMachines` must be an array.");
  }

  for (const auto& state_machine_json : state_machines_json) {
    StateMachineRuntimeModel model{};
    model.machine_name = state_machine_json.at("machineName").get<std::string>();
    model.tick_interval_ms = read_json_number_as_int_or_throw(state_machine_json.at("tickIntervalMilliseconds"));
    model.active_leaf_path = state_machine_json.at("initialLeafPath").get<std::string>();
    model.accumulated_tick_ms = 0;
    model.global_transitions_json = state_machine_json.at("globalTransitions");
    if (!model.global_transitions_json.is_array()) {
      throw_unsupported_runtime_ir("`stateMachines[].globalTransitions` must be an array.");
    }

    const auto& nodes_json = state_machine_json.at("nodes");
    if (!nodes_json.is_array()) {
      throw_unsupported_runtime_ir("`stateMachines[].nodes` must be an array.");
    }
    for (const auto& node_json : nodes_json) {
      const std::string path = node_json.at("path").get<std::string>();
      model.node_by_path_json[path] = node_json;
    }

    state_machines_.push_back(std::move(model));
  }

  for (auto& state_machine : state_machines_) {
    seed_state_path_entry_times_for_leaf_path(state_machine.active_leaf_path);
  }
}

void KiboHostRuntime::dispatch_initial_state_enter_lifecycle() {
  for (const auto& state_machine : state_machines_) {
    const std::vector<std::string> enter_path_sequence =
        compute_enter_path_sequence_strings_initial_boot(state_machine.active_leaf_path);
    for (const std::string& enter_path : enter_path_sequence) {
      dispatch_lifecycle_enter_tasks_for_exact_membership_path(enter_path);
    }
  }
}

std::int64_t KiboHostRuntime::get_elapsed_ms_for_state_path(const std::string& state_path) const {
  const auto iterator = state_path_entry_simulation_ms_.find(state_path);
  if (iterator == state_path_entry_simulation_ms_.end()) {
    return 0;
  }
  return total_ms_ - iterator->second;
}

void KiboHostRuntime::seed_state_path_entry_times_for_leaf_path(const std::string& leaf_path) {
  const std::int64_t timestamp_milliseconds = total_ms_;
  for (const std::string& prefix_path : enumerate_dot_path_prefixes(leaf_path)) {
    state_path_entry_simulation_ms_[prefix_path] = timestamp_milliseconds;
  }
}

bool KiboHostRuntime::is_task_runnable_for_state_membership(const std::optional<std::string>& membership_path) const {
  if (!membership_path.has_value()) {
    return true;
  }
  const std::string& membership = *membership_path;
  const std::size_t first_dot_index = membership.find('.');
  const std::string machine_name =
      first_dot_index == std::string::npos ? membership : membership.substr(0, first_dot_index);

  const StateMachineRuntimeModel* matched_machine = nullptr;
  for (const auto& state_machine : state_machines_) {
    if (state_machine.machine_name == machine_name) {
      matched_machine = &state_machine;
      break;
    }
  }
  if (matched_machine == nullptr) {
    return false;
  }

  const std::string& active_leaf_path = matched_machine->active_leaf_path;
  if (active_leaf_path == membership) {
    return true;
  }
  const std::string prefix = membership + ".";
  if (active_leaf_path.size() > prefix.size() && active_leaf_path.rfind(prefix, 0) == 0) {
    return true;
  }
  return false;
}

void KiboHostRuntime::dispatch_lifecycle_exit_tasks_for_exact_membership_path(const std::string& membership_path) {
  for (auto& task : on_event_tasks_) {
    if (task.trigger_kind != "state_exit") {
      continue;
    }
    if (!task.state_membership_path.has_value() || *task.state_membership_path != membership_path) {
      continue;
    }
    task.temp_values.clear();
    drain_on_event_task_body(task);
  }
}

void KiboHostRuntime::dispatch_lifecycle_enter_tasks_for_exact_membership_path(const std::string& membership_path) {
  for (auto& task : on_event_tasks_) {
    if (task.trigger_kind != "state_enter") {
      continue;
    }
    if (!task.state_membership_path.has_value() || *task.state_membership_path != membership_path) {
      continue;
    }
    task.temp_values.clear();
    drain_on_event_task_body(task);
  }
}

std::optional<std::string> KiboHostRuntime::resolve_configured_leaf_path_or_null(
    StateMachineRuntimeModel& state_machine,
    const std::string& path
) {
  const auto node_iterator = state_machine.node_by_path_json.find(path);
  if (node_iterator == state_machine.node_by_path_json.end()) {
    return std::nullopt;
  }
  const nlohmann::json& node_json = node_iterator->second;
  const auto& child_paths_json = node_json.at("childPaths");
  if (!child_paths_json.is_array()) {
    throw_unsupported_runtime_ir("`stateMachines[].nodes[].childPaths` must be an array.");
  }
  if (child_paths_json.empty()) {
    return path;
  }
  if (!node_json.contains("initialChildLeafPath") || !node_json.at("initialChildLeafPath").is_string()) {
    return std::nullopt;
  }
  const std::string initial_child_leaf_path = node_json.at("initialChildLeafPath").get<std::string>();
  return resolve_configured_leaf_path_or_null(state_machine, initial_child_leaf_path);
}

std::optional<std::string> KiboHostRuntime::evaluate_first_matching_transition_target_or_null(
    StateMachineRuntimeModel& state_machine
) {
  EvaluationContext evaluation_context{};
  evaluation_context.script_vars = &script_vars_;
  evaluation_context.script_string_vars = &script_string_vars_;
  evaluation_context.const_values = &const_values_;
  evaluation_context.temp_values = nullptr;
  evaluation_context.nominal_interval_milliseconds = std::nullopt;
  evaluation_context.run_mode = "init";

  for (const auto& transition_json : state_machine.global_transitions_json) {
    if (!transition_json.is_object()) {
      throw_unsupported_runtime_ir("`globalTransitions[]` items must be objects.");
    }
    const std::int64_t condition_value = evaluate_expression_json(transition_json.at("condition"), evaluation_context);
    if (condition_value != 0) {
      return transition_json.at("targetPath").get<std::string>();
    }
  }

  std::optional<std::string> cursor_node_path = state_machine.active_leaf_path;
  while (cursor_node_path.has_value()) {
    const auto node_iterator = state_machine.node_by_path_json.find(*cursor_node_path);
    if (node_iterator != state_machine.node_by_path_json.end()) {
      const nlohmann::json& node_json = node_iterator->second;
      const auto& local_transitions_json = node_json.at("localTransitions");
      if (!local_transitions_json.is_array()) {
        throw_unsupported_runtime_ir("`localTransitions` must be an array.");
      }
      for (const auto& transition_json : local_transitions_json) {
        if (!transition_json.is_object()) {
          throw_unsupported_runtime_ir("`localTransitions[]` items must be objects.");
        }
        const std::int64_t condition_value = evaluate_expression_json(transition_json.at("condition"), evaluation_context);
        if (condition_value != 0) {
          return transition_json.at("targetPath").get<std::string>();
        }
      }
    }
    cursor_node_path = parent_dot_path_string(*cursor_node_path);
  }

  return std::nullopt;
}

void KiboHostRuntime::apply_state_machine_leaf_transition(
    StateMachineRuntimeModel& state_machine,
    const std::string& old_leaf_path,
    const std::string& new_leaf_path
) {
  for (const std::string& exit_path : compute_exit_path_sequence_strings(old_leaf_path, new_leaf_path)) {
    dispatch_lifecycle_exit_tasks_for_exact_membership_path(exit_path);
  }

  state_machine.active_leaf_path = new_leaf_path;

  const std::int64_t transition_timestamp_milliseconds = total_ms_;
  const std::vector<std::string> enter_path_sequence =
      compute_enter_path_sequence_strings_transition(old_leaf_path, new_leaf_path);
  for (const std::string& enter_path : enter_path_sequence) {
    state_path_entry_simulation_ms_[enter_path] = transition_timestamp_milliseconds;
  }

  for (const std::string& enter_path : enter_path_sequence) {
    dispatch_lifecycle_enter_tasks_for_exact_membership_path(enter_path);
  }
}

void KiboHostRuntime::run_single_state_machine_tick(StateMachineRuntimeModel& state_machine) {
  const std::optional<std::string> transition_target_path = evaluate_first_matching_transition_target_or_null(state_machine);
  if (!transition_target_path.has_value()) {
    return;
  }
  const std::optional<std::string> resolved_new_leaf_path =
      resolve_configured_leaf_path_or_null(state_machine, *transition_target_path);
  if (!resolved_new_leaf_path.has_value()) {
    return;
  }
  if (*resolved_new_leaf_path == state_machine.active_leaf_path) {
    return;
  }
  apply_state_machine_leaf_transition(state_machine, state_machine.active_leaf_path, *resolved_new_leaf_path);
}

void KiboHostRuntime::advance_state_machines(int elapsed_milliseconds) {
  for (auto& state_machine : state_machines_) {
    if (state_machine.tick_interval_ms <= 0) {
      state_machine.accumulated_tick_ms = 0;
      continue;
    }
    state_machine.accumulated_tick_ms += elapsed_milliseconds;
    while (state_machine.accumulated_tick_ms >= state_machine.tick_interval_ms) {
      state_machine.accumulated_tick_ms -= state_machine.tick_interval_ms;
      run_single_state_machine_tick(state_machine);
    }
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
      if (!every_task_json.at("stateMembershipPath").is_string()) {
        throw_unsupported_runtime_ir("`everyTasks[].stateMembershipPath` must be a string when present.");
      }
      task.state_membership_path = every_task_json.at("stateMembershipPath").get<std::string>();
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
      if (!loop_task_json.at("stateMembershipPath").is_string()) {
        throw_unsupported_runtime_ir("`loopTasks[].stateMembershipPath` must be a string when present.");
      }
      task.state_membership_path = loop_task_json.at("stateMembershipPath").get<std::string>();
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
    OnEventTaskRuntime task{};
    task.task_name = on_task_json.at("taskName").get<std::string>();
    task.trigger_kind = trigger_kind;
    task.statements_json = on_task_json.at("statements");
    if (!task.statements_json.is_array()) {
      throw_unsupported_runtime_ir("`onEventTasks[].statements` must be an array.");
    }

    if (trigger_kind == "device_event") {
      const auto& device_address = on_task_json.at("deviceAddress");
      task.device_kind = device_address.at("kind").get<std::string>();
      task.device_id = read_json_number_as_int_or_throw(device_address.at("id"));
      task.event_name = on_task_json.at("eventName").get<std::string>();
      if (on_task_json.contains("stateMembershipPath")) {
        if (!on_task_json.at("stateMembershipPath").is_string()) {
          throw_unsupported_runtime_ir("`onEventTasks[].stateMembershipPath` must be a string when present.");
        }
        task.state_membership_path = on_task_json.at("stateMembershipPath").get<std::string>();
      }
    } else if (trigger_kind == "state_enter" || trigger_kind == "state_exit") {
      if (!on_task_json.contains("stateMembershipPath") || !on_task_json.at("stateMembershipPath").is_string()) {
        throw_unsupported_runtime_ir("`onEventTasks` with state lifecycle triggers must include `stateMembershipPath`.");
      }
      task.state_membership_path = on_task_json.at("stateMembershipPath").get<std::string>();
      task.device_kind.clear();
      task.device_id = 0;
      task.event_name.clear();
    } else {
      std::ostringstream oss;
      oss << "Unsupported onEvent triggerKind: " << trigger_kind;
      throw_unsupported_runtime_ir(oss.str());
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
  advance_state_machines(elapsed_milliseconds);
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
    if (!is_task_runnable_for_state_membership(task.state_membership_path)) {
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
    if (!is_task_runnable_for_state_membership(task.state_membership_path)) {
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
      if (!is_task_runnable_for_state_membership(task.state_membership_path)) {
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
        if (!is_task_runnable_for_state_membership(task.state_membership_path)) {
          break;
        }
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
    if (task.trigger_kind != "device_event") {
      continue;
    }
    if (task.device_kind != device_kind) {
      continue;
    }
    if (task.device_id != device_id) {
      continue;
    }
    if (task.event_name != event_name) {
      continue;
    }
    if (!is_task_runnable_for_state_membership(task.state_membership_path)) {
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
  if (!is_task_runnable_for_state_membership(task.state_membership_path)) {
    task.execution_progress.reset();
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
  if (!is_task_runnable_for_state_membership(task.state_membership_path)) {
    task.execution_progress.reset();
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

    if (device_kind == "serial" && device_id == 0 && method_name == "println" && arguments_json.size() == 1) {
      const auto& argument0 = arguments_json.at(0);
      const std::string argument_kind = argument0.at("kind").get<std::string>();
      const bool is_stringish = [&]() -> bool {
        if (argument_kind == "string_literal") {
          return true;
        }
        if (argument_kind != "var_reference") {
          return false;
        }
        const std::string var_name = argument0.at("varName").get<std::string>();
        return evaluation_context.script_string_vars->find(var_name) != evaluation_context.script_string_vars->end();
      }();
      if (is_stringish) {
        (void)evaluate_expression_as_utf8_string_or_throw(argument0, evaluation_context);
        return;
      }
      (void)evaluate_expression_json(argument0, evaluation_context);
      return;
    }

    if (device_kind == "pwm" && device_id == 0 && method_name == "level" && arguments_json.size() == 1) {
      (void)evaluate_expression_json(arguments_json.at(0), evaluation_context);
      return;
    }
    if (device_kind == "motor" && device_id == 0 && method_name == "power" && arguments_json.size() == 1) {
      (void)evaluate_expression_json(arguments_json.at(0), evaluation_context);
      return;
    }
    if (device_kind == "servo" && device_id == 0 && method_name == "angle" && arguments_json.size() == 1) {
      (void)evaluate_expression_json(arguments_json.at(0), evaluation_context);
      return;
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
      if (method_name == "text" && arguments_json.size() == 3) {
        const int origin_x = static_cast<int>(evaluate_expression_json(arguments_json.at(0), evaluation_context));
        const int origin_y = static_cast<int>(evaluate_expression_json(arguments_json.at(1), evaluation_context));
        const std::string text = evaluate_expression_as_utf8_string_or_throw(arguments_json.at(2), evaluation_context);
        apply_display_text(origin_x, origin_y, text);
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
  if (kind == "state_path_elapsed_reference") {
    const std::string state_path_text = expression_json.at("statePathText").get<std::string>();
    return get_elapsed_ms_for_state_path(state_path_text);
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

  if (kind == "read_property") {
    const auto& device_address = expression_json.at("deviceAddress");
    const std::string device_kind = device_address.at("kind").get<std::string>();
    const int device_id = device_address.at("id").get<int>();
    const std::string property_name = expression_json.at("propertyName").get<std::string>();
    if (device_kind == "adc" && device_id == 0 && property_name == "raw") {
      // Guard: TypeScript `create-default-devices.ts` の `AdcDevice` 既定 raw と一致させる。
      constexpr std::int64_t k_default_adc0_raw_value_for_host_replay = 512;
      return k_default_adc0_raw_value_for_host_replay;
    }
    std::ostringstream oss;
    oss << "Unsupported read_property: " << device_kind << "#" << device_id << "." << property_name;
    throw_unsupported_runtime_ir(oss.str());
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

void KiboHostRuntime::apply_display_text(int origin_x, int origin_y, const std::string& utf8_text) {
  draw_glcd_font_text_ascii_on_framebuffer(draft_pixels_, origin_x, origin_y, utf8_text);
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

  std::string state_machines_segment_text = "-";
  if (!state_machines_.empty()) {
    std::vector<std::pair<std::string, std::string>> machine_rows;
    machine_rows.reserve(state_machines_.size());
    for (const auto& state_machine : state_machines_) {
      machine_rows.emplace_back(state_machine.machine_name, state_machine.active_leaf_path);
    }
    std::sort(machine_rows.begin(), machine_rows.end(), [](const auto& left, const auto& right) {
      return left.first < right.first;
    });
    state_machines_segment_text.clear();
    bool wrote_any_state_machine = false;
    for (const auto& row : machine_rows) {
      if (wrote_any_state_machine) {
        state_machines_segment_text.push_back('|');
      }
      wrote_any_state_machine = true;
      state_machines_segment_text += row.first;
      state_machines_segment_text.push_back('=');
      state_machines_segment_text += escape_state_path_for_trace_segment(row.second);
    }
  }

  std::ostringstream line;
  line << "trace schema=1"
       << " sim_ms=" << total_ms_ << " led0=" << (led0_is_on_ ? 1 : 0) << " btn0=" << (button0_is_pressed_ ? 1 : 0)
       << " dpy_fp=" << fingerprint_hex << " vars=" << vars_segment << " sm=" << state_machines_segment_text;
  return line.str();
}

}  // namespace kibo::runtime
