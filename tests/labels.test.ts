import { describe, it, expect } from "vitest";
import { POINT_STATUS_TH, POINT_STATUS_CLASS, EVIDENCE_TH, EVIDENCE_ORDER, GATE_ORDER, GATE_TH } from "../public/js/core/labels.js";
import { REQUIRED_EVIDENCE_KINDS } from "../src/services/pointStatus";

const STATUSES = ["PENDING", "DEFECT", "AWAITING_RETEST", "EVIDENCE_COMPLETE", "UNDER_REVIEW"];

describe("frontend labels stay in sync with the backend", () => {
  it("has a Thai label and a chip class for every point status", () => {
    for (const s of STATUSES) {
      expect(POINT_STATUS_TH[s], `missing label for ${s}`).toBeTruthy();
      expect(POINT_STATUS_CLASS[s], `missing class for ${s}`).toBeTruthy();
    }
  });

  it("covers exactly the evidence kinds the backend requires", () => {
    expect([...EVIDENCE_ORDER].sort()).toEqual([...REQUIRED_EVIDENCE_KINDS].sort());
    for (const kind of EVIDENCE_ORDER) expect(EVIDENCE_TH[kind]).toBeTruthy();
  });

  it("labels all four gates", () => {
    expect(GATE_ORDER).toEqual(["docs", "site", "test", "summary"]);
    for (const g of GATE_ORDER) expect(GATE_TH[g]).toBeTruthy();
  });
});
