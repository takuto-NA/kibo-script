/**
 * 責務: ブラウザ上で複数行 script をコンパイルし、SimulationRuntime へ reset 登録または additive 登録するパネル。
 */

import { compileSourceAndRegisterSimulationTasks } from "../core/compile-and-register-simulation-script";
import type { CompiledProgram } from "../core/executable-task";
import type { SimulationRuntime } from "../core/simulation-runtime";
import {
  buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow,
  inferLiveTickIntervalMillisecondsFromCompiledProgram,
} from "../runtime-conformance/build-pico-runtime-package-from-runtime-ir-contract";
import { serializeCompiledProgramToRuntimeIrContractJsonText } from "../runtime-conformance/serialize-compiled-program-to-runtime-ir-contract-json-text";

const DEFAULT_SOURCE_FILE_NAME = "browser.sc";
const DEFAULT_RUNTIME_IR_DOWNLOAD_FILE_NAME = "kibo-runtime-ir-contract.json";
const DEFAULT_PICO_RUNTIME_PACKAGE_DOWNLOAD_FILE_NAME = "kibo-pico-runtime-package.json";

export type ScriptRunnerPanel = {
  rootElement: HTMLElement;
};

function split_comma_separated_trace_var_names_or_undefined(trace_var_names_text: string): readonly string[] | undefined {
  const names = trace_var_names_text
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) {
    return undefined;
  }
  return names;
}

function build_pico_link_check_command_hint_text(params: {
  readonly pico_runtime_package_download_file_name: string;
  readonly trace_var_names_text: string;
}): string {
  const trace_var_flag =
    params.trace_var_names_text.trim().length > 0 ? ` --trace-var ${params.trace_var_names_text.trim()}` : "";
  return (
    `Pico one-shot (host): python scripts/pico/runtime_vertical_slice/tools/pico_link_check.py --port auto --runtime-ir ${DEFAULT_RUNTIME_IR_DOWNLOAD_FILE_NAME}\n` +
    `Pico one-shot (host, after downloading package file): python scripts/pico/runtime_vertical_slice/tools/pico_link_check.py --port auto --package-file ${params.pico_runtime_package_download_file_name}${trace_var_flag}\n` +
    `Preflight only: python scripts/pico/runtime_vertical_slice/tools/pico_link_doctor.py --port auto`
  );
}

