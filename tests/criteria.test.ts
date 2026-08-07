import { describe, it, expect } from "vitest";
import { evaluateMeasurements, CriteriaDef } from "../src/services/criteria";

const defs: CriteriaDef[] = [
  { key: "rssi", label: "RSSI", operator: "gte", threshold: -67, unit: "dBm", torClause: "4.2" },
  { key: "latencyMs", label: "Latency", operator: "lte", threshold: 30, unit: "ms", torClause: "4.4" },
];

describe("evaluateMeasurements", () => {
  it("flags a value worse than a gte threshold", () => {
    const [rssi] = evaluateMeasurements(defs, { rssi: -76 });
    expect(rssi.value).toBe(-76);
    expect(rssi.belowThreshold).toBe(true);
  });

  it("accepts a value exactly at a gte threshold", () => {
    const [rssi] = evaluateMeasurements(defs, { rssi: -67 });
    expect(rssi.belowThreshold).toBe(false);
  });

  it("accepts a value exactly at an lte threshold", () => {
    const latency = evaluateMeasurements(defs, { latencyMs: 30 })[1];
    expect(latency.belowThreshold).toBe(false);
  });

  it("flags a value above an lte threshold", () => {
    const latency = evaluateMeasurements(defs, { latencyMs: 31 })[1];
    expect(latency.belowThreshold).toBe(true);
  });

  it("treats a missing measurement as not-yet-measured, not a failure", () => {
    const [rssi] = evaluateMeasurements(defs, {});
    expect(rssi.value).toBeNull();
    expect(rssi.belowThreshold).toBe(false);
  });

  it("treats a non-numeric measurement as not-yet-measured", () => {
    const [rssi] = evaluateMeasurements(defs, { rssi: "ไม่ได้วัด" });
    expect(rssi.value).toBeNull();
    expect(rssi.belowThreshold).toBe(false);
  });

  it("returns one check per criteria definition, in order", () => {
    const checks = evaluateMeasurements(defs, { rssi: -50, latencyMs: 10 });
    expect(checks.map((c) => c.key)).toEqual(["rssi", "latencyMs"]);
  });
});
