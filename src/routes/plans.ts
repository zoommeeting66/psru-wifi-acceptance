import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { ah } from "../utils/asyncHandler";
import { currentUser, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/error";

const router = Router();

export const DEFAULT_GATES = { docs: "PENDING", site: "PENDING", test: "PENDING", summary: "PENDING" };

const gateState = z.enum(["PENDING", "ACTIVE", "DONE"]);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ต้องเป็นวันที่รูปแบบ YYYY-MM-DD");

/** เก็บวันที่แผนเป็นเที่ยงคืน UTC เพื่อให้คอลัมน์ @db.Date เทียบตรงกันทุกเครื่อง */
function toPlanDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * วันที่ "วันนี้" ตามเวลาไทย ไม่ใช่ UTC
 * ถ้าใช้ toISOString() ช่างที่เปิดแอปก่อน 07:00 น. จะได้แผนของเมื่อวาน
 * เพราะ UTC ยังไม่ข้ามวัน ซึ่งเป็นช่วงเวลาที่ทีมภาคสนามเริ่มงานพอดี
 */
function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: env.tz }).format(new Date());
}

router.get(
  "/plans",
  requirePermission("point:read"),
  ah(async (req, res) => {
    const q = z.object({ date: dateOnly.optional() }).parse(req.query);
    const plans = await prisma.plan.findMany({
      where: q.date ? { date: toPlanDate(q.date) } : {},
      orderBy: [{ date: "desc" }, { team: "asc" }],
      include: { items: { select: { doneAt: true } } },
    });
    res.json({
      plans: plans.map((p) => ({
        id: p.id,
        date: p.date.toISOString().slice(0, 10),
        team: p.team,
        note: p.note,
        gates: p.gates,
        total: p.items.length,
        done: p.items.filter((i) => i.doneAt !== null).length,
      })),
    });
  })
);

const upsertSchema = z.object({
  date: dateOnly,
  team: z.string().min(1).max(100),
  note: z.string().max(1000).optional(),
  pointIds: z.array(z.string().min(1)).min(1, "ต้องเลือกอย่างน้อย 1 จุด"),
});

router.post(
  "/plans",
  requirePermission("plan:write"),
  ah(async (req, res) => {
    const input = upsertSchema.parse(req.body);
    const date = toPlanDate(input.date);

    const incoming = [...new Set(input.pointIds)];

    const plan = await prisma.$transaction(async (tx) => {
      // ตรวจรหัสจุดก่อนเขียน ไม่งั้น FK violation จะโผล่เป็น 500 ทั้งที่เป็นข้อมูลนำเข้าผิด
      const found = await tx.point.count({ where: { id: { in: incoming } } });
      if (found !== incoming.length)
        throw new AppError(400, "มีรหัสจุดติดตั้งที่ไม่พบในทะเบียน กรุณาตรวจสอบรายการที่เลือก");

      const existing = await tx.plan.findUnique({ where: { date_team: { date, team: input.team } } });
      const saved = existing
        ? await tx.plan.update({
            where: { id: existing.id },
            // แก้ note เฉพาะเมื่อส่งมาจริง ไม่งั้นการแก้รายการจุดจะลบหมายเหตุเดิมทิ้ง
            data: input.note !== undefined ? { note: input.note } : {},
          })
        : await tx.plan.create({
            data: { date, team: input.team, note: input.note ?? null, gates: DEFAULT_GATES },
          });

      // แก้แผนแบบเทียบส่วนต่าง ไม่ใช่ลบทิ้งแล้วสร้างใหม่
      // เพราะ doneAt อยู่บน PlanItem — ลบทิ้งเท่ากับล้างงานที่ช่างตรวจไปแล้วของวันนั้น
      const currentItems = await tx.planItem.findMany({
        where: { planId: saved.id },
        select: { pointId: true },
      });
      const currentIds = new Set(currentItems.map((i) => i.pointId));

      await tx.planItem.deleteMany({ where: { planId: saved.id, pointId: { notIn: incoming } } });
      await tx.planItem.createMany({
        data: incoming
          .filter((pointId) => !currentIds.has(pointId))
          .map((pointId) => ({ planId: saved.id, pointId, order: incoming.indexOf(pointId) })),
      });
      for (const pointId of incoming.filter((id) => currentIds.has(id))) {
        await tx.planItem.update({
          where: { planId_pointId: { planId: saved.id, pointId } },
          data: { order: incoming.indexOf(pointId) },
        });
      }
      return saved;
    });

    res.status(201).json({ id: plan.id });
  })
);

router.patch(
  "/plans/:id/gates",
  requirePermission("plan:write"),
  ah(async (req, res) => {
    const { gates } = z
      .object({
        gates: z.object({ docs: gateState, site: gateState, test: gateState, summary: gateState }),
      })
      .parse(req.body);
    const plan = await prisma.plan.findUnique({ where: { id: req.params.id } });
    if (!plan) throw new AppError(404, "ไม่พบแผนตรวจที่ร้องขอ");
    await prisma.plan.update({ where: { id: plan.id }, data: { gates } });
    res.json({ ok: true });
  })
);

router.get(
  "/plans/today/mine",
  requirePermission("point:read"),
  ah(async (req, res) => {
    const user = currentUser(req);
    if (!user.team) return res.json({ plan: null, points: [] });

    const plan = await prisma.plan.findUnique({
      where: { date_team: { date: toPlanDate(todayStr()), team: user.team } },
      include: {
        items: {
          orderBy: { order: "asc" },
          include: { point: { include: { building: true } } },
        },
      },
    });
    if (!plan) return res.json({ plan: null, points: [] });

    res.json({
      plan: { id: plan.id, date: plan.date.toISOString().slice(0, 10), team: plan.team, gates: plan.gates },
      points: plan.items.map((i) => ({
        id: i.point.id,
        code: i.point.code,
        buildingName: i.point.building.name,
        floor: i.point.floor,
        room: i.point.room,
        deviceModel: i.point.deviceModel,
        serial: i.point.serial,
        mac: i.point.mac,
        doneAt: i.doneAt ? i.doneAt.toISOString() : null,
      })),
    });
  })
);

export default router;