export function createScriptRunnerPanel(params: {
  simulationRuntime: SimulationRuntime;
  onAfterScriptLoaded: () => void;
}): ScriptRunnerPanel {
  const rootElement = document.createElement("div");
  rootElement.className = "script-runner";

  const title = document.createElement("div");
  title.className = "script-runner-title";
  title.textContent = "StaticCore Script (compile)";

  const sourceTextArea = document.createElement("textarea");
  sourceTextArea.className = "script-runner-textarea";
  sourceTextArea.setAttribute("data-testid", "script-runner-textarea");
  sourceTextArea.rows = 8;
  sourceTextArea.setAttribute("aria-label", "Multiline script source");
  sourceTextArea.spellcheck = false;
  sourceTextArea.value = `ref led = led#0

task blink every 1000ms {
  do led.toggle()
}
`;

  const buttonRow = document.createElement("div");
  buttonRow.className = "script-runner-button-row";

  const resetRunButton = document.createElement("button");
  resetRunButton.type = "button";
  resetRunButton.className = "script-runner-button";
  resetRunButton.setAttribute("data-testid", "script-runner-submit-button");
  resetRunButton.textContent = "Reset & run on simulator";

  const addToRuntimeButton = document.createElement("button");
  addToRuntimeButton.type = "button";
  addToRuntimeButton.className = "script-runner-button script-runner-button-secondary";
  addToRuntimeButton.setAttribute("data-testid", "script-runner-add-button");
  addToRuntimeButton.textContent = "Add to runtime";

  const resultPre = document.createElement("pre");
  resultPre.className = "script-runner-result";
  resultPre.setAttribute("role", "status");

  let last_successful_reset_compiled_program: CompiledProgram | undefined;

  const exportRow = document.createElement("div");
  exportRow.className = "script-runner-button-row";

  const copyRuntimeIrButton = document.createElement("button");
  copyRuntimeIrButton.type = "button";
  copyRuntimeIrButton.className = "script-runner-button script-runner-button-secondary";
  copyRuntimeIrButton.setAttribute("data-testid", "script-runner-copy-runtime-ir-button");
  copyRuntimeIrButton.textContent = "Copy runtime IR (reset compile)";

  const downloadRuntimeIrButton = document.createElement("button");
  downloadRuntimeIrButton.type = "button";
  downloadRuntimeIrButton.className = "script-runner-button script-runner-button-secondary";
  downloadRuntimeIrButton.setAttribute("data-testid", "script-runner-download-runtime-ir-button");
  downloadRuntimeIrButton.textContent = "Download runtime IR (reset compile)";

  const traceVarLabel = document.createElement("label");
  traceVarLabel.className = "script-runner-trace-var-label";
  traceVarLabel.textContent = "Pico trace vars (comma-separated, optional):";
  traceVarLabel.setAttribute("for", "script-runner-trace-vars-input");

  const traceVarInput = document.createElement("input");
  traceVarInput.id = "script-runner-trace-vars-input";
  traceVarInput.className = "script-runner-trace-var-input";
  traceVarInput.setAttribute("data-testid", "script-runner-trace-vars-input");
  traceVarInput.type = "text";
  traceVarInput.setAttribute("aria-label", "Comma-separated script variable names for Pico trace export");
  traceVarInput.placeholder = "circle_x (leave blank to use defaults)";

  const downloadPicoPackageButton = document.createElement("button");
  downloadPicoPackageButton.type = "button";
  downloadPicoPackageButton.className = "script-runner-button script-runner-button-secondary";
  downloadPicoPackageButton.setAttribute("data-testid", "script-runner-download-pico-package-button");
  downloadPicoPackageButton.textContent = "Download Pico package (reset compile)";

  const mvpNote = document.createElement("div");
  mvpNote.className = "script-runner-mvp-note";
  mvpNote.textContent =
    "Pico MVP: export infers live tick from the first `every` task interval (or defaults), replay steps from every/on_event tasks, and includes `circle_x` in trace when declared.";

  const cliHintPre = document.createElement("pre");
  cliHintPre.className = "script-runner-cli-hint";
  cliHintPre.textContent =
    "Pico MVP: build a package in the UI, or use npm script + pyserial.\n" +
    "  npm run build-pico-runtime-package -- --input kibo-runtime-ir-contract.json --output package.json\n" +
    "  python scripts/pico/runtime_vertical_slice/tools/upload_pico_runtime_package.py --port auto --package-file package.json\n" +
    "Golden packages for the three MVP fixtures live under tests/runtime-conformance/golden/pico-runtime-packages/.";

  function runCompile(registrationMode: "reset" | "add"): void {
    const loadResult = compileSourceAndRegisterSimulationTasks({
      sourceText: sourceTextArea.value,
      sourceFileName: DEFAULT_SOURCE_FILE_NAME,
      simulationRuntime: params.simulationRuntime,
      registrationMode,
    });

    if (loadResult.ok === false) {
      resultPre.textContent = JSON.stringify(loadResult.report, null, 2);
      return;
    }

    if (registrationMode === "reset") {
      last_successful_reset_compiled_program = loadResult.compiledProgram;
    }

    const modeLabel = registrationMode === "reset" ? "reset+registered" : "add+registered";
    resultPre.textContent = `ok (${modeLabel}) compiled task(s): ${loadResult.registeredTaskNames.join(", ")}`;
    params.onAfterScriptLoaded();
  }

  function resolve_runtime_ir_contract_json_text_or_set_error_pre(): string | undefined {
    if (last_successful_reset_compiled_program === undefined) {
      resultPre.textContent =
        "No successful reset compile yet. Click “Reset & run on simulator” before exporting runtime IR.";
      return undefined;
    }
    return serializeCompiledProgramToRuntimeIrContractJsonText(last_successful_reset_compiled_program);
  }

  async function copy_runtime_ir_contract_json_text_to_clipboard_or_set_error_pre(): Promise<void> {
    const json_text = resolve_runtime_ir_contract_json_text_or_set_error_pre();
    if (json_text === undefined) {
      return;
    }
    try {
      await navigator.clipboard.writeText(json_text);
      resultPre.textContent = "ok: runtime IR contract JSON copied to clipboard.";
    } catch {
      resultPre.textContent =
        "Clipboard write failed. Use Download runtime IR instead, or grant clipboard permission for this origin.";
    }
  }

  function download_runtime_ir_contract_json_text_or_set_error_pre(): void {
    const json_text = resolve_runtime_ir_contract_json_text_or_set_error_pre();
    if (json_text === undefined) {
      return;
    }
    const blob = new Blob([json_text], { type: "application/json;charset=utf-8" });
    const object_url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = object_url;
    anchor.download = DEFAULT_RUNTIME_IR_DOWNLOAD_FILE_NAME;
    anchor.click();
    URL.revokeObjectURL(object_url);
    resultPre.textContent = `ok: downloaded ${DEFAULT_RUNTIME_IR_DOWNLOAD_FILE_NAME}`;
  }

  function download_pico_runtime_package_json_text_or_set_error_pre(): void {
    if (last_successful_reset_compiled_program === undefined) {
      resultPre.textContent =
        "No successful reset compile yet. Click “Reset & run on simulator” before downloading a Pico package.";
      return;
    }

    const trace_var_names_override = split_comma_separated_trace_var_names_or_undefined(traceVarInput.value);
    let package_text: string;
    try {
      package_text = buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow({
        compiledProgram: last_successful_reset_compiled_program,
        scriptVarNamesToIncludeInTraceOverride: trace_var_names_override,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resultPre.textContent = `FAIL: could not build PicoRuntimePackage from compiled program: ${message}`;
      return;
    }

    const live_tick_interval_milliseconds = inferLiveTickIntervalMillisecondsFromCompiledProgram(
      last_successful_reset_compiled_program,
    );
    const first_every_interval_milliseconds =
      last_successful_reset_compiled_program.everyTasks.length > 0
        ? String(last_successful_reset_compiled_program.everyTasks[0].intervalMilliseconds)
        : "(no every tasks; default live tick used)";

    const blob = new Blob([package_text], { type: "application/json;charset=utf-8" });
    const object_url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = object_url;
    anchor.download = DEFAULT_PICO_RUNTIME_PACKAGE_DOWNLOAD_FILE_NAME;
    anchor.click();
    URL.revokeObjectURL(object_url);

    const pico_link_hint = build_pico_link_check_command_hint_text({
      pico_runtime_package_download_file_name: DEFAULT_PICO_RUNTIME_PACKAGE_DOWNLOAD_FILE_NAME,
      trace_var_names_text: traceVarInput.value,
    });

    resultPre.textContent = [
      `ok: downloaded ${DEFAULT_PICO_RUNTIME_PACKAGE_DOWNLOAD_FILE_NAME}`,
      `Inferred live.tickIntervalMilliseconds=${live_tick_interval_milliseconds} (first every interval: ${first_every_interval_milliseconds})`,
      "",
      pico_link_hint,
    ].join("\n");
  }

  resetRunButton.addEventListener("click", () => {
    runCompile("reset");
  });

  addToRuntimeButton.addEventListener("click", () => {
    runCompile("add");
  });

  copyRuntimeIrButton.addEventListener("click", () => {
    void copy_runtime_ir_contract_json_text_to_clipboard_or_set_error_pre();
  });

  downloadRuntimeIrButton.addEventListener("click", () => {
    download_runtime_ir_contract_json_text_or_set_error_pre();
  });

  downloadPicoPackageButton.addEventListener("click", () => {
    download_pico_runtime_package_json_text_or_set_error_pre();
  });

  buttonRow.appendChild(resetRunButton);
  buttonRow.appendChild(addToRuntimeButton);

  exportRow.appendChild(copyRuntimeIrButton);
  exportRow.appendChild(downloadRuntimeIrButton);
  exportRow.appendChild(traceVarLabel);
  exportRow.appendChild(traceVarInput);
  exportRow.appendChild(downloadPicoPackageButton);

  rootElement.appendChild(title);
  rootElement.appendChild(sourceTextArea);
  rootElement.appendChild(buttonRow);
  rootElement.appendChild(exportRow);
  rootElement.appendChild(mvpNote);
  rootElement.appendChild(cliHintPre);
  rootElement.appendChild(resultPre);

  return { rootElement };
}
