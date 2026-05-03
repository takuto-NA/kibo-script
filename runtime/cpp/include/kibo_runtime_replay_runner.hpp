#pragma once

#include <functional>
#include <nlohmann/json.hpp>
#include <string>

namespace kibo::runtime {

/**
 * 責務: `replay.json`（schema v1）を読み取り、`KiboHostRuntime` 上で steps を実行し、collect_trace のたびに `emit_line` を呼ぶ。
 */
void run_runtime_conformance_replay_document(
    const nlohmann::json& replay_document,
    const std::function<void(const std::string&)>& emit_line,
);

}  // namespace kibo::runtime
