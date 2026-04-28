import type { StructuredDiagnostic } from "./diagnostic";

/**
 * Human-readable one-line summary for terminal output.
 */
export function formatDiagnosticForTerminal(diagnostic: StructuredDiagnostic): string {
  const location =
    diagnostic.location !== undefined
      ? `${diagnostic.location.file}:${diagnostic.location.start.line}:${diagnostic.location.start.column}: `
      : "";
  return `${location}${diagnostic.severity} [${diagnostic.id}] ${diagnostic.message}`;
}
