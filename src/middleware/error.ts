import { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../utils/logger";

/** ข้อผิดพลาดที่ตั้งใจโยนจาก service พร้อมสถานะ HTTP และข้อความภาษาไทย */
export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({ error: `ข้อมูลไม่ถูกต้อง: ${first.path.join(".")} ${first.message}` });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err?.code === "P2025") {
    return res.status(404).json({ error: "ไม่พบข้อมูลที่ร้องขอ" });
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "ไฟล์ใหญ่เกินกำหนด" });
  }
  if (err?.code === "ENOSPC") {
    return res.status(507).json({ error: "พื้นที่จัดเก็บเต็ม กรุณาแจ้งผู้ดูแลระบบ" });
  }
  logger.error("Unhandled error:", err);
  res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
};
