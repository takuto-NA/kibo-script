import type { AstRange } from "../ast/script-ast";
import type { DeviceAddress } from "../core/device-address";

export type BoundProgram = {
  sourceFileName: string;
  refSymbols: Map<string, BoundRefSymbol>;
  /** Compiler-visible script state names -> initialized binding */
  stateSymbols: Map<string, BoundStateSymbol>;
  /** `state` 宣言がソースに現れた順（初期化評価順）。 */
  stateSymbolsInSourceOrder: BoundStateSymbol[];
  tasks: BoundTask[];
  onEventTasks: BoundOnEventTask[];
};

export type BoundRefSymbol = {
  symbolName: string;
  deviceAddress: DeviceAddress;
  range: AstRange;
};

export type BoundStateSymbol = {
  stateName: string;
  initialValue: BoundExpression;
  range: AstRange;
};

export type BoundTask = {
  taskName: string;
  intervalValue: number;
  intervalUnit: "ms" | "deg";
  intervalRange: AstRange;
  statements: BoundStatement[];
  range: AstRange;
};

export type BoundOnEventTask = {
  taskName: string;
  deviceAddress: DeviceAddress;
  eventName: string;
  statements: BoundStatement[];
  range: AstRange;
};

export type BoundStatement = BoundDoStatement | BoundSetStatement | BoundWaitStatement;

export type BoundDoStatement = {
  kind: "do_statement";
  deviceAddress: DeviceAddress;
  methodName: string;
  arguments: BoundExpression[];
  range: AstRange;
};

export type BoundSetStatement = {
  kind: "set_statement";
  stateName: string;
  valueExpression: BoundExpression;
  range: AstRange;
};

export type BoundWaitStatement = {
  kind: "wait_statement";
  waitMilliseconds: number;
  waitRange: AstRange;
  range: AstRange;
};

export type BoundExpression =
  | { kind: "integer"; value: number }
  | { kind: "string"; value: string }
  | { kind: "identifier"; name: string }
  | { kind: "binary_add"; left: BoundExpression; right: BoundExpression }
  | {
      kind: "read_property";
      deviceAddress: DeviceAddress;
      propertyName: string;
      range: AstRange;
    };
