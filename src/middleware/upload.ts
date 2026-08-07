import fs from "fs";
import path from "path";
import multer from "multer";
import { env } from "../config/env";

const ALLOWED = new Set(["image/jpeg", "image/png", "application/pdf"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.resolve(env.uploadDir);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".bin";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});

export const uploadEvidence = multer({
  storage,
  limits: { fileSize: env.maxUploadBytes },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      // Skip (not error) so busboy drains the rejected file's stream instead
      // of aborting mid-parse: an fileFilter error leaves the stream unread,
      // which races the client's still-in-flight write and can surface as
      // ECONNRESET instead of delivering the intended 415 response.
      (req as unknown as { fileRejected?: boolean }).fileRejected = true;
      return cb(null, false);
    }
    cb(null, true);
  },
}).single("file");
