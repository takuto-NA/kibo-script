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

export function buildParseUnsupportedSyntax(params: {
  file: string;
  range?: SourceRange;
  rangeText?: string;
  message: string;
}): StructuredDiagnostic {
  return {
    id: "parse.unsupported_syntax",
    severity: "error",
    phase: "parse",
    message: params.message,
    location: params.range,
    rangeText: params.rangeText,
    explanation: "This syntax is not implemented in the current compiler phase.",
  };
}

export function buildNameUnknownReference(params: {
  name: string;
  range?: SourceRange;
  rangeText?: string;
}): StructuredDiagnostic {
  return {
    id: "name.unknown_reference",
    severity: "error",
    phase: "bind",
    message: `Unknown reference "${params.name}".`,
    location: params.range,
    rangeText: params.rangeText,
  };
}

export function buildNameDuplicateDeclaration(params: {
  name: string;
  range?: SourceRange;
  secondaryRange?: SourceRange;
}): StructuredDiagnostic {
  return {
    id: "name.duplicate_declaration",
    severity: "error",
    phase: "bind",
    message: `Duplicate declaration of "${params.name}".`,
    location: params.range,
    related:
      params.secondaryRange !== undefined
        ? [
            {
              message: "First declared here.",
              location: params.secondaryRange,
            },
          ]
        : undefined,
  };
}

export function buildSemanticDuplicateTaskName(params: {
  name: string;
  range?: SourceRange;
  related?: RelatedLocation[];
}): StructuredDiagnostic {
  return {
    id: "semantic.duplicate_task_name",
    severity: "error",
    phase: "semantic_check",
    message: `Duplicate task name "${params.name}".`,
    location: params.range,
    related: params.related,
  };
}

export function buildSemanticInvalidTaskInterval(params: {
  range?: SourceRange;
  message: string;
}): StructuredDiagnostic {
  return {
    id: "semantic.invalid_task_interval",
    severity: "error",
    phase: "semantic_check",
    message: params.message,
    location: params.range,
  };
}

export function buildCompilerEmptyScript(params: {
  file: string;
}): StructuredDiagnostic {
  return {
    id: "compiler.empty_script",
    severity: "error",
    phase: "parse",
    message: "Script is empty or contains only whitespace.",
    explanation: "Provide at least one declaration or task.",
  };
}

export function buildTypeMethodNotFound(params: {
  methodName: string;
  deviceKindName: string;
  range?: SourceRange;
  rangeText?: string;
}): StructuredDiagnostic {
  return {
    id: "type.method_not_found",
    severity: "error",
    phase: "type_check",
    message: `Method "${params.methodName}" is not defined for device kind "${params.deviceKindName}".`,
    location: params.range,
    rangeText: params.rangeText,
  };
}

export function buildTypeMethodArityMismatch(params: {
  methodName: string;
  range?: SourceRange;
  expectedMinimumParameterCount: number;
  expectedMaximumParameterCount: number;
  actualParameterCount: number;
}): StructuredDiagnostic {
  return {
    id: "type.method_arity_mismatch",
    severity: "error",
    phase: "type_check",
    message: `Wrong number of arguments for "${params.methodName}" (expected ${params.expectedMinimumParameterCount}-${params.expectedMaximumParameterCount}, got ${params.actualParameterCount}).`,
    location: params.range,
  };
}

export function buildTypeArgumentTypeMismatch(params: {
  message: string;
  range?: SourceRange;
  rangeText?: string;
  expected?: StructuredValue;
  actual?: StructuredValue;
}): StructuredDiagnostic {
  return {
    id: "type.argument_type_mismatch",
    severity: "error",
    phase: "type_check",
    message: params.message,
    location: params.range,
    rangeText: params.rangeText,
    expected: params.expected,
    actual: params.actual,
  };
}

export function buildTaskUnknown(params: { taskName: string }): StructuredDiagnostic {
  return {
    id: "task.unknown",
    severity: "error",
    phase: "runtime",
    message: `Unknown task "${params.taskName}".`,
  };
}

export function buildMatchMissingElseBranch(params: {
  range?: SourceRange;
  message?: string;
}): StructuredDiagnostic {
  return {
    id: "match.missing_else_branch",
    severity: "error",
    phase: "parse",
    message:
      params.message ??
      "match statement requires an 'else => { ... }' branch as the last arm.",
    location: params.range,
    explanation: "The minimal match syntax requires a final else branch.",
  };
}

export function buildMatchTargetRequiresString(params: {
  range?: SourceRange;
}): StructuredDiagnostic {
  return {
    id: "match.target_requires_string",
    severity: "error",
    phase: "type_check",
    message: "match target expression must have string type.",
    location: params.range,
    explanation: "This minimal match supports discriminating string values only.",
  };
}

export function buildMatchBranchUnsupportedStatement(params: {
  message: string;
  range?: SourceRange;
}): StructuredDiagnostic {
  return {
    id: "match.branch_unsupported_statement",
    severity: "error",
    phase: "type_check",
    message: params.message,
    location: params.range,
    explanation: "match branch bodies may only use 'do' and 'set' in this language version.",
  };
}

export function buildPercentLiteralOutOfRange(params: {
  range?: SourceRange;
  rangeText?: string;
  actualPercent: number;
}): StructuredDiagnostic {
  return {
    id: "type.percent_literal_out_of_range",
    severity: "error",
    phase: "type_check",
    message: `Percent literal must be between ${MIN_PERCENT_LITERAL_BOUND}% and ${MAX_PERCENT_LITERAL_BOUND}% (got ${params.actualPercent}).`,
    location: params.range,
    rangeText: params.rangeText,
    explanation: "PWM fade literals map percent signs onto integers for now.",
  };
}

export function buildAnimatorEaseUnsupported(params: {
  easeName: string;
  range?: SourceRange;
}): StructuredDiagnostic {
  return {
    id: "type.animator_unsupported_ease",
    severity: "error",
    phase: "type_check",
    message: `Unsupported animator ease "${params.easeName}" (expected "linear" or "ease_in_out").`,
    location: params.range,
  };
}

export function buildAnimatorTimeExpressionInvalidContext(params: {
  range?: SourceRange;
}): StructuredDiagnostic {
  return {
    id: "type.animator_time_expression_invalid_context",
    severity: "error",
    phase: "type_check",
    message:
      'Expressions "dt" and "step ... with dt" are only valid inside a task declared with "every" (not in state initializers or "task on").',
    location: params.range,
    explanation: "Event tasks and state initializers have no stable nominal dt interval in this language version.",
  };
}

export function buildAnimatorStepRequiresTargetExpression(params: {
  range?: SourceRange;
}): StructuredDiagnostic {
  return {
    id: "type.animator_step_requires_target",
    severity: "error",
    phase: "type_check",
    message:
      '"ramp over ..." animator requires `step <name> with <target> dt` (target expression between `with` and `dt`).',
    location: params.range,
    explanation: "Target-driven ramps take their destination percent from the step expression.",
  };
}

export function buildAnimatorStepForbidsTargetExpression(params: {
  range?: SourceRange;
}): StructuredDiagnostic {
  return {
    id: "type.animator_step_forbids_target",
    severity: "error",
    phase: "type_check",
    message:
      '"ramp from ... to ..." animator must use `step <name> with dt` without a target expression between `with` and `dt`.',
    location: params.range,
    explanation: "Fixed-endpoint ramps use the animator declaration for from/to percent.",
  };
}

const MIN_PERCENT_LITERAL_BOUND = 0;
const MAX_PERCENT_LITERAL_BOUND = 100;

