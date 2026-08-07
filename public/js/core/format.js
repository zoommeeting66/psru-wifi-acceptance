export function thNumber(n) {
  return Number(n ?? 0).toLocaleString("th-TH");
}

export function thDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

export function thDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("th-TH", { dateStyle: "medium" });
}

export function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

/**
 * วันที่ "วันนี้" ตามเวลาไทย ให้ตรงกับที่เซิร์ฟเวอร์ใช้
 * ห้ามใช้ toISOString() เพราะก่อน 07:00 น. UTC ยังไม่ข้ามวัน
 * หน้าจอจะไปขอแผนของเมื่อวานในช่วงเวลาที่ทีมภาคสนามเริ่มงานพอดี
 */
export function todayStr() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}
