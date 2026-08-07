import { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { env } from "../config/env";
import { Permission, hasPermission } from "../lib/permissions";
import { AppError } from "./error";

export interface AuthPayload {
  uid: string;
  sub: string;
  role: UserRole;
  team: string | null;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.auth.jwtSecret, { expiresIn: env.auth.jwtExpiresIn } as jwt.SignOptions);
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "ต้องเข้าสู่ระบบก่อน" });
  try {
    (req as Request & { user?: AuthPayload }).user = jwt.verify(token, env.auth.jwtSecret) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ error: "เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่" });
  }
};

export function currentUser(req: Request): AuthPayload {
  const user = (req as Request & { user?: AuthPayload }).user;
  if (!user) throw new AppError(401, "ต้องเข้าสู่ระบบก่อน");
  return user;
}

export const requirePermission =
  (perm: Permission): RequestHandler =>
  (req, res, next) => {
    const user = (req as Request & { user?: AuthPayload }).user;
    if (!user) return res.status(401).json({ error: "ต้องเข้าสู่ระบบก่อน" });
    if (!hasPermission(user.role, perm))
      return res.status(403).json({ error: "บทบาทของคุณไม่มีสิทธิ์ดำเนินการนี้" });
    next();
  };
