import { describe, it, expect } from "vitest";
import { derivePointStatus, evidenceCompleteness, REQUIRED_EVIDENCE_KINDS } from "../src/services/pointStatus";
import { MeasurementCheck } from "../src/services/criteria";

const ok: MeasurementCheck = {
  key: "rssi", label: "RSSI", unit: "dBm", torClause: "4.2",
  operator: "gte", threshold: -67, value: -50, belowThreshold: false,
};
const low: MeasurementCheck = { ...ok, value: -80, belowThreshold: true };
const allKinds = [...REQUIRED_EVIDENCE_KINDS];

describe("derivePointStatus", () => {
  it("is PENDING when the point has never been inspected", () => {
    expect(derivePointStatus({ latestInspection: null, defects: [] })).toBe("PENDING");
  });

  it("is DEFECT when any defect is open", () => {
    const status = derivePointStatus({
      latestInspection: { evidenceKinds: allKinds, checks: [ok] },
      defects: [{ status: "CLOSED" }, { status: "OPEN" }],
    });
    expect(status).toBe("DEFECT");
  });

  it("is AWAITING_RETEST when a defect is fixed but none are open", () => {
    const status = derivePointStatus({
      latestInspection: { evidenceKinds: allKinds, checks: [ok] },
      defects: [{ status: "FIXED" }],
    });
    expect(status).toBe("AWAITING_RETEST");
  });

  it("prefers DEFECT over AWAITING_RETEST when both exist", () => {
    const status = derivePointStatus({
      latestInspection: { evidenceKinds: allKinds, checks: [ok] },
      defects: [{ status: "FIXED" }, { status: "OPEN" }],
    });
    expect(status).toBe("DEFECT");
  });

  it("is EVIDENCE_COMPLETE with all evidence kinds and no value below threshold", () => {
    const status = derivePointStatus({
      latestInspection: { evidenceKinds: allKinds, checks: [ok] },
      defects: [{ status: "CLOSED" }],
    });
    expect(status).toBe("EVIDENCE_COMPLETE");
  });

  it("is UNDER_REVIEW when evidence is incomplete", () => {
    const status = derivePointStatus({
      latestInspection: { evidenceKinds: allKinds.slice(0, 3), checks: [ok] },
      defects: [],
    });
    expect(status).toBe("UNDER_REVIEW");
  });

  it("is UNDER_REVIEW when a measured value is below threshold, even with full evidence", () => {
    const status = derivePointStatus({
      latestInspection: { evidenceKinds: allKinds, checks: [low] },
      defects: [],
    });
    expect(status).toBe("UNDER_REVIEW");
  });

  it("ignores duplicate evidence kinds when counting completeness", () => {
    expect(evidenceCompleteness(["LOCATION", "LOCATION", "LABEL"])).toEqual({ have: 2, need: 6 });
  });
});
