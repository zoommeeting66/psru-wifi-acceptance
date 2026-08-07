import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/error";
import { writeAudit } from "../lib/audit";

export interface SubmitInspectionInput {
  clientUuid: string;
  pointCode: string;
  inspectedAt: string;
  measurements: Record<string, number | string | null>;
  note?: string;
  serial?: string;
  mac?: string;
  /** แผนที่ช่างกำลังเดินตามอยู่ ใช้จำกัดขอบเขตการติ๊กจุดว่าตรวจแล้ว */
  planId?: string;
  defect?: {
    severity: "URGENT" | "MAJOR" | "MINOR";
    title: string;
    detail: string;
    owner?: string;
    dueDate?: string;
  };
}

export interface SubmitInspectionResult {
  inspectionId: string;
  created: boolean;
  warnings: string[];
}

/** ชนกันที่ unique constraint ของ clientUuid หรือไม่ */
function isDuplicateClientUuid(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e?.code !== "P2002") return false;
  const target = e.meta?.target;
  return Array.isArray(target)
    ? target.includes("clientUuid")
    : String(target ?? "").includes("clientUuid");
}

/** เที่ยงคืน UTC ของวันที่ตรวจ ให้ตรงกับคอลัมน์ Plan.date ที่เป็น @db.Date */
function planDateOf(inspectedAt: string): Date {
  return new Date(`${new Date(inspectedAt).toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/**
 * บันทึกผลตรวจแบบเพิ่มอย่างเดียวและทำซ้ำได้ (idempotent)
 * ถ้า clientUuid นี้เคยบันทึกแล้ว จะคืนผลเดิมโดยไม่แก้ข้อมูล
 */
export async function submitInspection(
  input: SubmitInspectionInput,
  actor: { uid: string }
): Promise<SubmitInspectionResult> {
  const existing = await prisma.inspection.findUnique({ where: { clientUuid: input.clientUuid } });
  if (existing) {
    return { inspectionId: existing.id, created: false, warnings: [] };
  }

  const point = await prisma.point.findUnique({ where: { code: input.pointCode } });
  if (!point) throw new AppError(404, `ไม่พบจุดติดตั้งรหัส ${input.pointCode}`);

  const warnings: string[] = [];
  if (input.serial) {
    const clash = await prisma.point.findFirst({
      where: { serial: input.serial, id: { not: point.id } },
      select: { code: true },
    });
    if (clash) warnings.push(`หมายเลข Serial นี้ถูกบันทึกไว้ที่จุด ${clash.code} แล้ว กรุณาตรวจสอบ`);
  }

  const runWrite = () => prisma.$transaction(async (tx) => {
    const inspection = await tx.inspection.create({
      data: {
        clientUuid: input.clientUuid,
        pointId: point.id,
        inspectorId: actor.uid,
        inspectedAt: new Date(input.inspectedAt),
        measurements: input.measurements as never,
        note: input.note ?? null,
        serial: input.serial ?? null,
        mac: input.mac ?? null,
      },
    });

    if (input.serial || input.mac) {
      await tx.point.update({
        where: { id: point.id },
        data: {
          ...(input.serial ? { serial: input.serial } : {}),
          ...(input.mac ? { mac: input.mac } : {}),
        },
      });
    }

    if (input.defect) {
      await tx.defect.create({
        data: {
          pointId: point.id,
          inspectionId: inspection.id,
          severity: input.defect.severity,
          title: input.defect.title,
          detail: input.defect.detail,
          owner: input.defect.owner ?? null,
          dueDate: input.defect.dueDate ? new Date(input.defect.dueDate) : null,
        },
      });
    }

    // จำกัดขอบเขตไว้ที่แผนที่ช่างกำลังเดินตาม ไม่งั้นจะไปติ๊กแผนตรวจซ้ำของวันอื่นให้เสร็จตามไปด้วย
    await tx.planItem.updateMany({
      where: {
        pointId: point.id,
        doneAt: null,
        ...(input.planId ? { planId: input.planId } : { plan: { date: planDateOf(input.inspectedAt) } }),
      },
      data: { doneAt: new Date() },
    });

    return inspection.id;
  });

  let inspectionId: string;
  try {
    inspectionId = await runWrite();
  } catch (err) {
    // สองคำขอที่มี clientUuid เดียวกันวิ่งชนกัน — ผู้แพ้อ่านแถวที่อีกฝั่ง commit ไปแล้ว
    // ห้ามปล่อยเป็น 500 เพราะมือถือจะเข้าใจว่าส่งไม่สำเร็จทั้งที่ข้อมูลถึงเซิร์ฟเวอร์แล้ว
    if (isDuplicateClientUuid(err)) {
      const raced = await prisma.inspection.findUnique({ where: { clientUuid: input.clientUuid } });
      if (raced) return { inspectionId: raced.id, created: false, warnings };
    }
    throw err;
  }

  await writeAudit(actor.uid, "Inspection", inspectionId, "create", { pointCode: point.code });
  return { inspectionId, created: true, warnings };
}
