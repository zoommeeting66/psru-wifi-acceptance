import fs from "fs";
import { prisma } from "../lib/prisma";

export interface LegacyRow {
  apId: string;
  building: string;
  floor: string;
  room: string;
  serial: string;
  mac: string;
  inspector: string;
  inspectionDate: string;
  testId: string;
  evidenceCount: string;
  status: string;
  defect: string;
  note: string;
  updated: string;
}

export interface ImportResult {
  pointsCreated: number;
  pointsUpdated: number;
  skipped: string[];
}

/**
 * แยกทั้งข้อความเป็นแถวและช่องในรอบเดียว โดยรู้จักเครื่องหมายคำพูด
 * ห้ามตัดบรรทัดก่อนแล้วค่อยแยกช่อง เพราะช่อง "หมายเหตุ" และ "ข้อบกพร่อง"
 * ของต้นแบบเดิมเป็น textarea ช่างจึงขึ้นบรรทัดใหม่ภายในช่องได้
 * ถ้าตัดที่ขึ้นบรรทัดใหม่ก่อน แถวนั้นจะแตกเป็นสองแถวและคอลัมน์เลื่อนทั้งแถวโดยไม่มีสัญญาณเตือน
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

export function parseLegacyCsv(text: string): LegacyRow[] {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = parseCsv(withoutBom);
  return rows.slice(1).map((c) => {
    return {
      apId: c[0] ?? "",
      building: c[1] ?? "",
      floor: c[2] ?? "",
      room: c[3] ?? "",
      serial: c[4] ?? "",
      mac: c[5] ?? "",
      inspector: c[6] ?? "",
      inspectionDate: c[7] ?? "",
      testId: c[8] ?? "",
      evidenceCount: c[9] ?? "",
      status: c[10] ?? "",
      defect: c[11] ?? "",
      note: c[12] ?? "",
      updated: c[13] ?? "",
    };
  });
}

/**
 * นำเข้าเฉพาะข้อมูลทะเบียนจุด (Serial/MAC) เท่านั้น
 * ไม่สร้าง Inspection ย้อนหลัง เพราะข้อมูลเดิมไม่มีหลักฐานแนบและระบุผู้ตรวจเป็นบัญชีจริงไม่ได้
 */
export async function importLegacyRows(rows: LegacyRow[], projectId: string): Promise<ImportResult> {
  const result: ImportResult = { pointsCreated: 0, pointsUpdated: 0, skipped: [] };
  const buildings = await prisma.building.findMany({ where: { projectId } });
  const byName = new Map(buildings.map((b) => [b.name, b]));

  for (const row of rows) {
    const existing = await prisma.point.findUnique({ where: { code: row.apId } });
    if (existing) {
      await prisma.point.update({
        where: { id: existing.id },
        data: {
          ...(row.serial ? { serial: row.serial } : {}),
          ...(row.mac ? { mac: row.mac } : {}),
        },
      });
      result.pointsUpdated += 1;
      continue;
    }
    // ข้อมูลเดิมมักมีช่องว่างหัวท้ายติดมา ถ้าเทียบตรง ๆ อาคารที่มีอยู่จริงจะถูกข้ามทิ้ง
    const building = byName.get(row.building.trim());
    if (!building) {
      result.skipped.push(row.apId);
      continue;
    }
    await prisma.point.create({
      data: {
        code: row.apId,
        buildingId: building.id,
        floor: row.floor,
        room: row.room,
        serial: row.serial || null,
        mac: row.mac || null,
      },
    });
    result.pointsCreated += 1;
  }
  return result;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run import:csv -- <path-to-csv>");
    process.exit(1);
  }
  const project = await prisma.project.findFirst();
  if (!project) {
    console.error("No project found. Run `npm run db:seed` first.");
    process.exit(1);
  }
  const result = await importLegacyRows(parseLegacyCsv(fs.readFileSync(file, "utf8")), project.id);
  console.log(
    `Imported: created=${result.pointsCreated} updated=${result.pointsUpdated} skipped=${result.skipped.length}`
  );
  if (result.skipped.length) console.log("Skipped codes:", result.skipped.join(", "));
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
