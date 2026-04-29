import type { DeviceAddress } from "./device-address";

/**
 * Runtime IR: statements executable by SimulationRuntime for compiled tasks.
 */
export type ExecutableExpression =
  | { kind: "integer_literal"; value: number }
  | { kind: "string_literal"; value: string }
  | { kind: "state_reference"; stateName: string }
  | { kind: "binary_add"; left: ExecutableExpression; right: ExecutableExpression }
  | {
      kind: "read_property";
      deviceAddress: DeviceAddress;
      propertyName: string;
    };

export type ExecutableStatement =
  | {
      kind: "do_method_call";
      deviceAddress: DeviceAddress;
      methodName: string;
      arguments: ExecutableExpression[];
    }
  | {
      kind: "assign_state";
      stateName: string;
      valueExpression: ExecutableExpression;
    }
  | {
      kind: "wait_milliseconds";
      waitMilliseconds: number;
    };

export type CompiledEveryTask = {
  taskName: string;
  intervalMilliseconds: number;
  statements: ExecutableStatement[];
};

export type CompiledOnEventTask = {
  taskName: string;
  deviceAddress: DeviceAddress;
  eventName: string;
  statements: ExecutableStatement[];
};

export type CompiledProgram = {
  stateInitializers: { stateName: string; expression: ExecutableExpression }[];
  everyTasks: CompiledEveryTask[];
  onEventTasks: CompiledOnEventTask[];
};
