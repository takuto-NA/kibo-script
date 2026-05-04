import type { TerminalHistoryEntry } from "../interactive/terminal-session";
import { TerminalSession } from "../interactive/terminal-session";
import {
  TERMINAL_AUTO_SCROLL_BOTTOM_THRESHOLD_PIXELS,
  is_scroll_position_within_bottom_threshold_for_terminal_output,
  should_show_jump_to_latest_button_for_terminal_output,
  type ScrollMetricsForTerminalOutput,
} from "./terminal-scroll-behavior";

const PROMPT_TEXT = ">";

export type TerminalView = {
  rootElement: HTMLElement;
  setOnBeforeSubmitLine(handler: (line: string) => void): void;
  setOnSubmitLine(handler: (line: string) => void): void;
  appendOutputLine(line: string): void;
  appendHistoryEntry(entry: TerminalHistoryEntry): void;
  focusInput(): void;
};

function read_scroll_metrics_from_terminal_output_element(output_element: HTMLElement): ScrollMetricsForTerminalOutput {
  return {
    scrollTopPixels: output_element.scrollTop,
    clientHeightPixels: output_element.clientHeight,
    scrollHeightPixels: output_element.scrollHeight,
  };
}

function was_terminal_output_scrolled_to_bottom_or_near_bottom(output_element: HTMLElement): boolean {
  return is_scroll_position_within_bottom_threshold_for_terminal_output({
    scroll_metrics: read_scroll_metrics_from_terminal_output_element(output_element),
    bottom_threshold_pixels: TERMINAL_AUTO_SCROLL_BOTTOM_THRESHOLD_PIXELS,
  });
}

function scroll_terminal_output_to_bottom_if_needed(
  output_element: HTMLElement,
  should_scroll_to_bottom_after_append: boolean,
): void {
  if (should_scroll_to_bottom_after_append) {
    output_element.scrollTop = output_element.scrollHeight;
  }
}

/**
 * DOM terminal: scrollback, prompt, smart scroll, Jump to latest.
 */
export function createTerminalView(rootElement: HTMLElement, session: TerminalSession): TerminalView {
  const container = document.createElement("div");
  container.className = "terminal";

  const toolbar = document.createElement("div");
  toolbar.className = "terminal-output-toolbar";

  const jump_to_latest_button = document.createElement("button");
  jump_to_latest_button.type = "button";
  jump_to_latest_button.className = "terminal-jump-latest-button";
  jump_to_latest_button.setAttribute("data-testid", "terminal-jump-to-latest-button");
  jump_to_latest_button.textContent = "Jump to latest";
  jump_to_latest_button.hidden = true;

  toolbar.appendChild(jump_to_latest_button);

  const output = document.createElement("div");
  output.className = "terminal-output";
  output.setAttribute("role", "log");
  output.setAttribute("aria-live", "polite");
  output.setAttribute("data-testid", "terminal-output");

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

  container.appendChild(toolbar);
  container.appendChild(output);
  container.appendChild(inputRow);
  rootElement.appendChild(container);

  function update_jump_to_latest_button_visibility(): void {
    const should_show = should_show_jump_to_latest_button_for_terminal_output({
      scroll_metrics: read_scroll_metrics_from_terminal_output_element(output),
      bottom_threshold_pixels: TERMINAL_AUTO_SCROLL_BOTTOM_THRESHOLD_PIXELS,
    });
    jump_to_latest_button.hidden = !should_show;
  }

  jump_to_latest_button.addEventListener("click", () => {
    output.scrollTop = output.scrollHeight;
    update_jump_to_latest_button_visibility();
  });

  output.addEventListener("scroll", () => {
    update_jump_to_latest_button_visibility();
  });

  let onSubmitLine: (line: string) => void = () => {
    // Optional hook for host (e.g. refresh canvas)
  };
  let onBeforeSubmitLine: (line: string) => void = () => {
    // Optional hook for host (e.g. suppress auto-drain during interactive evaluation)
  };
  const submittedInputHistory: string[] = [];
  let historyCursorIndex = 0;
  let draftInputBeforeHistoryNavigation = "";

  function append_line_element_to_output(text: string, className: string): void {
    const line = document.createElement("div");
    line.className = className;
    line.textContent = text;
    output.appendChild(line);
  }

  function append_output_line_with_smart_scroll(text: string, className: string): void {
    const should_stick_to_bottom_before_append = was_terminal_output_scrolled_to_bottom_or_near_bottom(output);
    append_line_element_to_output(text, className);
    scroll_terminal_output_to_bottom_if_needed(output, should_stick_to_bottom_before_append);
    update_jump_to_latest_button_visibility();
  }

  function append_diagnostic_json_block(report: TerminalHistoryEntry["diagnosticReport"]): void {
    if (report === undefined) {
      return;
    }
    const jsonLine = document.createElement("pre");
    jsonLine.className = "terminal-diagnostics-json";
    jsonLine.textContent = JSON.stringify(report, null, 2);
    output.appendChild(jsonLine);
  }

  function append_history_entry_with_smart_scroll(entry: TerminalHistoryEntry): void {
    const should_stick_to_bottom_before_append = was_terminal_output_scrolled_to_bottom_or_near_bottom(output);
    append_line_element_to_output(entry.input, "terminal-line-input");
    for (const out of entry.outputs) {
      append_line_element_to_output(out, "terminal-line-output");
    }
    append_diagnostic_json_block(entry.diagnosticReport);
    scroll_terminal_output_to_bottom_if_needed(output, should_stick_to_bottom_before_append);
    update_jump_to_latest_button_visibility();
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
    append_history_entry_with_smart_scroll(entry);
    onSubmitLine(line);
  });

  update_jump_to_latest_button_visibility();

  return {
    rootElement: container,
    setOnBeforeSubmitLine(handler: (line: string) => void): void {
      onBeforeSubmitLine = handler;
    },
    setOnSubmitLine(handler: (line: string) => void): void {
      onSubmitLine = handler;
    },
    appendOutputLine(line: string): void {
      append_output_line_with_smart_scroll(line, "terminal-line-output");
    },
    appendHistoryEntry(entry: TerminalHistoryEntry): void {
      append_history_entry_with_smart_scroll(entry);
    },
    focusInput(): void {
      input.focus();
    },
  };
}
