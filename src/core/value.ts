/**
 * Values observable in the simulator (subset of StaticCore Script).
 */

export type UnitKind =
  | "none"
  | "percent"
  | "deg"
  | "ms"
  | "s"
  | "dps"
  | "integer";

export type ScriptValue =
  | { tag: "integer"; value: number }
  | { tag: "boolean"; value: boolean }
  | { tag: "string"; value: string }
  | { tag: "percent"; value: number }
  | { tag: "deg"; value: number }
  | { tag: "time_ms"; value: number };

export function integerValue(value: number): ScriptValue {
  return { tag: "integer", value };
}

export function booleanValue(value: boolean): ScriptValue {
  return { tag: "boolean", value };
}

export function stringValue(value: string): ScriptValue {
  return { tag: "string", value };
}

export function formatScriptValueForInteractiveEcho(value: ScriptValue): string {
  switch (value.tag) {
    case "integer":
      return String(value.value);
    case "boolean":
      return String(value.value);
    case "string":
      return JSON.stringify(value.value);
    case "percent":
      return `${value.value}%`;
    case "deg":
      return `${value.value}deg`;
    case "time_ms":
      return `${value.value}ms`;
    default: {
      const unreachable: never = value;
      return String(unreachable);
    }
  }
}
