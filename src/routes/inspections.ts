import { Router } from "express";
import { z } from "zod";
import { ah } from "../utils/asyncHandler";
import { currentUser, requirePermission } from "../middleware/auth";
import { submitInspection } from "../services/inspectionWrite";

const router = Router();

const submitSchema = z.object({
  clientUuid: z.string().uuid(),
  pointCode: z.string().min(1),
  inspectedAt: z.string().datetime(),
  measurements: z.record(z.union([z.number(), z.string(), z.null()])).default({}),
  note: z.string().max(2000).optional(),
  serial: z.string().max(120).optional(),
  mac: z.string().max(120).optional(),
  planId: z.string().min(1).optional(),
  defect: z
    .object({
      severity: z.enum(["URGENT", "MAJOR", "MINOR"]),
      title: z.string().min(1).max(200),
      detail: z.string().min(1).max(2000),
      owner: z.string().max(200).optional(),
      dueDate: z.string().datetime().optional(),
    })
    .optional(),
});

router.post(
  "/inspections",
  requirePermission("inspection:write"),
  ah(async (req, res) => {
    const input = submitSchema.parse(req.body);
    const result = await submitInspection(input, { uid: currentUser(req).uid });
    res.status(201).json(result);
  })
);

export default router;
