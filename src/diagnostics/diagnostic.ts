import { DIAGNOSTIC_SCHEMA_VERSION } from "./diagnostic-constants";

export type DiagnosticSeverity = "error" | "warning" | "info";

export type DiagnosticPhase =
  | "parse"
  | "bind"
  | "type_check"
  | "semantic_check"
  | "runtime_prepare"
  | "runtime";

export type SourcePosition = {
  line: number;
  column: number;
  offset: number;
};

export type SourceRange = {
  file: string;
  start: SourcePosition;
  end: SourcePosition;
};

export type StructuredValue =
  | { kind: "unit"; unit: string }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "device"; kindName: string; id: number };

export type DiagnosticSuggestion = {
  title: string;
  replacement?: string;
};

export type RelatedLocation = {
  message: string;
  location: SourceRange;
};

export type StructuredDiagnostic = {
  id: string;
  severity: DiagnosticSeverity;
  phase: DiagnosticPhase;
  message: string;
  location?: SourceRange;
  rangeText?: string;
  expected?: StructuredValue;
  actual?: StructuredValue;
  explanation?: string;
  suggestions?: DiagnosticSuggestion[];
  related?: RelatedLocation[];
};

export type DiagnosticReport = {
  schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION;
  diagnostics: StructuredDiagnostic[];
};

export function createDiagnosticReport(
  diagnostics: StructuredDiagnostic[],
): DiagnosticReport {
  return {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    diagnostics,
  };
}
