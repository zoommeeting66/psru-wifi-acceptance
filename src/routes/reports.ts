import { Router } from "express";
import { ah } from "../utils/asyncHandler";
import { requirePermission } from "../middleware/auth";
import { buildSummary } from "../services/summary";
import { listPoints } from "../services/pointQuery";
import { pointsToCsv } from "../services/csv";
import { buildCommitteePdf } from "../services/pdf";

const router = Router();

router.get(
  "/summary",
  requirePermission("point:read"),
  ah(async (_req, res) => res.json(await buildSummary()))
);

router.get(
  "/reports/points.csv",
  requirePermission("report:export"),
  ah(async (_req, res) => {
    const { rows } = await listPoints({ page: 1, pageSize: 100000 });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="PSRU_WiFi_Acceptance_${stamp}.csv"`);
    res.send(pointsToCsv(rows));
  })
);

router.get(
  "/reports/committee.pdf",
  requirePermission("report:export"),
  ah(async (_req, res) => {
    const buffer = await buildCommitteePdf();
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="PSRU_WiFi_Committee_${stamp}.pdf"`);
    res.send(buffer);
  })
);

export default router;
