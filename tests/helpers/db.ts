// DATABASE_URL is pointed at the test database by tests/setup.ts, which vitest
// runs before any test file's imports are evaluated. Do not reassign it here.
import { PrismaClient } from "@prisma/client";

export const testPrisma = new PrismaClient();

/** ล้างข้อมูลทุกตารางตามลำดับ FK เพื่อให้แต่ละ suite เริ่มจากฐานว่าง */
export async function resetDb(): Promise<void> {
  await testPrisma.$executeRawUnsafe(
    `TRUNCATE "AuditLog","PlanItem","Plan","Defect","Evidence","Inspection","Point","Criteria","Building","Project","User" RESTART IDENTITY CASCADE`
  );
}
