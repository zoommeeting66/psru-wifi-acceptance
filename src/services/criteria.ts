export type CriteriaOperator = "gte" | "lte";

export interface CriteriaDef {
  key: string;
  label: string;
  operator: CriteriaOperator;
  threshold: number;
  unit: string;
  torClause: string;
}

export interface MeasurementCheck {
  key: string;
  label: string;
  unit: string;
  torClause: string;
  operator: CriteriaOperator;
  threshold: number;
  /** null = ยังไม่ได้วัด */
  value: number | null;
  /** true = ค่าที่วัดได้ไม่เป็นไปตามเกณฑ์ที่อ้างอิงจาก TOR */
  belowThreshold: boolean;
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * เทียบค่าที่วัดได้กับเกณฑ์ที่อ้างอิงจาก TOR
 * หมายเหตุ: ฟังก์ชันนี้ไม่ตัดสินการตรวจรับ เพียงชี้ว่าค่าใดไม่เป็นไปตามเกณฑ์
 */
export function evaluateMeasurements(
  defs: CriteriaDef[],
  measurements: Record<string, unknown>
): MeasurementCheck[] {
  return defs.map((def) => {
    const value = toNumber(measurements?.[def.key]);
    const belowThreshold =
      value === null ? false : def.operator === "gte" ? value < def.threshold : value > def.threshold;
    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      torClause: def.torClause,
      operator: def.operator,
      threshold: def.threshold,
      value,
      belowThreshold,
    };
  });
}
