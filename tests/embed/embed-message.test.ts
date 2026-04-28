import { describe, expect, it } from "vitest";
import { isEmbedIncomingMessage } from "../../src/embed/embed-message";

describe("embed messages", () => {
  it("recognizes parent source", () => {
    expect(
      isEmbedIncomingMessage({
        source: "kibo-simulator-parent",
        type: "simulator.command",
        requestId: "1",
        commandLine: "read adc#0",
      }),
    ).toBe(true);
    expect(isEmbedIncomingMessage({})).toBe(false);
  });
});
