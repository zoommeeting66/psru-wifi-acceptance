import { PointListRow } from "./pointQuery";

const HEADERS = [
  "รหัสจุด", "อาคาร", "ชั้น", "พื้นที่", "รุ่นอุปกรณ์", "Serial", "MAC",
  "สถานะ", "หลักฐาน", "ข้อบกพร่องคงค้าง", "ตรวจล่าสุด", "ผู้ตรวจ",
];

const STATUS_TH: Record<string, string> = {
  PENDING: "รอตรวจ",
  DEFECT: "มีข้อบกพร่อง",
  AWAITING_RETEST: "รอตรวจซ้ำ",
  EVIDENCE_COMPLETE: "หลักฐานครบ",
  UNDER_REVIEW: "รอตรวจสอบ",
};

/** ค่าที่ขึ้นต้นด้วยอักขระเหล่านี้ Excel จะตีความเป็นสูตร */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function cell(v: unknown): string {
  const raw = String(v ?? "");
  // Serial, รุ่นอุปกรณ์ และชื่อผู้ตรวจ กรอกจากหน้างาน จึงต้องกันไม่ให้กลายเป็นสูตร
  // เมื่อกรรมการเปิดไฟล์บนเครื่องของหน่วยงาน
  const safe = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** ขึ้นต้นด้วย BOM เพื่อให้ Excel บน Windows อ่านภาษาไทยถูกต้อง */
export function pointsToCsv(rows: PointListRow[]): string {
  const lines = [
    HEADERS.map(cell).join(","),
    ...rows.map((r) =>
      [
        r.code, r.buildingName, r.floor, r.room, r.deviceModel, r.serial, r.mac,
        STATUS_TH[r.status] ?? r.status,
        `${r.evidenceHave}/${r.evidenceNeed}`,
        r.openDefects,
        r.lastInspectedAt ? new Date(r.lastInspectedAt).toLocaleString("th-TH") : "",
        r.lastInspector,
      ].map(cell).join(",")
    ),
  ];
  return "﻿" + lines.join("\r\n");
}
