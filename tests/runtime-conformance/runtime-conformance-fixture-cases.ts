// 責務: runtime conformance（runtime IR / replay / trace golden）で共有する fixture 定義テーブル。

import type { RuntimeConformanceReplayStep } from "../../src/runtime-conformance/build-runtime-conformance-replay-document";

export type RuntimeConformanceFixtureCaseDefinition = {
  readonly fixtureSourceFileName: string;
  readonly goldenBaseName: string;
  readonly replaySteps: readonly RuntimeConformanceReplayStep[];
  readonly scriptVarNamesToIncludeInTrace: readonly string[];
};

export const RUNTIME_CONFORMANCE_FIXTURE_CASE_DEFINITIONS: readonly RuntimeConformanceFixtureCaseDefinition[] = [
  {
    fixtureSourceFileName: "blink-led.sc",
    goldenBaseName: "blink-led",
    replaySteps: [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 1000 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 1000 },
      { kind: "collect_trace" },
    ],
    scriptVarNamesToIncludeInTrace: [],
  },
  {
    fixtureSourceFileName: "button-toggle-on-event.sc",
    goldenBaseName: "button-toggle-on-event",
    replaySteps: [
      { kind: "collect_trace" },
      {
        kind: "dispatch_device_event",
        deviceKind: "button",
        deviceId: 0,
        eventName: "pressed",
      },
      { kind: "collect_trace" },
      {
        kind: "dispatch_device_event",
        deviceKind: "button",
        deviceId: 0,
        eventName: "pressed",
      },
      { kind: "collect_trace" },
    ],
    scriptVarNamesToIncludeInTrace: [],
  },
  {
    fixtureSourceFileName: "circle-animation.sc",
    goldenBaseName: "circle-animation",
    replaySteps: [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
    ],
    scriptVarNamesToIncludeInTrace: ["circle_x"],
  },
  {
    fixtureSourceFileName: "semantics-if-led-branch.sc",
    goldenBaseName: "semantics-if-led-branch",
    replaySteps: [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
    ],
    scriptVarNamesToIncludeInTrace: ["branch_toggle"],
  },
  {
    fixtureSourceFileName: "semantics-wait-skew.sc",
    goldenBaseName: "semantics-wait-skew",
    replaySteps: [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 200 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 200 },
      { kind: "collect_trace" },
    ],
    scriptVarNamesToIncludeInTrace: ["waited_count"],
  },
  {
    fixtureSourceFileName: "semantics-loop-budget.sc",
    goldenBaseName: "semantics-loop-budget",
    replaySteps: [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 1000 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 1000 },
      { kind: "collect_trace" },
    ],
    scriptVarNamesToIncludeInTrace: [],
  },
  {
    fixtureSourceFileName: "semantics-match-string.sc",
    goldenBaseName: "semantics-match-string",
    replaySteps: [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 200 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 200 },
      { kind: "collect_trace" },
    ],
    scriptVarNamesToIncludeInTrace: ["mode"],
  },
  {
    fixtureSourceFileName: "semantics-state-membership-every.sc",
    goldenBaseName: "semantics-state-membership-every",
    replaySteps: [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
    ],
    scriptVarNamesToIncludeInTrace: ["ticks_in_on"],
  },
  {
    fixtureSourceFileName: "semantics-state-membership-on-event.sc",
    goldenBaseName: "semantics-state-membership-on-event",
    replaySteps: [
      { kind: "collect_trace" },
      {
        kind: "dispatch_device_event",
        deviceKind: "button",
        deviceId: 0,
        eventName: "pressed",
      },
      { kind: "collect_trace" },
      {
        kind: "dispatch_device_event",
        deviceKind: "button",
        deviceId: 0,
        eventName: "pressed",
      },
      { kind: "collect_trace" },
    ],
    scriptVarNamesToIncludeInTrace: [],
  },
  {
    fixtureSourceFileName: "device-display-text.sc",
    goldenBaseName: "device-display-text",
    replaySteps: [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
    ],
    scriptVarNamesToIncludeInTrace: [],
  },
  {
    fixtureSourceFileName: "device-api-pwm-led.sc",
    goldenBaseName: "device-api-pwm-led",
    replaySteps: [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
    ],
    scriptVarNamesToIncludeInTrace: [],
  },
  {
    fixtureSourceFileName: "device-api-serial-led.sc",
    goldenBaseName: "device-api-serial-led",
    replaySteps: [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
    ],
    scriptVarNamesToIncludeInTrace: [],
  },
  {
    fixtureSourceFileName: "device-api-motor-servo-led.sc",
    goldenBaseName: "device-api-motor-servo-led",
    replaySteps: [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
    ],
    scriptVarNamesToIncludeInTrace: [],
  },
  {
    fixtureSourceFileName: "device-api-adc-led.sc",
    goldenBaseName: "device-api-adc-led",
    replaySteps: [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
    ],
    scriptVarNamesToIncludeInTrace: [],
  },
];
