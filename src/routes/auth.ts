import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signToken } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { AppError } from "../middleware/error";

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post(
  "/login",
  ah(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.active) throw new AppError(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new AppError(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");

    const token = signToken({ uid: user.id, sub: user.username, role: user.role, team: user.team });
    res.json({
      token,
      user: { id: user.id, username: user.username, name: user.name, role: user.role, team: user.team },
    });
  })
);

export default router;
