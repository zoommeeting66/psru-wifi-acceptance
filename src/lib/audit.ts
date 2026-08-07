import { prisma } from "./prisma";
import { logger } from "../utils/logger";

/** บันทึกร่องรอยการใช้งาน — ห้ามทำให้คำขอหลักล้มเหลวถ้าเขียน audit ไม่ได้ */
export async function writeAudit(
  actorId: string | null,
  entity: string,
  entityId: string,
  action: string,
  payload?: unknown
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { actorId, entity, entityId, action, payload: (payload ?? null) as never },
    });
  } catch (e) {
    logger.error("audit write failed", e);
  }
}
