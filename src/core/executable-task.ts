import type { DeviceAddress } from "./device-address";

/**
 * Runtime IR: statements executable by SimulationRuntime for compiled tasks.
 */
export type ExecutableArgument =
  | { kind: "integer"; value: number }
  | { kind: "string"; value: string };

export type ExecutableStatement = {
  kind: "do_method_call";
  deviceAddress: DeviceAddress;
  methodName: string;
  arguments: ExecutableArgument[];
};

export type CompiledEveryTask = {
  taskName: string;
  intervalMilliseconds: number;
  statements: ExecutableStatement[];
};

export type CompiledProgram = {
  everyTasks: CompiledEveryTask[];
};
