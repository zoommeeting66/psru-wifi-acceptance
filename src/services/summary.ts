import { prisma } from "../lib/prisma";
import { listPoints } from "./pointQuery";

export interface SummaryResult {
  total: number;
  inspected: number;
  pending: number;
  withDefects: number;
  evidenceComplete: number;
  awaitingRetest: number;
  byBuilding: { buildingId: string; buildingName: string; total: number; inspected: number; withDefects: number }[];
  defectsBySeverity: { URGENT: number; MAJOR: number; MINOR: number };
}

export async function buildSummary(): Promise<SummaryResult> {
  const { rows } = await listPoints({ page: 1, pageSize: 100000 });

  const byBuilding = new Map<string, { buildingId: string; buildingName: string; total: number; inspected: number; withDefects: number }>();
  for (const r of rows) {
    const entry =
      byBuilding.get(r.buildingId) ??
      { buildingId: r.buildingId, buildingName: r.buildingName, total: 0, inspected: 0, withDefects: 0 };
    entry.total += 1;
    if (r.status !== "PENDING") entry.inspected += 1;
    if (r.status === "DEFECT") entry.withDefects += 1;
    byBuilding.set(r.buildingId, entry);
  }

  const severities = await prisma.defect.groupBy({
    by: ["severity"],
    where: { status: { not: "CLOSED" } },
    _count: { _all: true },
  });
  const defectsBySeverity = { URGENT: 0, MAJOR: 0, MINOR: 0 };
  for (const s of severities) {
    defectsBySeverity[s.severity as keyof typeof defectsBySeverity] = s._count._all;
  }

  return {
    total: rows.length,
    inspected: rows.filter((r) => r.status !== "PENDING").length,
    pending: rows.filter((r) => r.status === "PENDING").length,
    withDefects: rows.filter((r) => r.status === "DEFECT").length,
    evidenceComplete: rows.filter((r) => r.status === "EVIDENCE_COMPLETE").length,
    awaitingRetest: rows.filter((r) => r.status === "AWAITING_RETEST").length,
    byBuilding: [...byBuilding.values()].sort((a, b) => a.buildingName.localeCompare(b.buildingName, "th")),
    defectsBySeverity,
  };
}
