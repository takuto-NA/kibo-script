import type { DiagnosticReport } from "../diagnostics/diagnostic";

export type EmbedMessageSource = "kibo-simulator-parent";

export type EmbedSimulatorCommandMessage = {
  source: EmbedMessageSource;
  type: "simulator.command";
  requestId: string;
  commandLine: string;
};

export type EmbedSimulatorTickMessage = {
  source: EmbedMessageSource;
  type: "simulator.tick";
  requestId: string;
  elapsedMilliseconds: number;
};

export type EmbedSimulatorGetSnapshotMessage = {
  source: EmbedMessageSource;
  type: "simulator.getSnapshot";
  requestId: string;
};

export type EmbedSimulatorGetDisplayFrameMessage = {
  source: EmbedMessageSource;
  type: "simulator.getDisplayFrame";
  requestId: string;
};

export type EmbedSimulatorSetAdcValueMessage = {
  source: EmbedMessageSource;
  type: "simulator.setAdcValue";
  requestId: string;
  raw: number;
};

export type EmbedIncomingMessage =
  | EmbedSimulatorCommandMessage
  | EmbedSimulatorTickMessage
  | EmbedSimulatorGetSnapshotMessage
  | EmbedSimulatorGetDisplayFrameMessage
  | EmbedSimulatorSetAdcValueMessage;

export type EmbedOkResponse = {
  source: EmbedMessageSource;
  type: "simulator.response";
  requestId: string;
  ok: true;
  outputs: string[];
  diagnosticReport?: DiagnosticReport;
};

export type EmbedErrorResponse = {
  source: EmbedMessageSource;
  type: "simulator.response";
  requestId: string;
  ok: false;
  report: DiagnosticReport;
};

export type EmbedOutgoingMessage = EmbedOkResponse | EmbedErrorResponse;

export function isEmbedIncomingMessage(data: unknown): data is EmbedIncomingMessage {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const record = data as Record<string, unknown>;
  return record.source === "kibo-simulator-parent";
}
