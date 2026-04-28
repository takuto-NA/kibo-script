import type {
  DiagnosticPhase,
  RelatedLocation,
  SourceRange,
  StructuredDiagnostic,
  StructuredValue,
} from "./diagnostic";

export function buildParseUnexpectedToken(params: {
  file: string;
  range: SourceRange;
  rangeText: string;
  message?: string;
}): StructuredDiagnostic {
  return {
    id: "parse.unexpected_token",
    severity: "error",
    phase: "parse",
    message: params.message ?? "Unexpected token.",
    location: params.range,
    rangeText: params.rangeText,
    explanation: "The parser did not expect this token at this position.",
  };
}

export function buildParseUnsupportedCommand(params: {
  file: string;
  range?: SourceRange;
  inputLine: string;
}): StructuredDiagnostic {
  return {
    id: "parse.unsupported_command",
    severity: "error",
    phase: "parse",
    message: "This command syntax is not supported in the current simulator.",
    location: params.range,
    rangeText: params.inputLine,
    explanation:
      "The interactive shell supports a fixed subset of commands. Extend the parser or use supported syntax.",
  };
}

export function buildDeviceUnknownTarget(params: {
  kindName: string;
  id: number;
  range?: SourceRange;
}): StructuredDiagnostic {
  return {
    id: "device.unknown_target",
    severity: "error",
    phase: "bind",
    message: `Unknown device ${params.kindName}#${params.id}.`,
    location: params.range,
    expected: { kind: "device", kindName: params.kindName, id: params.id },
  };
}

export function buildUnitTypeMismatch(params: {
  message: string;
  range?: SourceRange;
  rangeText?: string;
  expected?: StructuredValue;
  actual?: StructuredValue;
  related?: RelatedLocation[];
}): StructuredDiagnostic {
  return {
    id: "unit.type_mismatch",
    severity: "error",
    phase: "type_check",
    message: params.message,
    location: params.range,
    rangeText: params.rangeText,
    expected: params.expected,
    actual: params.actual,
    related: params.related,
  };
}

export function buildOwnershipMultipleWriters(params: {
  message: string;
  range?: SourceRange;
}): StructuredDiagnostic {
  return {
    id: "ownership.multiple_writers",
    severity: "error",
    phase: "semantic_check",
    message: params.message,
    location: params.range,
  };
}

export function buildRuntimeOutOfRange(params: {
  message: string;
  phase?: DiagnosticPhase;
}): StructuredDiagnostic {
  return {
    id: "runtime.out_of_range",
    severity: "error",
    phase: params.phase ?? "runtime",
    message: params.message,
  };
}

export function buildTaskUnknown(name: string): StructuredDiagnostic {
  return {
    id: "task.unknown",
    severity: "error",
    phase: "semantic_check",
    message: `Unknown task "${name}".`,
  };
}
