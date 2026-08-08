import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const BUILDINGS = [
  { code: "B01", name: "อาคารทีปวิชญ์" },
  { code: "B02", name: "อาคารคณะวิทยาศาสตร์" },
  { code: "B03", name: "หอสมุดกลาง" },
  { code: "B04", name: "หอประชุมศรีวชิรโชติ" },
  { code: "B05", name: "อาคารกิจการนักศึกษา" },
  { code: "B06", name: "อาคารคณะครุศาสตร์" },
  { code: "B07", name: "อาคารคณะมนุษยศาสตร์และสังคมศาสตร์" },
  { code: "B08", name: "อาคารคณะเทคโนโลยีอุตสาหกรรม" },
  { code: "B09", name: "อาคารสำนักงานอธิการบดี" },
  { code: "B10", name: "หอพักทะเลแก้วนิเวศ" },
];

const CRITERIA = [
  { key: "rssi", label: "ความแรงสัญญาณ (RSSI)", operator: "gte", threshold: -67, unit: "dBm", torClause: "TOR ข้อ 4.2" },
  { key: "downloadMbps", label: "ความเร็วดาวน์โหลด", operator: "gte", threshold: 100, unit: "Mbps", torClause: "TOR ข้อ 4.3" },
  { key: "uploadMbps", label: "ความเร็วอัปโหลด", operator: "gte", threshold: 50, unit: "Mbps", torClause: "TOR ข้อ 4.3" },
  { key: "latencyMs", label: "ค่าหน่วงเวลา", operator: "lte", threshold: 30, unit: "ms", torClause: "TOR ข้อ 4.4" },
];

const USERS = [
  { username: "admin", name: "ผู้ดูแลระบบ", role: UserRole.ADMIN, team: null },
  { username: "committee", name: "กรรมการตรวจรับ", role: UserRole.COMMITTEE, team: null },
  { username: "field1", name: "ช่างเทคนิค ทีม A", role: UserRole.FIELD, team: "ทีม A" },
  { username: "field2", name: "ช่างเทคนิค ทีม B", role: UserRole.FIELD, team: "ทีม B" },
];

async function main() {
  const passwordHash = await bcrypt.hash("psru1234", 10);
  for (const u of USERS) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: { name: u.name, role: u.role, team: u.team },
      create: { ...u, passwordHash },
    });
  }

  // ห้ามสร้างโครงการซ้ำ: Criteria ไม่ได้ผูกกับโครงการตอนคำนวณผล
  // ถ้ามีสองชุด ทุกจุดจะถูกเทียบกับเกณฑ์ 8 ข้อที่มี key ซ้ำกัน
  // และหน้ามือถือจะขึ้นช่องกรอกซ้ำสองเท่า
  const existing = await prisma.project.findFirst({ select: { id: true, name: true } });
  if (existing) {
    console.log(
      `พบโครงการอยู่แล้ว (${existing.name}) — ข้ามการสร้างข้อมูลตั้งต้น\n` +
        `บัญชีผู้ใช้ถูกอัปเดตเรียบร้อยแล้ว\n` +
        `หากต้องการเริ่มใหม่ทั้งหมด ให้ลบและสร้างฐานข้อมูลใหม่ก่อน แล้วรัน prisma db push อีกครั้ง`
    );
    return;
  }

  // สร้างทั้งชุดในทรานแซกชันเดียว ล้มกลางทางต้องไม่เหลือโครงการค้างที่ไม่มีจุดติดตั้ง
  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name: "โครงการติดตั้งระบบเครือข่ายไร้สาย 1,000 จุด",
        contractNo: "สัญญาเลขที่ (ระบุภายหลัง)",
        torRef: "TOR โครงการ Wi-Fi 1,000 จุด",
        totalPoints: 1000,
        criteria: { create: CRITERIA },
        buildings: { create: BUILDINGS },
      },
      include: { buildings: true },
    });

    const buildings = project.buildings;
    const points = Array.from({ length: 1000 }, (_, i) => {
      const n = i + 1;
      const building = buildings[i % buildings.length];
      return {
        code: `AP-${String(n).padStart(4, "0")}`,
        buildingId: building.id,
        floor: `ชั้น ${(i % 6) + 1}`,
        room: `พื้นที่ ${String((i % 50) + 1).padStart(2, "0")}`,
        deviceModel: "AP รุ่นตามบัญชีส่งมอบ",
      };
    });
    await tx.point.createMany({ data: points });
    return buildings.length;
  });

  console.log(`Seeded ${USERS.length} users, ${created} buildings, ${CRITERIA.length} criteria, 1000 points.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
