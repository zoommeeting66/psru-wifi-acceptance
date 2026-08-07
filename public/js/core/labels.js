export const POINT_STATUS_TH = {
  PENDING: "รอตรวจ",
  DEFECT: "มีข้อบกพร่อง",
  AWAITING_RETEST: "รอตรวจซ้ำ",
  EVIDENCE_COMPLETE: "หลักฐานครบ",
  UNDER_REVIEW: "รอตรวจสอบ",
};

export const POINT_STATUS_CLASS = {
  PENDING: "idle",
  DEFECT: "fail",
  AWAITING_RETEST: "warn",
  EVIDENCE_COMPLETE: "pass",
  UNDER_REVIEW: "warn",
};

export const SEVERITY_TH = { URGENT: "เร่งด่วน", MAJOR: "สำคัญ", MINOR: "ทั่วไป" };
export const SEVERITY_CLASS = { URGENT: "fail", MAJOR: "warn", MINOR: "pass" };
export const DEFECT_STATUS_TH = { OPEN: "ยังไม่แก้ไข", FIXED: "แก้ไขแล้ว รอตรวจซ้ำ", CLOSED: "ปิดแล้ว" };

export const EVIDENCE_TH = {
  LOCATION: "ภาพตำแหน่งติดตั้ง",
  LABEL: "ภาพฉลาก / Serial",
  CONFIG: "หลักฐานการตั้งค่า",
  FUNCTIONAL: "ผลทดสอบการใช้งาน",
  PERFORMANCE: "ผลทดสอบประสิทธิภาพ",
  DOCS: "เอกสารส่งมอบ / รับประกัน",
};

export const EVIDENCE_ORDER = ["LOCATION", "LABEL", "CONFIG", "FUNCTIONAL", "PERFORMANCE", "DOCS"];

export const GATE_TH = { docs: "ตรวจเอกสาร", site: "ตรวจหน้างาน", test: "ทดสอบระบบ", summary: "สรุปผล" };
export const GATE_STATE_TH = { PENDING: "รอดำเนินการ", ACTIVE: "กำลังดำเนินการ", DONE: "ครบ" };
export const GATE_ORDER = ["docs", "site", "test", "summary"];

export const ROLE_TH = { FIELD: "ช่างภาคสนาม", COMMITTEE: "กรรมการตรวจรับ", ADMIN: "ผู้ดูแลระบบ" };

export const DISCLAIMER =
  "ระบบไม่ตัดสินผลการตรวจรับแทนคณะกรรมการ ค่าที่แสดงเป็นการเทียบผลที่วัดได้กับเกณฑ์ที่อ้างอิงจาก TOR/สัญญา การตรวจรับเป็นอำนาจของคณะกรรมการตรวจรับพัสดุ";
