import type { DiagnosticReport } from "../diagnostics/diagnostic";
import {
  evaluateInteractiveCommand,
  formatEvaluateFailureForTerminal,
  type EvaluateInteractiveResult,
} from "./evaluate-interactive-command";
import type { SimulationRuntime } from "../core/simulation-runtime";
import {
  parseInteractiveCommandLine,
  type ParseInteractiveCommandResult,
} from "./parse-interactive-command";

export type TerminalHistoryEntry = {
  input: string;
  outputs: string[];
  diagnosticReport?: DiagnosticReport;
};

/**
 * Interactive shell session: parse → evaluate → collect structured diagnostics JSON.
 */
export class TerminalSession {
  private readonly runtime: SimulationRuntime;
  private readonly history: TerminalHistoryEntry[] = [];

  public constructor(runtime: SimulationRuntime) {
    this.runtime = runtime;
  }

  public getHistory(): readonly TerminalHistoryEntry[] {
    return this.history;
  }

  public submitLine(line: string): TerminalHistoryEntry {
    const trimmed = line.trim();
    if (trimmed === "") {
      const entry: TerminalHistoryEntry = { input: line, outputs: [] };
      this.history.push(entry);
      return entry;
    }

    const parsed: ParseInteractiveCommandResult =
      parseInteractiveCommandLine(trimmed);
    if (!parsed.ok) {
      const entry: TerminalHistoryEntry = {
        input: line,
        outputs: [],
        diagnosticReport: parsed.report,
      };
      this.history.push(entry);
      return entry;
    }

    const evaluated: EvaluateInteractiveResult = evaluateInteractiveCommand(
      this.runtime,
      parsed.command,
    );

    if (!evaluated.ok) {
      const entry: TerminalHistoryEntry = {
        input: line,
        outputs: formatEvaluateFailureForTerminal(evaluated.report),
        diagnosticReport: evaluated.report,
      };
      this.history.push(entry);
      return entry;
    }

    const entry: TerminalHistoryEntry = {
      input: line,
      outputs: evaluated.lines,
      diagnosticReport: evaluated.diagnosticReport,
    };
    this.history.push(entry);
    return entry;
  }
}
