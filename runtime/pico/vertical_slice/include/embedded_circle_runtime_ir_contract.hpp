#pragma once

namespace kibo::pico::embedded_runtime_ir {

// 責務: `tests/runtime-conformance/golden/circle-animation.runtime-ir-contract.json` と同一内容（minify）を埋め込み、Pico 実機で JSON parse する。
//
// 注意: golden を更新したら、この文字列も同じ手順で更新すること。
inline constexpr char kCircleAnimationRuntimeIrContractJson[] = R"ir({"runtimeIrContractSchemaVersion":1,"compiledProgram":{"animatorDefinitions":[],"constInitializers":[],"deviceAliases":[],"everyTasks":[{"intervalMilliseconds":100,"statements":[{"arguments":[],"deviceAddress":{"id":0,"kind":"display"},"kind":"do_method_call","methodName":"clear"},{"arguments":[{"kind":"var_reference","varName":"circle_x"},{"kind":"integer_literal","value":32},{"kind":"integer_literal","value":8}],"deviceAddress":{"id":0,"kind":"display"},"kind":"do_method_call","methodName":"circle"},{"arguments":[],"deviceAddress":{"id":0,"kind":"display"},"kind":"do_method_call","methodName":"present"},{"kind":"assign_var","valueExpression":{"kind":"binary_add","left":{"kind":"var_reference","varName":"circle_x"},"right":{"kind":"integer_literal","value":4}},"varName":"circle_x"}],"taskName":"move_circle"}],"loopTasks":[],"onEventTasks":[],"stateMachines":[],"varInitializers":[{"expression":{"kind":"integer_literal","value":20},"varName":"circle_x"}],"varWriterAssignments":[{"varName":"circle_x","writerTaskName":"move_circle"}]}})ir";

}  // namespace kibo::pico::embedded_runtime_ir
