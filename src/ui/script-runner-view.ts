/**
 * 責務: ブラウザ上で複数行 script をコンパイルし、SimulationRuntime へ reset 登録または additive 登録するパネル。
 */

import { compileSourceAndRegisterSimulationTasks } from "../core/compile-and-register-simulation-script";
import type { SimulationRuntime } from "../core/simulation-runtime";

const DEFAULT_SOURCE_FILE_NAME = "browser.sc";

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

    const modeLabel = registrationMode === "reset" ? "reset+registered" : "add+registered";
    resultPre.textContent = `ok (${modeLabel}) compiled task(s): ${loadResult.registeredTaskNames.join(", ")}`;
    params.onAfterScriptLoaded();
  }

  resetRunButton.addEventListener("click", () => {
    runCompile("reset");
  });

  addToRuntimeButton.addEventListener("click", () => {
    runCompile("add");
  });

  buttonRow.appendChild(resetRunButton);
  buttonRow.appendChild(addToRuntimeButton);

  rootElement.appendChild(title);
  rootElement.appendChild(sourceTextArea);
  rootElement.appendChild(buttonRow);
  rootElement.appendChild(resultPre);

  return { rootElement };
}
