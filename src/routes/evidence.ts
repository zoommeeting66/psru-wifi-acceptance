import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { ah } from "../utils/asyncHandler";
import { currentUser, requirePermission } from "../middleware/auth";
import { uploadEvidence } from "../middleware/upload";
import { AppError } from "../middleware/error";
import { writeAudit } from "../lib/audit";

const router = Router();

const metaSchema = z.object({
  kind: z.enum(["LOCATION", "LABEL", "CONFIG", "FUNCTIONAL", "PERFORMANCE", "DOCS"]),
  capturedAt: z.string().datetime().optional(),
});

function sha256OfFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

router.post(
  "/inspections/:inspectionId/evidence",
  requirePermission("inspection:write"),
  uploadEvidence,
  ah(async (req, res) => {
    if ((req as unknown as { fileRejected?: boolean }).fileRejected) {
      throw new AppError(415, "รองรับเฉพาะไฟล์ JPEG, PNG หรือ PDF");
    }
    const file = req.file;
    if (!file) throw new AppError(400, "ไม่พบไฟล์ที่อัปโหลด");

    const meta = metaSchema.parse(req.body);
    const inspection = await prisma.inspection.findUnique({ where: { id: req.params.inspectionId } });
    if (!inspection) {
      fs.unlinkSync(file.path);
      throw new AppError(404, "ไม่พบผลตรวจที่ต้องการแนบหลักฐาน");
    }

    const evidence = await prisma.evidence.create({
      data: {
        inspectionId: inspection.id,
        kind: meta.kind,
        filePath: path.basename(file.path),
        mime: file.mimetype,
        size: file.size,
        sha256: sha256OfFile(file.path),
        capturedAt: meta.capturedAt ? new Date(meta.capturedAt) : new Date(),
      },
    });

    await writeAudit(currentUser(req).uid, "Evidence", evidence.id, "upload", { kind: meta.kind });
    res.status(201).json({
      id: evidence.id,
      kind: evidence.kind,
      sha256: evidence.sha256,
      url: `/api/v1/evidence/${evidence.id}/file`,
    });
  })
);

router.get(
  "/evidence/:id/file",
  requirePermission("point:read"),
  ah(async (req, res) => {
    const evidence = await prisma.evidence.findUnique({ where: { id: req.params.id } });
    if (!evidence) throw new AppError(404, "ไม่พบไฟล์หลักฐาน");
    const full = path.join(path.resolve(env.uploadDir), evidence.filePath);
    if (!fs.existsSync(full)) throw new AppError(404, "ไฟล์หลักฐานสูญหายจากที่จัดเก็บ");
    res.type(evidence.mime).sendFile(full);
  })
);

export default router;
