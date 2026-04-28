import type { TerminalHistoryEntry } from "../interactive/terminal-session";
import { TerminalSession } from "../interactive/terminal-session";

const PROMPT_TEXT = ">";

export type TerminalView = {
  rootElement: HTMLElement;
  setOnSubmitLine(handler: (line: string) => void): void;
  appendHistoryEntry(entry: TerminalHistoryEntry): void;
  focusInput(): void;
};

/**
 * DOM terminal: scrollback, prompt, diagnostic JSON toggle.
 */
export function createTerminalView(
  rootElement: HTMLElement,
  session: TerminalSession,
): TerminalView {
  const container = document.createElement("div");
  container.className = "terminal";

  const output = document.createElement("div");
  output.className = "terminal-output";
  output.setAttribute("role", "log");
  output.setAttribute("aria-live", "polite");

  const inputRow = document.createElement("div");
  inputRow.className = "terminal-input-row";

  const prompt = document.createElement("span");
  prompt.className = "terminal-prompt";
  prompt.textContent = PROMPT_TEXT;

  const input = document.createElement("input");
  input.className = "terminal-input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Simulator command line");

  inputRow.appendChild(prompt);
  inputRow.appendChild(input);

  container.appendChild(output);
  container.appendChild(inputRow);
  rootElement.appendChild(container);

  let onSubmitLine: (line: string) => void = () => {
    // Optional hook for host (e.g. refresh canvas)
  };

  function appendLine(text: string, className: string): void {
    const line = document.createElement("div");
    line.className = className;
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  }

  function appendDiagnosticJson(report: TerminalHistoryEntry["diagnosticReport"]): void {
    if (report === undefined) {
      return;
    }
    const jsonLine = document.createElement("pre");
    jsonLine.className = "terminal-diagnostics-json";
    jsonLine.textContent = JSON.stringify(report, null, 2);
    output.appendChild(jsonLine);
    output.scrollTop = output.scrollHeight;
  }

  function appendHistoryEntry(entry: TerminalHistoryEntry): void {
    appendLine(entry.input, "terminal-line-input");
    for (const out of entry.outputs) {
      appendLine(out, "terminal-line-output");
    }
    appendDiagnosticJson(entry.diagnosticReport);
  }

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const line = input.value;
    input.value = "";
    const entry = session.submitLine(line);
    appendHistoryEntry(entry);
    onSubmitLine(line);
  });

  return {
    rootElement: container,
    setOnSubmitLine(handler: (line: string) => void): void {
      onSubmitLine = handler;
    },
    appendHistoryEntry,
    focusInput(): void {
      input.focus();
    },
  };
}
