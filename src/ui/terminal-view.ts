import type { TerminalHistoryEntry } from "../interactive/terminal-session";
import { TerminalSession } from "../interactive/terminal-session";

const PROMPT_TEXT = ">";

export type TerminalView = {
  rootElement: HTMLElement;
  setOnBeforeSubmitLine(handler: (line: string) => void): void;
  setOnSubmitLine(handler: (line: string) => void): void;
  appendOutputLine(line: string): void;
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
  let onBeforeSubmitLine: (line: string) => void = () => {
    // Optional hook for host (e.g. suppress auto-drain during interactive evaluation)
  };
  const submittedInputHistory: string[] = [];
  let historyCursorIndex = 0;
  let draftInputBeforeHistoryNavigation = "";

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

  function replaceInputValue(value: string): void {
    input.value = value;
    input.setSelectionRange(value.length, value.length);
  }

  function moveToPreviousHistoryEntry(): void {
    if (submittedInputHistory.length === 0) {
      return;
    }
    if (historyCursorIndex === submittedInputHistory.length) {
      draftInputBeforeHistoryNavigation = input.value;
    }
    historyCursorIndex = Math.max(0, historyCursorIndex - 1);
    replaceInputValue(submittedInputHistory[historyCursorIndex] ?? "");
  }

  function moveToNextHistoryEntry(): void {
    if (submittedInputHistory.length === 0) {
      return;
    }
    if (historyCursorIndex >= submittedInputHistory.length) {
      return;
    }
    historyCursorIndex += 1;
    if (historyCursorIndex === submittedInputHistory.length) {
      replaceInputValue(draftInputBeforeHistoryNavigation);
      return;
    }
    replaceInputValue(submittedInputHistory[historyCursorIndex] ?? "");
  }

  function rememberSubmittedLine(line: string): void {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      historyCursorIndex = submittedInputHistory.length;
      return;
    }
    if (submittedInputHistory[submittedInputHistory.length - 1] !== line) {
      submittedInputHistory.push(line);
    }
    historyCursorIndex = submittedInputHistory.length;
    draftInputBeforeHistoryNavigation = "";
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveToPreviousHistoryEntry();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveToNextHistoryEntry();
      return;
    }
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const line = input.value;
    input.value = "";
    rememberSubmittedLine(line);
    onBeforeSubmitLine(line);
    const entry = session.submitLine(line);
    appendHistoryEntry(entry);
    onSubmitLine(line);
  });

  return {
    rootElement: container,
    setOnBeforeSubmitLine(handler: (line: string) => void): void {
      onBeforeSubmitLine = handler;
    },
    setOnSubmitLine(handler: (line: string) => void): void {
      onSubmitLine = handler;
    },
    appendOutputLine(line: string): void {
      appendLine(line, "terminal-line-output");
    },
    appendHistoryEntry,
    focusInput(): void {
      input.focus();
    },
  };
}
