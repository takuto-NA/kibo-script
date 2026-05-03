// 責務: `kibo_runtime_replay_runner.hpp` の実装。

#include "kibo_runtime_replay_runner.hpp"

#include "kibo_host_runtime.hpp"
#include "kibo_json_read_integer.hpp"

#include <sstream>
#include <stdexcept>
#include <vector>

namespace kibo::runtime {

void run_runtime_conformance_replay_document(
    const nlohmann::json& replay_document,
    const std::function<void(const std::string&)>& emit_line,
) {
  const int replay_schema_version = read_json_number_as_int_or_throw(replay_document.at("replaySchemaVersion"));
  if (replay_schema_version != 1) {
    throw std::runtime_error("Unsupported replaySchemaVersion.");
  }

  const nlohmann::json& runtime_ir_contract = replay_document.at("runtimeIrContract");
  KiboHostRuntime host_runtime(runtime_ir_contract);

  const std::vector<std::string> script_var_names_to_include_in_trace =
      replay_document.at("traceObservation").at("scriptVarNamesToIncludeInTrace").get<std::vector<std::string>>();

  const nlohmann::json& steps = replay_document.at("steps");
  if (!steps.is_array()) {
    throw std::runtime_error("`steps` must be an array.");
  }

  for (const auto& step : steps) {
    const std::string step_kind = step.at("kind").get<std::string>();
    if (step_kind == "collect_trace") {
      const std::string trace_line =
          host_runtime.collect_conformance_trace_line(script_var_names_to_include_in_trace);
      emit_line(trace_line);
      continue;
    }
    if (step_kind == "tick_ms") {
      const int elapsed_milliseconds = read_json_number_as_int_or_throw(step.at("elapsedMilliseconds"));
      host_runtime.tick_milliseconds(elapsed_milliseconds);
      continue;
    }
    if (step_kind == "dispatch_device_event") {
      const std::string device_kind = step.at("deviceKind").get<std::string>();
      const int device_id = read_json_number_as_int_or_throw(step.at("deviceId"));
      const std::string event_name = step.at("eventName").get<std::string>();
      host_runtime.dispatch_device_event(device_kind, device_id, event_name);
      continue;
    }

    std::ostringstream oss;
    oss << "Unsupported step kind: " << step_kind;
    throw std::runtime_error(oss.str());
  }
}

}  // namespace kibo::runtime
