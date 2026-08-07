import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testPrisma, resetDb } from "./helpers/db";
import { makeProjectWithPoints } from "./helpers/factory";
import { parseLegacyCsv, importLegacyRows } from "../src/scripts/importCsv";

const CSV = [
  '"AP_ID","อาคาร","ชั้น","พื้นที่","Serial","MAC","ผู้ตรวจ","วันที่ตรวจ","Test_ID","หลักฐานครบ_รายการ","สถานะ","ข้อบกพร่อง","หมายเหตุ","แก้ไขล่าสุด"',
  '"AP-0001","อาคาร 1","ชั้น 1","พื้นที่ 01","SN-1","AA:BB","ช่าง ก","2026-08-01","SAT-01","3","รอตรวจสอบ","","",""',
  '"AP-9001","อาคาร 9","ชั้น 2","พื้นที่ 05","SN-9","CC:DD","ช่าง ข","2026-08-02","SAT-02","0","ยังไม่ตรวจ","","",""',
].join("\n");

describe("legacy csv import", () => {
  beforeEach(resetDb);
  afterAll(() => testPrisma.$disconnect());

  it("parses quoted Thai fields", () => {
    const rows = parseLegacyCsv(CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0].apId).toBe("AP-0001");
    expect(rows[0].building).toBe("อาคาร 1");
    expect(rows[0].serial).toBe("SN-1");
  });

  it("handles a UTF-8 BOM and CRLF line endings", () => {
    const rows = parseLegacyCsv(String.fromCharCode(0xfeff) + CSV.replaceAll("\n", "\r\n"));
    expect(rows).toHaveLength(2);
    expect(rows[0].apId).toBe("AP-0001");
  });

  it("handles escaped double quotes inside a field", () => {
    const csv = [
      '"AP_ID","อาคาร","ชั้น","พื้นที่","Serial","MAC","ผู้ตรวจ","วันที่ตรวจ","Test_ID","หลักฐานครบ_รายการ","สถานะ","ข้อบกพร่อง","หมายเหตุ","แก้ไขล่าสุด"',
      '"AP-0001","อาคาร 1","ชั้น 1","พื้นที่ 01","SN-1","AA:BB","ช่าง ก","","","0","ยังไม่ตรวจ","พบปัญหา ""สายหลุด""","",""',
    ].join("\n");
    const rows = parseLegacyCsv(csv);
    expect(rows[0].defect).toBe('พบปัญหา "สายหลุด"');
  });

  it("keeps a row intact when a free-text field contains a line break", async () => {
    const csv = [
      '"AP_ID","อาคาร","ชั้น","พื้นที่","Serial","MAC","ผู้ตรวจ","วันที่ตรวจ","Test_ID","หลักฐานครบ_รายการ","สถานะ","ข้อบกพร่อง","หมายเหตุ","แก้ไขล่าสุด"',
      '"AP-0001","อาคาร 1","ชั้น 1","พื้นที่ 01","SN-1","AA:BB","ช่าง ก","","","0","ยังไม่ตรวจ","บรรทัดแรก\nบรรทัดสอง","หมายเหตุ",""',
      '"AP-0002","อาคาร 1","ชั้น 2","พื้นที่ 02","SN-2","CC:DD","ช่าง ข","","","0","ยังไม่ตรวจ","","",""',
    ].join("\n");

    const rows = parseLegacyCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].defect).toBe("บรรทัดแรก\nบรรทัดสอง");
    expect(rows[0].note).toBe("หมายเหตุ");
    expect(rows[1].apId).toBe("AP-0002");
    expect(rows[1].serial).toBe("SN-2");
  });

  it("matches a building whose legacy name carries stray whitespace", async () => {
    const { project } = await makeProjectWithPoints(1);
    const csv = [
      '"AP_ID","อาคาร","ชั้น","พื้นที่","Serial","MAC","ผู้ตรวจ","วันที่ตรวจ","Test_ID","หลักฐานครบ_รายการ","สถานะ","ข้อบกพร่อง","หมายเหตุ","แก้ไขล่าสุด"',
      '"AP-0002","  building one  ","ชั้น 1","พื้นที่ 02","SN-2","CC:DD","","","","0","","","",""',
    ].join("\n");

    const result = await importLegacyRows(parseLegacyCsv(csv), project.id);
    expect(result.skipped).toEqual([]);
    expect(result.pointsCreated).toBe(1);
  });

  it("updates existing points and reports unknown codes as skipped", async () => {
    const { project } = await makeProjectWithPoints(1);
    const result = await importLegacyRows(parseLegacyCsv(CSV), project.id);
    expect(result.pointsUpdated).toBe(1);
    expect(result.skipped).toEqual(["AP-9001"]);
    const point = await testPrisma.point.findUniqueOrThrow({ where: { code: "AP-0001" } });
    expect(point.serial).toBe("SN-1");
    expect(point.mac).toBe("AA:BB");
  });
});
