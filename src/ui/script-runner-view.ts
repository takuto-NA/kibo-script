/**
 * ブラウザ上で複数行 script を `compileScript` し、TaskRegistry へ登録するパネル。
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

  const runButton = document.createElement("button");
  runButton.type = "button";
  runButton.className = "script-runner-button";
  runButton.setAttribute("data-testid", "script-runner-submit-button");
  runButton.textContent = "Compile & run on simulator";

  const resultPre = document.createElement("pre");
  resultPre.className = "script-runner-result";
  resultPre.setAttribute("role", "status");

  runButton.addEventListener("click", () => {
    const loadResult = compileSourceAndRegisterSimulationTasks({
      sourceText: sourceTextArea.value,
      sourceFileName: DEFAULT_SOURCE_FILE_NAME,
      simulationRuntime: params.simulationRuntime,
    });

    if (loadResult.ok === false) {
      resultPre.textContent = JSON.stringify(loadResult.report, null, 2);
      return;
    }

    resultPre.textContent = `ok: registered compiled task(s): ${loadResult.registeredTaskNames.join(", ")}`;
    params.onAfterScriptLoaded();
  });

  rootElement.appendChild(title);
  rootElement.appendChild(sourceTextArea);
  rootElement.appendChild(runButton);
  rootElement.appendChild(resultPre);

  return { rootElement };
}
