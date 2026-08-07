import { Router } from "express";
import { currentUser } from "../middleware/auth";
import pointsRouter from "./points";
import inspectionsRouter from "./inspections";
import evidenceRouter from "./evidence";
import defectsRouter from "./defects";
import plansRouter from "./plans";
import reportsRouter from "./reports";

const router = Router();

router.get("/me", (req, res) => res.json({ user: currentUser(req) }));
router.use(pointsRouter);
router.use(inspectionsRouter);
router.use(evidenceRouter);
router.use(defectsRouter);
router.use(plansRouter);
router.use(reportsRouter);

export default router;
