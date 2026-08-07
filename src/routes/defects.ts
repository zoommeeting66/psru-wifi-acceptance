import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ah } from "../utils/asyncHandler";
import { currentUser, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { writeAudit } from "../lib/audit";

const router = Router();

const listQuery = z.object({
  status: z.enum(["OPEN", "FIXED", "CLOSED"]).optional(),
  severity: z.enum(["URGENT", "MAJOR", "MINOR"]).optional(),
});

router.get(
  "/defects",
  requirePermission("point:read"),
  ah(async (req, res) => {
    const q = listQuery.parse(req.query);
    const defects = await prisma.defect.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.severity ? { severity: q.severity } : {}) },
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      include: { point: { include: { building: true } } },
    });
    res.json({
      defects: defects.map((d) => ({
        id: d.id,
        pointId: d.pointId,
        pointCode: d.point.code,
        buildingName: d.point.building.name,
        floor: d.point.floor,
        room: d.point.room,
        severity: d.severity,
        title: d.title,
        detail: d.detail,
        owner: d.owner,
        dueDate: d.dueDate ? d.dueDate.toISOString() : null,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
        closedAt: d.closedAt ? d.closedAt.toISOString() : null,
      })),
    });
  })
);

const createSchema = z.object({
  pointId: z.string().min(1),
  inspectionId: z.string().min(1),
  severity: z.enum(["URGENT", "MAJOR", "MINOR"]),
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(2000),
  owner: z.string().max(200).optional(),
  dueDate: z.string().datetime().optional(),
});

router.post(
  "/defects",
  requirePermission("defect:open"),
  ah(async (req, res) => {
    const input = createSchema.parse(req.body);
    const defect = await prisma.defect.create({
      data: {
        pointId: input.pointId,
        inspectionId: input.inspectionId,
        severity: input.severity,
        title: input.title,
        detail: input.detail,
        owner: input.owner ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
      },
    });
    await writeAudit(currentUser(req).uid, "Defect", defect.id, "open");
    res.status(201).json({ id: defect.id });
  })
);

router.post(
  "/defects/:id/fix",
  requirePermission("defect:open"),
  ah(async (req, res) => {
    const note = z.object({ note: z.string().max(2000).optional() }).parse(req.body);
    const defect = await prisma.defect.findUnique({ where: { id: req.params.id } });
    if (!defect) throw new AppError(404, "ไม่พบข้อบกพร่องที่ร้องขอ");
    if (defect.status === "CLOSED") throw new AppError(400, "ข้อบกพร่องนี้ปิดแล้ว");
    // กันการกดซ้ำ ไม่งั้นบันทึกการแก้ไขจะถูกต่อท้ายลงในรายละเอียดเรื่อย ๆ ไม่มีที่สิ้นสุด
    if (defect.status === "FIXED")
      throw new AppError(400, "ข้อบกพร่องนี้บันทึกว่าแก้ไขแล้ว อยู่ระหว่างรอตรวจซ้ำ");

    // เงื่อนไขสถานะอยู่ใน where ของ updateMany ไม่ใช่แค่ if ข้างบน
    // เพื่อให้สองคำขอที่วิ่งพร้อมกันมีผู้ชนะเพียงรายเดียว
    const fixed = await prisma.defect.updateMany({
      where: { id: defect.id, status: "OPEN" },
      data: { status: "FIXED", detail: note.note ? `${defect.detail}\n\nการแก้ไข: ${note.note}` : defect.detail },
    });
    if (fixed.count === 0) throw new AppError(400, "ข้อบกพร่องนี้ถูกอัปเดตสถานะไปแล้ว");

    await writeAudit(currentUser(req).uid, "Defect", defect.id, "fix");
    res.json({ ok: true });
  })
);

const closeSchema = z.object({ closingInspectionId: z.string().min(1) });

router.post(
  "/defects/:id/close",
  requirePermission("defect:close"),
  ah(async (req, res) => {
    const parsed = closeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "การปิดข้อบกพร่องต้องอ้างอิงผลตรวจซ้ำที่มีหลักฐานแนบ");
    }
    const defect = await prisma.defect.findUnique({ where: { id: req.params.id } });
    if (!defect) throw new AppError(404, "ไม่พบข้อบกพร่องที่ร้องขอ");
    // ปิดซ้ำจะเขียนทับว่าใครปิดและปิดเมื่อไร ซึ่งทำลายร่องรอยการตรวจรับ
    if (defect.status === "CLOSED")
      throw new AppError(400, "ข้อบกพร่องนี้ปิดไปแล้ว ไม่สามารถปิดซ้ำได้");

    const retest = await prisma.inspection.findUnique({
      where: { id: parsed.data.closingInspectionId },
      include: { evidences: { select: { id: true } } },
    });
    if (!retest) throw new AppError(400, "ไม่พบผลตรวจซ้ำที่อ้างอิง");
    if (retest.pointId !== defect.pointId)
      throw new AppError(400, "ผลตรวจซ้ำที่อ้างอิงไม่ได้อยู่ที่จุดติดตั้งเดียวกับข้อบกพร่องนี้");
    if (retest.evidences.length === 0)
      throw new AppError(400, "ผลตรวจซ้ำที่อ้างอิงยังไม่มีหลักฐานแนบ ปิดข้อบกพร่องไม่ได้");
    // หลักฐานที่ถ่ายไว้ก่อนเปิดข้อบกพร่องไม่ใช่หลักฐานการแก้ไข
    if (retest.inspectedAt <= defect.createdAt)
      throw new AppError(400, "ผลตรวจซ้ำที่อ้างอิงเกิดขึ้นก่อนการเปิดข้อบกพร่องนี้ ใช้ปิดไม่ได้");

    const actor = currentUser(req);
    // เงื่อนไข "ยังไม่ปิด" อยู่ใน where ของ updateMany ไม่ใช่แค่ if ข้างบน
    // ไม่งั้นสองคำขอที่วิ่งพร้อมกันจะผ่าน if ทั้งคู่ แล้วรายหลังเขียนทับบันทึกว่าใครปิด
    const closed = await prisma.defect.updateMany({
      where: { id: defect.id, status: { not: "CLOSED" } },
      data: {
        status: "CLOSED",
        closingInspectionId: retest.id,
        closedAt: new Date(),
        closedById: actor.uid,
      },
    });
    if (closed.count === 0) throw new AppError(400, "ข้อบกพร่องนี้ปิดไปแล้ว ไม่สามารถปิดซ้ำได้");

    await writeAudit(actor.uid, "Defect", defect.id, "close", { closingInspectionId: retest.id });
    res.json({ ok: true });
  })
);

export default router;
