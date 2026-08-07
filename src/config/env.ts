import dotenv from "dotenv";
dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parseInt(process.env.PORT ?? "3200", 10),
  tz: process.env.TZ ?? "Asia/Bangkok",
  databaseUrl: process.env.DATABASE_URL ?? "",
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_MB ?? "5", 10) * 1024 * 1024,
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-secret-change-me",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",
  },
};
