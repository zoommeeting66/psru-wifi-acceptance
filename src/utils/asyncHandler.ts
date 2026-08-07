import { RequestHandler } from "express";

/** ห่อ async handler เพื่อให้ error ที่ throw ส่งต่อไปยัง error middleware ของ Express 4 */
export const ah =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
