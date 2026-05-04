/**
 * 責務: ブラウザ上で複数行 script をコンパイルし、SimulationRuntime へ reset 登録または additive 登録するパネル。
 */

import { compileSourceAndRegisterSimulationTasks } from "../core/compile-and-register-simulation-script";
import type { CompiledProgram } from "../core/executable-task";
import type { SimulationRuntime } from "../core/simulation-runtime";
import { serializeCompiledProgramToRuntimeIrContractJsonText } from "../runtime-conformance/serialize-compiled-program-to-runtime-ir-contract-json-text";

const DEFAULT_SOURCE_FILE_NAME = "browser.sc";
const DEFAULT_RUNTIME_IR_DOWNLOAD_FILE_NAME = "kibo-runtime-ir-contract.json";

export type ScriptRunnerPanel = {
  rootElement: HTMLElement;
};

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

  const cliHintPre = document.createElement("pre");
  cliHintPre.className = "script-runner-cli-hint";
  cliHintPre.textContent =
    "Pico MVP: build a package with the CLI (pyserial), then upload.\n" +
    "  python scripts/pico/runtime_vertical_slice/tools/upload_pico_runtime_package.py --port COM11 --package-file <path-to-package.json>\n" +
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

  buttonRow.appendChild(resetRunButton);
  buttonRow.appendChild(addToRuntimeButton);

  exportRow.appendChild(copyRuntimeIrButton);
  exportRow.appendChild(downloadRuntimeIrButton);

  rootElement.appendChild(title);
  rootElement.appendChild(sourceTextArea);
  rootElement.appendChild(buttonRow);
  rootElement.appendChild(exportRow);
  rootElement.appendChild(cliHintPre);
  rootElement.appendChild(resultPre);

  return { rootElement };
}
