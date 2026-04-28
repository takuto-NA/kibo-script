import type { AstRange } from "../ast/script-ast";
import type { DeviceAddress } from "../core/device-address";

export type BoundProgram = {
  sourceFileName: string;
  refSymbols: Map<string, BoundRefSymbol>;
  tasks: BoundTask[];
};

export type BoundRefSymbol = {
  symbolName: string;
  deviceAddress: DeviceAddress;
  range: AstRange;
};

export type BoundTask = {
  taskName: string;
  intervalValue: number;
  intervalUnit: "ms" | "deg";
  intervalRange: AstRange;
  statements: BoundDoStatement[];
  range: AstRange;
};

export type BoundCallArgument =
  | { kind: "integer"; value: number }
  | { kind: "string"; value: string };

export type BoundDoStatement = {
  deviceAddress: DeviceAddress;
  methodName: string;
  arguments: BoundCallArgument[];
  range: AstRange;
};
