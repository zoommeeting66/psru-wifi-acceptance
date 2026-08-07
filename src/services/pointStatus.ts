import { MeasurementCheck } from "./criteria";

export type PointStatus =
  | "PENDING"
  | "DEFECT"
  | "AWAITING_RETEST"
  | "EVIDENCE_COMPLETE"
  | "UNDER_REVIEW";

/** หลักฐานขั้นต่ำ 6 ประเภทตามแบบตรวจ */
export const REQUIRED_EVIDENCE_KINDS = [
  "LOCATION",
  "LABEL",
  "CONFIG",
  "FUNCTIONAL",
  "PERFORMANCE",
  "DOCS",
] as const;

export function evidenceCompleteness(kinds: string[]): { have: number; need: number } {
  const present = new Set(kinds.filter((k) => (REQUIRED_EVIDENCE_KINDS as readonly string[]).includes(k)));
  return { have: present.size, need: REQUIRED_EVIDENCE_KINDS.length };
}

/**
 * สถานะของจุดเป็นค่าที่คำนวณจากผลตรวจล่าสุดและข้อบกพร่องที่ยังไม่ปิด
 * ไม่ใช่ค่าที่เก็บไว้ในฐานข้อมูล และไม่ใช่คำวินิจฉัยการตรวจรับ
 */
export function derivePointStatus(input: {
  latestInspection: { evidenceKinds: string[]; checks: MeasurementCheck[] } | null;
  defects: { status: string }[];
}): PointStatus {
  const { latestInspection, defects } = input;
  if (!latestInspection) return "PENDING";
  if (defects.some((d) => d.status === "OPEN")) return "DEFECT";
  if (defects.some((d) => d.status === "FIXED")) return "AWAITING_RETEST";

  const { have, need } = evidenceCompleteness(latestInspection.evidenceKinds);
  const anyBelow = latestInspection.checks.some((c) => c.belowThreshold);
  if (have === need && !anyBelow) return "EVIDENCE_COMPLETE";
  return "UNDER_REVIEW";
}
