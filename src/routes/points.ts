import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ah } from "../utils/asyncHandler";
import { requirePermission } from "../middleware/auth";
import { getPointDetail, listPoints } from "../services/pointQuery";
import { PointStatus } from "../services/pointStatus";

const router = Router();

const listQuery = z.object({
  search: z.string().optional(),
  buildingId: z.string().optional(),
  status: z.enum(["PENDING", "DEFECT", "AWAITING_RETEST", "EVIDENCE_COMPLETE", "UNDER_REVIEW"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});

router.get(
  "/points",
  requirePermission("point:read"),
  ah(async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json(await listPoints({ ...q, status: q.status as PointStatus | undefined }));
  })
);

router.get(
  "/points/:id",
  requirePermission("point:read"),
  ah(async (req, res) => {
    res.json(await getPointDetail(req.params.id));
  })
);

router.get(
  "/buildings",
  requirePermission("point:read"),
  ah(async (_req, res) => {
    const buildings = await prisma.building.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    });
    res.json({ buildings });
  })
);

/** เกณฑ์ TOR ทั้งชุด — หน้ามือถือต้องแคชไว้เพื่อแสดงเกณฑ์กำกับช่องกรอกตอนออฟไลน์ */
router.get(
  "/criteria",
  requirePermission("point:read"),
  ah(async (_req, res) => {
    const criteria = await prisma.criteria.findMany({
      orderBy: { key: "asc" },
      select: { key: true, label: true, operator: true, threshold: true, unit: true, torClause: true },
    });
    res.json({ criteria });
  })
);

export default router;
