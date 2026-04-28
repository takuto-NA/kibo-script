import { describe, expect, it } from "vitest";
import { createDiagnosticReport } from "../../src/diagnostics/diagnostic";
import { buildUnitTypeMismatch } from "../../src/diagnostics/diagnostic-builder";
import { DIAGNOSTIC_SCHEMA_VERSION } from "../../src/diagnostics/diagnostic-constants";

describe("createDiagnosticReport", () => {
  it("wraps diagnostics with schema version", () => {
    const report = createDiagnosticReport([
      buildUnitTypeMismatch({
        message: "mismatch",
        expected: { kind: "unit", unit: "deg" },
        actual: { kind: "unit", unit: "ms" },
      }),
    ]);
    expect(report.schemaVersion).toBe(DIAGNOSTIC_SCHEMA_VERSION);
    expect(report.diagnostics[0].id).toBe("unit.type_mismatch");
  });
});
