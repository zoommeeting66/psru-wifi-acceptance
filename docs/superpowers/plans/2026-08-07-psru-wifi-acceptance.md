# PSRU WiFi 1,000-Point Acceptance System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-user acceptance-inspection system for a 1,000-point campus Wi-Fi rollout: field technicians capture results and photo evidence on phones (working without signal), the committee reviews progress, manages defects, and issues a signed summary report.

**Architecture:** Express + TypeScript + Prisma + PostgreSQL backend serving a static ES-module frontend from `public/` (no frontend build step). Inspection records are **append-only** — every field submission creates a new row keyed by a client-generated UUID, so retrying an offline queue can never duplicate or clobber data, and point status is *derived* rather than stored. Mobile capture is a separate route (`/m`) backed by IndexedDB + a Service Worker.

**Tech Stack:** Node 20+, TypeScript 5.6 (CommonJS, strict), Express 4, Prisma 5 + PostgreSQL 17, Vitest + Supertest, multer (disk storage), pdfmake (Thai font embedded), zod, bcryptjs, jsonwebtoken. Frontend: vanilla ES modules, no bundler, no CDN.

**Spec:** [`docs/superpowers/specs/2026-08-07-psru-wifi-acceptance-design.md`](../specs/2026-08-07-psru-wifi-acceptance-design.md)

## Global Constraints

- **Project root:** `C:\Users\Acer\preschool\wifi1000\`. All paths in this plan are relative to it.
- **The system never decides acceptance.** No endpoint, column, or UI label may state that a point "passed" or "failed" acceptance. The system reports *measured value vs. TOR threshold* and flags values below threshold. The disclaimer text must appear on the overview screen and in every generated PDF.
- **Inspections are append-only.** Never `UPDATE` an `Inspection` row's result fields. A re-inspection is a new row. Point status is always derived, never stored.
- **Idempotency:** every inspection write is an upsert on `Inspection.clientUuid` (unique). Submitting the same `clientUuid` N times must yield exactly one row.
- **Thai text goes in files, never through the shell.** Writing Thai through PowerShell/curl mangles the encoding (confirmed on this machine). Seed data, fixtures, and UI copy must be written with a file-writing tool. Never `echo` Thai into a file or pass it as a CLI argument.
- **No CDN.** Fonts, CSS, and JS are self-hosted under `public/`, because field devices may be offline.
- **Internal status codes are ASCII**, Thai appears only as display labels in the frontend label maps. This keeps DB values, query strings, and test assertions shell-safe.
- **Local database:** PostgreSQL 17 on `localhost:5432`, role `psru` / password `<password>` (already installed for the `aemns` project). This project uses database `psru_wifi`, tests use `psru_wifi_test`.
- **API prefix:** `/api/v1`. Auth is `Authorization: Bearer <jwt>`; only `/api/v1/health` and `/api/v1/auth/login` are public.
- **Error responses** are `{ "error": "<ข้อความภาษาไทย>" }` with the appropriate HTTP status.
- **Every task ends with a commit.** Commit messages: `feat:`, `test:`, `fix:`, `chore:`.

## File Structure

| Path | Responsibility |
|---|---|
| `prisma/schema.prisma` | Data model, single source of truth for DB shape |
| `prisma/seed.ts` | Bootstrap users, criteria, buildings, 1,000 points |
| `src/config/env.ts` | Typed env access, one place |
| `src/lib/prisma.ts` | Prisma client singleton |
| `src/lib/permissions.ts` | Role → permission matrix (pure) |
| `src/lib/audit.ts` | Write `AuditLog` entries |
| `src/utils/asyncHandler.ts` | Wrap async handlers for Express 4 error flow |
| `src/utils/logger.ts` | Console logger |
| `src/middleware/auth.ts` | JWT verify + `requirePermission` |
| `src/middleware/upload.ts` | multer disk storage + file-type/size limits |
| `src/middleware/error.ts` | Central error handler |
| `src/services/criteria.ts` | Pure: measured values vs TOR thresholds |
| `src/services/pointStatus.ts` | Pure: derive point status from inspections + defects |
| `src/services/pointQuery.ts` | Point list/detail queries with derived status attached |
| `src/services/inspectionWrite.ts` | Idempotent inspection upsert |
| `src/services/csv.ts` | CSV export |
| `src/services/pdf.ts` | Committee summary PDF (pdfmake) |
| `src/routes/*.ts` | One router per resource, HTTP concerns only |
| `public/css/tokens.css` | Design tokens from the approved mockup |
| `public/js/core/*` | api client, router, store, formatters, dom helper |
| `public/js/pages/*` | One module per desktop screen |
| `public/js/offline/*` | IndexedDB wrapper, outbox, image resizing |
| `public/js/mobile/*` | Field capture screens |
| `public/sw.js` | Service worker (app shell + today's points) |
| `tests/setup.ts` | Vitest `setupFiles` entry — points `DATABASE_URL` at the test database before any Prisma client is constructed |
| `tests/*` | Vitest suites mirroring `src/` |

Routers hold no business logic — they validate input with zod, call a service, and shape the response. Services never touch `req`/`res`. This is what makes the pure services (`criteria`, `pointStatus`) testable without a database.

---

## Task 1: Project scaffold and health endpoint

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `.env`
- Create: `src/config/env.ts`, `src/utils/logger.ts`, `src/utils/asyncHandler.ts`, `src/middleware/error.ts`, `src/app.ts`, `src/server.ts`
- Create: `vitest.config.ts`, `tests/health.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `createApp(): express.Express` from `src/app.ts`
  - `env` object from `src/config/env.ts` with `env.port: number`, `env.nodeEnv: string`, `env.databaseUrl: string`, `env.uploadDir: string`, `env.auth.jwtSecret: string`, `env.auth.jwtExpiresIn: string`
  - `ah(fn: RequestHandler): RequestHandler` from `src/utils/asyncHandler.ts`
  - `logger` with `.info()`, `.warn()`, `.error()` from `src/utils/logger.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "psru-wifi-acceptance",
  "version": "1.0.0",
  "description": "PSRU Wi-Fi 1,000-point acceptance inspection support system",
  "main": "dist/server.js",
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:seed": "ts-node prisma/seed.ts",
    "import:csv": "ts-node src/scripts/importCsv.ts"
  },
  "prisma": { "seed": "ts-node prisma/seed.ts" },
  "dependencies": {
    "@prisma/client": "^5.20.0",
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "helmet": "^8.0.0",
    "jsonwebtoken": "^9.0.3",
    "multer": "^1.4.5-lts.1",
    "pdfmake": "^0.2.10",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/multer": "^1.4.13",
    "@types/node": "^22.7.4",
    "@types/pdfmake": "^0.2.9",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.20.0",
    "supertest": "^7.0.0",
    "ts-node": "^10.9.2",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.6.2",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "prisma/**/*.ts"],
  "exclude": ["node_modules", "dist", "public", "tests"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
.env
uploads/
*.log
```

- [ ] **Step 4: Create `.env.example`**

```
NODE_ENV=development
PORT=3200
TZ=Asia/Bangkok
DATABASE_URL=postgresql://psru:<password>@localhost:5432/psru_wifi
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=12h
UPLOAD_DIR=uploads
MAX_UPLOAD_MB=5
```

- [ ] **Step 5: Create `.env` with the same contents as `.env.example`**

Copy the file. Port 3200 avoids colliding with the `aemns` project on 3000 and its LINE webhook helper on 3100.

- [ ] **Step 6: Create `src/config/env.ts`**

```ts
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
```

- [ ] **Step 7: Create `src/utils/logger.ts`**

```ts
const stamp = () => new Date().toISOString();

export const logger = {
  info: (...args: unknown[]) => console.log(`[${stamp()}] INFO`, ...args),
  warn: (...args: unknown[]) => console.warn(`[${stamp()}] WARN`, ...args),
  error: (...args: unknown[]) => console.error(`[${stamp()}] ERROR`, ...args),
};
```

- [ ] **Step 8: Create `src/utils/asyncHandler.ts`**

```ts
import { RequestHandler } from "express";

/** ห่อ async handler เพื่อให้ error ที่ throw ส่งต่อไปยัง error middleware ของ Express 4 */
export const ah =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
```

- [ ] **Step 9: Create `src/middleware/error.ts`**

```ts
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
```

- [ ] **Step 10: Create `src/app.ts`**

```ts
import express from "express";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import { errorHandler } from "./middleware/error";

export function createApp() {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

  app.use(express.static(path.join(__dirname, "..", "public")));

  app.use("/api", (_req, res) => res.status(404).json({ error: "ไม่พบเส้นทางที่ร้องขอ" }));
  app.use(errorHandler);

  return app;
}
```

- [ ] **Step 11: Create `src/server.ts`**

```ts
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./utils/logger";

createApp().listen(env.port, () => {
  logger.info(`PSRU WiFi Acceptance API listening on http://localhost:${env.port}`);
});
```

- [ ] **Step 12: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
```

`fileParallelism: false` matters — later tasks add suites that share one test database, and parallel files would race on truncation.

- [ ] **Step 13: Write the failing test `tests/health.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

describe("health", () => {
  it("returns ok", async () => {
    const res = await request(createApp()).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("returns a Thai error for unknown api routes", async () => {
    const res = await request(createApp()).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});
```

- [ ] **Step 14: Install dependencies and run the test**

```bash
npm install
```

Run: `npm test`
Expected: 2 tests pass. (If `npm install` fails on `@types/pdfmake`, it is only needed from Task 11 — do not remove it, re-run install.)

- [ ] **Step 15: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example vitest.config.ts src tests
git commit -m "chore: scaffold express+ts project with health endpoint"
```

---

## Task 2: Database schema, migration, and seed

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/prisma.ts`
- Create: `tests/helpers/db.ts`
- Create: `tests/schema.test.ts`

**Interfaces:**
- Consumes: `env` (Task 1)
- Produces:
  - `prisma` singleton from `src/lib/prisma.ts`
  - Prisma model types: `User`, `Project`, `Building`, `Point`, `Criteria`, `Inspection`, `Evidence`, `Defect`, `Plan`, `PlanItem`, `AuditLog`
  - Enums: `UserRole` (`FIELD` | `COMMITTEE` | `ADMIN`), `DefectSeverity` (`URGENT` | `MAJOR` | `MINOR`), `DefectStatus` (`OPEN` | `FIXED` | `CLOSED`), `EvidenceKind` (`LOCATION` | `LABEL` | `CONFIG` | `FUNCTIONAL` | `PERFORMANCE` | `DOCS`)
  - Gate states (`PENDING` | `ACTIVE` | `DONE`) are values inside the `Plan.gates` JSON column, not a Prisma enum — Task 10 validates them with zod at the API boundary.
  - `resetDb(): Promise<void>` from `tests/helpers/db.ts`

- [ ] **Step 1: Create the databases**

```bash
"/c/Program Files/PostgreSQL/17/bin/psql.exe" -U postgres -c "CREATE DATABASE psru_wifi OWNER psru;" -c "CREATE DATABASE psru_wifi_test OWNER psru;"
```

Password when prompted: `<password>`. Expected: `CREATE DATABASE` twice. If a database already exists, the error is harmless — continue.

- [ ] **Step 2: Create `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  FIELD
  COMMITTEE
  ADMIN
}

enum DefectSeverity {
  URGENT
  MAJOR
  MINOR
}

enum DefectStatus {
  OPEN
  FIXED
  CLOSED
}

enum EvidenceKind {
  LOCATION
  LABEL
  CONFIG
  FUNCTIONAL
  PERFORMANCE
  DOCS
}

model User {
  id           String       @id @default(cuid())
  username     String       @unique
  passwordHash String
  name         String
  role         UserRole     @default(FIELD)
  team         String?
  active       Boolean      @default(true)
  createdAt    DateTime     @default(now())
  inspections  Inspection[]
  auditLogs    AuditLog[]
}

model Project {
  id          String     @id @default(cuid())
  name        String
  contractNo  String
  torRef      String
  totalPoints Int
  createdAt   DateTime   @default(now())
  buildings   Building[]
  criteria    Criteria[]
}

model Building {
  id        String  @id @default(cuid())
  projectId String
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  code      String
  name      String
  points    Point[]

  @@unique([projectId, code])
}

model Point {
  id          String       @id @default(cuid())
  code        String       @unique
  buildingId  String
  building    Building     @relation(fields: [buildingId], references: [id], onDelete: Cascade)
  floor       String
  room        String
  deviceModel String?
  serial      String?
  mac         String?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  inspections Inspection[]
  defects     Defect[]
  planItems   PlanItem[]

  @@index([buildingId])
  @@index([serial])
}

model Criteria {
  id        String  @id @default(cuid())
  projectId String
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  key       String
  label     String
  operator  String // "gte" | "lte"
  threshold Float
  unit      String
  torClause String

  @@unique([projectId, key])
}

model Inspection {
  id            String     @id @default(cuid())
  clientUuid    String     @unique
  pointId       String
  point         Point      @relation(fields: [pointId], references: [id], onDelete: Cascade)
  inspectorId   String
  inspector     User       @relation(fields: [inspectorId], references: [id])
  inspectedAt   DateTime
  measurements  Json
  note          String?
  serial        String?
  mac           String?
  createdAt     DateTime   @default(now())
  evidences     Evidence[]
  defectsOpened Defect[]   @relation("DefectOpenedBy")
  defectsClosed Defect[]   @relation("DefectClosedBy")

  @@index([pointId, inspectedAt])
}

model Evidence {
  id           String       @id @default(cuid())
  inspectionId String
  inspection   Inspection   @relation(fields: [inspectionId], references: [id], onDelete: Cascade)
  kind         EvidenceKind
  filePath     String
  mime         String
  size         Int
  sha256       String
  capturedAt   DateTime
  createdAt    DateTime     @default(now())

  @@index([inspectionId])
}

model Defect {
  id                  String         @id @default(cuid())
  pointId             String
  point               Point          @relation(fields: [pointId], references: [id], onDelete: Cascade)
  inspectionId        String
  inspection          Inspection     @relation("DefectOpenedBy", fields: [inspectionId], references: [id], onDelete: Cascade)
  severity            DefectSeverity
  title               String
  detail              String
  owner               String?
  dueDate             DateTime?
  status              DefectStatus   @default(OPEN)
  closingInspectionId String?
  closingInspection   Inspection?    @relation("DefectClosedBy", fields: [closingInspectionId], references: [id])
  closedAt            DateTime?
  closedById          String?
  createdAt           DateTime       @default(now())

  @@index([status, severity])
  @@index([pointId])
}

model Plan {
  id        String     @id @default(cuid())
  date      DateTime   @db.Date
  team      String
  note      String?
  gates     Json
  createdAt DateTime   @default(now())
  items     PlanItem[]

  @@unique([date, team])
}

model PlanItem {
  id      String    @id @default(cuid())
  planId  String
  plan    Plan      @relation(fields: [planId], references: [id], onDelete: Cascade)
  pointId String
  point   Point     @relation(fields: [pointId], references: [id], onDelete: Cascade)
  order   Int
  doneAt  DateTime?

  @@unique([planId, pointId])
}

model AuditLog {
  id       String   @id @default(cuid())
  actorId  String?
  actor    User?    @relation(fields: [actorId], references: [id])
  entity   String
  entityId String
  action   String
  payload  Json?
  at       DateTime @default(now())

  @@index([entity, entityId])
}
```

`Plan.gates` holds `{ "docs": "PENDING", "site": "PENDING", "test": "PENDING", "summary": "PENDING" }` — the four gates shown on the overview card. It is JSON rather than four columns because it is display state owned entirely by the plan, never queried across rows.

- [ ] **Step 3: Push the schema and generate the client**

```bash
npx prisma db push && npx prisma generate
```

Expected: "Your database is now in sync with your Prisma schema." followed by "Generated Prisma Client".

- [ ] **Step 4: Create `src/lib/prisma.ts`**

```ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
```

- [ ] **Step 5: Create `prisma/seed.ts`**

Write this with a file-writing tool, never through the shell — it contains Thai text.

```ts
import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const BUILDINGS = [
  { code: "B01", name: "อาคารทีปวิชญ์" },
  { code: "B02", name: "อาคารคณะวิทยาศาสตร์" },
  { code: "B03", name: "หอสมุดกลาง" },
  { code: "B04", name: "หอประชุมศรีวชิรโชติ" },
  { code: "B05", name: "อาคารกิจการนักศึกษา" },
  { code: "B06", name: "อาคารคณะครุศาสตร์" },
  { code: "B07", name: "อาคารคณะมนุษยศาสตร์และสังคมศาสตร์" },
  { code: "B08", name: "อาคารคณะเทคโนโลยีอุตสาหกรรม" },
  { code: "B09", name: "อาคารสำนักงานอธิการบดี" },
  { code: "B10", name: "หอพักทะเลแก้วนิเวศ" },
];

const CRITERIA = [
  { key: "rssi", label: "ความแรงสัญญาณ (RSSI)", operator: "gte", threshold: -67, unit: "dBm", torClause: "TOR ข้อ 4.2" },
  { key: "downloadMbps", label: "ความเร็วดาวน์โหลด", operator: "gte", threshold: 100, unit: "Mbps", torClause: "TOR ข้อ 4.3" },
  { key: "uploadMbps", label: "ความเร็วอัปโหลด", operator: "gte", threshold: 50, unit: "Mbps", torClause: "TOR ข้อ 4.3" },
  { key: "latencyMs", label: "ค่าหน่วงเวลา", operator: "lte", threshold: 30, unit: "ms", torClause: "TOR ข้อ 4.4" },
];

const USERS = [
  { username: "admin", name: "ผู้ดูแลระบบ", role: UserRole.ADMIN, team: null },
  { username: "committee", name: "กรรมการตรวจรับ", role: UserRole.COMMITTEE, team: null },
  { username: "field1", name: "ช่างเทคนิค ทีม A", role: UserRole.FIELD, team: "ทีม A" },
  { username: "field2", name: "ช่างเทคนิค ทีม B", role: UserRole.FIELD, team: "ทีม B" },
];

async function main() {
  const passwordHash = await bcrypt.hash("psru1234", 10);
  for (const u of USERS) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: { name: u.name, role: u.role, team: u.team },
      create: { ...u, passwordHash },
    });
  }

  const project = await prisma.project.create({
    data: {
      name: "โครงการติดตั้งระบบเครือข่ายไร้สาย 1,000 จุด",
      contractNo: "สัญญาเลขที่ (ระบุภายหลัง)",
      torRef: "TOR โครงการ Wi-Fi 1,000 จุด",
      totalPoints: 1000,
      criteria: { create: CRITERIA },
      buildings: { create: BUILDINGS },
    },
    include: { buildings: true },
  });

  const buildings = project.buildings;
  const points = Array.from({ length: 1000 }, (_, i) => {
    const n = i + 1;
    const building = buildings[i % buildings.length];
    return {
      code: `AP-${String(n).padStart(4, "0")}`,
      buildingId: building.id,
      floor: `ชั้น ${(i % 6) + 1}`,
      room: `พื้นที่ ${String((i % 50) + 1).padStart(2, "0")}`,
      deviceModel: "AP รุ่นตามบัญชีส่งมอบ",
    };
  });
  await prisma.point.createMany({ data: points });

  console.log(`Seeded ${USERS.length} users, ${buildings.length} buildings, ${CRITERIA.length} criteria, 1000 points.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 6: Run the seed**

```bash
npm run db:seed
```

Expected: `Seeded 4 users, 10 buildings, 4 criteria, 1000 points.`

- [ ] **Step 7: Create `tests/helpers/db.ts`**

```ts
process.env.DATABASE_URL = "postgresql://psru:<password>@localhost:5432/psru_wifi_test";

import { PrismaClient } from "@prisma/client";

export const testPrisma = new PrismaClient();

/** ล้างข้อมูลทุกตารางตามลำดับ FK เพื่อให้แต่ละ suite เริ่มจากฐานว่าง */
export async function resetDb(): Promise<void> {
  await testPrisma.$executeRawUnsafe(
    `TRUNCATE "AuditLog","PlanItem","Plan","Defect","Evidence","Inspection","Point","Criteria","Building","Project","User" RESTART IDENTITY CASCADE`
  );
}
```

The `process.env.DATABASE_URL` assignment must be the first statement in the file, before the Prisma import, so the client picks up the test database.

- [ ] **Step 8: Push the schema to the test database**

```bash
DATABASE_URL="postgresql://psru:<password>@localhost:5432/psru_wifi_test" npx prisma db push --skip-generate
```

Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 9: Write the test `tests/schema.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testPrisma, resetDb } from "./helpers/db";

describe("schema", () => {
  beforeEach(resetDb);
  afterAll(() => testPrisma.$disconnect());

  it("rejects a duplicate clientUuid on Inspection", async () => {
    const user = await testPrisma.user.create({
      data: { username: "u1", passwordHash: "x", name: "n", role: "FIELD" },
    });
    const project = await testPrisma.project.create({
      data: { name: "p", contractNo: "c", torRef: "t", totalPoints: 1 },
    });
    const building = await testPrisma.building.create({
      data: { projectId: project.id, code: "B01", name: "b" },
    });
    const point = await testPrisma.point.create({
      data: { code: "AP-0001", buildingId: building.id, floor: "1", room: "r" },
    });

    const base = {
      clientUuid: "uuid-1",
      pointId: point.id,
      inspectorId: user.id,
      inspectedAt: new Date(),
      measurements: {},
    };
    await testPrisma.inspection.create({ data: base });
    await expect(testPrisma.inspection.create({ data: base })).rejects.toThrow();
  });
});
```

- [ ] **Step 10: Run the test**

Run: `npm test -- tests/schema.test.ts`
Expected: PASS. This proves the unique constraint that all offline idempotency depends on actually exists in the database.

- [ ] **Step 11: Commit**

```bash
git add prisma src/lib tests
git commit -m "feat: add prisma schema, seed, and test database helper"
```

---

## Task 3: Criteria evaluation service (pure)

**Files:**
- Create: `src/services/criteria.ts`
- Create: `tests/criteria.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no DB)
- Produces:
  ```ts
  export type CriteriaOperator = "gte" | "lte";
  export interface CriteriaDef {
    key: string; label: string; operator: CriteriaOperator;
    threshold: number; unit: string; torClause: string;
  }
  export interface MeasurementCheck {
    key: string; label: string; unit: string; torClause: string;
    operator: CriteriaOperator; threshold: number;
    value: number | null;      // null = ยังไม่ได้วัด
    belowThreshold: boolean;   // true = ค่าที่วัดได้ไม่เป็นไปตามเกณฑ์ TOR
  }
  export function evaluateMeasurements(
    defs: CriteriaDef[],
    measurements: Record<string, unknown>
  ): MeasurementCheck[];
  ```

- [ ] **Step 1: Write the failing test `tests/criteria.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { evaluateMeasurements, CriteriaDef } from "../src/services/criteria";

const defs: CriteriaDef[] = [
  { key: "rssi", label: "RSSI", operator: "gte", threshold: -67, unit: "dBm", torClause: "4.2" },
  { key: "latencyMs", label: "Latency", operator: "lte", threshold: 30, unit: "ms", torClause: "4.4" },
];

describe("evaluateMeasurements", () => {
  it("flags a value worse than a gte threshold", () => {
    const [rssi] = evaluateMeasurements(defs, { rssi: -76 });
    expect(rssi.value).toBe(-76);
    expect(rssi.belowThreshold).toBe(true);
  });

  it("accepts a value exactly at a gte threshold", () => {
    const [rssi] = evaluateMeasurements(defs, { rssi: -67 });
    expect(rssi.belowThreshold).toBe(false);
  });

  it("accepts a value exactly at an lte threshold", () => {
    const latency = evaluateMeasurements(defs, { latencyMs: 30 })[1];
    expect(latency.belowThreshold).toBe(false);
  });

  it("flags a value above an lte threshold", () => {
    const latency = evaluateMeasurements(defs, { latencyMs: 31 })[1];
    expect(latency.belowThreshold).toBe(true);
  });

  it("treats a missing measurement as not-yet-measured, not a failure", () => {
    const [rssi] = evaluateMeasurements(defs, {});
    expect(rssi.value).toBeNull();
    expect(rssi.belowThreshold).toBe(false);
  });

  it("treats a non-numeric measurement as not-yet-measured", () => {
    const [rssi] = evaluateMeasurements(defs, { rssi: "ไม่ได้วัด" });
    expect(rssi.value).toBeNull();
    expect(rssi.belowThreshold).toBe(false);
  });

  it("returns one check per criteria definition, in order", () => {
    const checks = evaluateMeasurements(defs, { rssi: -50, latencyMs: 10 });
    expect(checks.map((c) => c.key)).toEqual(["rssi", "latencyMs"]);
  });
});
```

The boundary tests matter: a point measured at exactly −67 dBm must not be reported as below threshold, or the committee gets handed defects that do not exist.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/criteria.test.ts`
Expected: FAIL — "Cannot find module '../src/services/criteria'"

- [ ] **Step 3: Create `src/services/criteria.ts`**

```ts
export type CriteriaOperator = "gte" | "lte";

export interface CriteriaDef {
  key: string;
  label: string;
  operator: CriteriaOperator;
  threshold: number;
  unit: string;
  torClause: string;
}

export interface MeasurementCheck {
  key: string;
  label: string;
  unit: string;
  torClause: string;
  operator: CriteriaOperator;
  threshold: number;
  /** null = ยังไม่ได้วัด */
  value: number | null;
  /** true = ค่าที่วัดได้ไม่เป็นไปตามเกณฑ์ที่อ้างอิงจาก TOR */
  belowThreshold: boolean;
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * เทียบค่าที่วัดได้กับเกณฑ์ที่อ้างอิงจาก TOR
 * หมายเหตุ: ฟังก์ชันนี้ไม่ตัดสินการตรวจรับ เพียงชี้ว่าค่าใดไม่เป็นไปตามเกณฑ์
 */
export function evaluateMeasurements(
  defs: CriteriaDef[],
  measurements: Record<string, unknown>
): MeasurementCheck[] {
  return defs.map((def) => {
    const value = toNumber(measurements?.[def.key]);
    const belowThreshold =
      value === null ? false : def.operator === "gte" ? value < def.threshold : value > def.threshold;
    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      torClause: def.torClause,
      operator: def.operator,
      threshold: def.threshold,
      value,
      belowThreshold,
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/criteria.test.ts`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/criteria.ts tests/criteria.test.ts
git commit -m "feat: add TOR criteria evaluation service"
```

---

## Task 4: Point status derivation (pure)

**Files:**
- Create: `src/services/pointStatus.ts`
- Create: `tests/pointStatus.test.ts`

**Interfaces:**
- Consumes: `MeasurementCheck` from `src/services/criteria.ts` (Task 3)
- Produces:
  ```ts
  export type PointStatus =
    | "PENDING"            // รอตรวจ
    | "DEFECT"             // มีข้อบกพร่อง
    | "AWAITING_RETEST"    // รอตรวจซ้ำ
    | "EVIDENCE_COMPLETE"  // หลักฐานครบ
    | "UNDER_REVIEW";      // รอตรวจสอบ
  export const REQUIRED_EVIDENCE_KINDS: readonly EvidenceKind[];
  export function derivePointStatus(input: {
    latestInspection: { evidenceKinds: string[]; checks: MeasurementCheck[] } | null;
    defects: { status: string }[];
  }): PointStatus;
  export function evidenceCompleteness(kinds: string[]): { have: number; need: number };
  ```

Status values are ASCII; the Thai labels live in the frontend label map (Task 13).

- [ ] **Step 1: Write the failing test `tests/pointStatus.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { derivePointStatus, evidenceCompleteness, REQUIRED_EVIDENCE_KINDS } from "../src/services/pointStatus";
import { MeasurementCheck } from "../src/services/criteria";

const ok: MeasurementCheck = {
  key: "rssi", label: "RSSI", unit: "dBm", torClause: "4.2",
  operator: "gte", threshold: -67, value: -50, belowThreshold: false,
};
const low: MeasurementCheck = { ...ok, value: -80, belowThreshold: true };
const allKinds = [...REQUIRED_EVIDENCE_KINDS];

describe("derivePointStatus", () => {
  it("is PENDING when the point has never been inspected", () => {
    expect(derivePointStatus({ latestInspection: null, defects: [] })).toBe("PENDING");
  });

  it("is DEFECT when any defect is open", () => {
    const status = derivePointStatus({
      latestInspection: { evidenceKinds: allKinds, checks: [ok] },
      defects: [{ status: "CLOSED" }, { status: "OPEN" }],
    });
    expect(status).toBe("DEFECT");
  });

  it("is AWAITING_RETEST when a defect is fixed but none are open", () => {
    const status = derivePointStatus({
      latestInspection: { evidenceKinds: allKinds, checks: [ok] },
      defects: [{ status: "FIXED" }],
    });
    expect(status).toBe("AWAITING_RETEST");
  });

  it("prefers DEFECT over AWAITING_RETEST when both exist", () => {
    const status = derivePointStatus({
      latestInspection: { evidenceKinds: allKinds, checks: [ok] },
      defects: [{ status: "FIXED" }, { status: "OPEN" }],
    });
    expect(status).toBe("DEFECT");
  });

  it("is EVIDENCE_COMPLETE with all evidence kinds and no value below threshold", () => {
    const status = derivePointStatus({
      latestInspection: { evidenceKinds: allKinds, checks: [ok] },
      defects: [{ status: "CLOSED" }],
    });
    expect(status).toBe("EVIDENCE_COMPLETE");
  });

  it("is UNDER_REVIEW when evidence is incomplete", () => {
    const status = derivePointStatus({
      latestInspection: { evidenceKinds: allKinds.slice(0, 3), checks: [ok] },
      defects: [],
    });
    expect(status).toBe("UNDER_REVIEW");
  });

  it("is UNDER_REVIEW when a measured value is below threshold, even with full evidence", () => {
    const status = derivePointStatus({
      latestInspection: { evidenceKinds: allKinds, checks: [low] },
      defects: [],
    });
    expect(status).toBe("UNDER_REVIEW");
  });

  it("ignores duplicate evidence kinds when counting completeness", () => {
    expect(evidenceCompleteness(["LOCATION", "LOCATION", "LABEL"])).toEqual({ have: 2, need: 6 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/pointStatus.test.ts`
Expected: FAIL — "Cannot find module '../src/services/pointStatus'"

- [ ] **Step 3: Create `src/services/pointStatus.ts`**

```ts
import { MeasurementCheck } from "./criteria";

export type PointStatus =
  | "PENDING"
  | "DEFECT"
  | "AWAITING_RETEST"
  | "EVIDENCE_COMPLETE"
  | "UNDER_REVIEW";

/** หลักฐานขั้นต่ำ 6 ประเภทตามแบบตรวจ */
export const REQUIRED_EVIDENCE_KINDS = [
  "LOCATION",
  "LABEL",
  "CONFIG",
  "FUNCTIONAL",
  "PERFORMANCE",
  "DOCS",
] as const;

export function evidenceCompleteness(kinds: string[]): { have: number; need: number } {
  const present = new Set(kinds.filter((k) => (REQUIRED_EVIDENCE_KINDS as readonly string[]).includes(k)));
  return { have: present.size, need: REQUIRED_EVIDENCE_KINDS.length };
}

/**
 * สถานะของจุดเป็นค่าที่คำนวณจากผลตรวจล่าสุดและข้อบกพร่องที่ยังไม่ปิด
 * ไม่ใช่ค่าที่เก็บไว้ในฐานข้อมูล และไม่ใช่คำวินิจฉัยการตรวจรับ
 */
export function derivePointStatus(input: {
  latestInspection: { evidenceKinds: string[]; checks: MeasurementCheck[] } | null;
  defects: { status: string }[];
}): PointStatus {
  const { latestInspection, defects } = input;
  if (!latestInspection) return "PENDING";
  if (defects.some((d) => d.status === "OPEN")) return "DEFECT";
  if (defects.some((d) => d.status === "FIXED")) return "AWAITING_RETEST";

  const { have, need } = evidenceCompleteness(latestInspection.evidenceKinds);
  const anyBelow = latestInspection.checks.some((c) => c.belowThreshold);
  if (have === need && !anyBelow) return "EVIDENCE_COMPLETE";
  return "UNDER_REVIEW";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/pointStatus.test.ts`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/pointStatus.ts tests/pointStatus.test.ts
git commit -m "feat: derive point status from inspections and defects"
```

---

## Task 5: Authentication and role permissions

**Files:**
- Create: `src/lib/permissions.ts`, `src/middleware/auth.ts`, `src/routes/auth.ts`, `src/routes/index.ts`
- Create: `src/lib/audit.ts`
- Modify: `src/app.ts`
- Create: `tests/auth.test.ts`, `tests/helpers/factory.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `env` (Task 1), `AppError` (Task 1), `ah` (Task 1)
- Produces:
  ```ts
  // src/lib/permissions.ts
  export type Permission =
    | "point:read" | "point:write"
    | "inspection:write"
    | "defect:open" | "defect:close"
    | "plan:write" | "report:export";
  export function hasPermission(role: UserRole, perm: Permission): boolean;

  // src/middleware/auth.ts
  export interface AuthPayload { uid: string; sub: string; role: UserRole; team: string | null }
  export function signToken(p: AuthPayload): string;
  export const requireAuth: RequestHandler;
  export const requirePermission: (perm: Permission) => RequestHandler;
  export function currentUser(req: Request): AuthPayload;   // throws AppError(401) if absent

  // src/lib/audit.ts
  export function writeAudit(actorId: string | null, entity: string, entityId: string, action: string, payload?: unknown): Promise<void>;

  // tests/helpers/factory.ts
  export async function makeUser(role: UserRole, over?: Partial<...>): Promise<User>;
  export async function makeProjectWithPoints(count: number): Promise<{ project, building, points, criteria }>;
  export function authHeader(user: { id: string; username: string; role: UserRole; team: string | null }): string;
  ```

- [ ] **Step 1: Create `src/lib/permissions.ts`**

```ts
import { UserRole } from "@prisma/client";

export type Permission =
  | "point:read"
  | "point:write"
  | "inspection:write"
  | "defect:open"
  | "defect:close"
  | "plan:write"
  | "report:export";

const MATRIX: Record<UserRole, Permission[]> = {
  FIELD: ["point:read", "inspection:write", "defect:open"],
  COMMITTEE: ["point:read", "defect:open", "defect:close", "plan:write", "report:export"],
  ADMIN: [
    "point:read",
    "point:write",
    "inspection:write",
    "defect:open",
    "defect:close",
    "plan:write",
    "report:export",
  ],
};

export function hasPermission(role: UserRole, perm: Permission): boolean {
  return MATRIX[role]?.includes(perm) ?? false;
}
```

`FIELD` deliberately lacks `defect:close` — a technician closing their own non-conformance report defeats the control this system exists to provide.

- [ ] **Step 2: Create `src/middleware/auth.ts`**

```ts
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
```

- [ ] **Step 3: Create `src/lib/audit.ts`**

```ts
import { prisma } from "./prisma";
import { logger } from "../utils/logger";

/** บันทึกร่องรอยการใช้งาน — ห้ามทำให้คำขอหลักล้มเหลวถ้าเขียน audit ไม่ได้ */
export async function writeAudit(
  actorId: string | null,
  entity: string,
  entityId: string,
  action: string,
  payload?: unknown
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { actorId, entity, entityId, action, payload: (payload ?? null) as never },
    });
  } catch (e) {
    logger.error("audit write failed", e);
  }
}
```

- [ ] **Step 4: Create `src/routes/auth.ts`**

```ts
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
```

The same message for unknown user and wrong password — do not leak which usernames exist.

- [ ] **Step 5: Create `src/routes/index.ts`**

```ts
import { Router } from "express";
import { currentUser } from "../middleware/auth";

const router = Router();

router.get("/me", (req, res) => res.json({ user: currentUser(req) }));

export default router;
```

- [ ] **Step 6: Wire the routers into `src/app.ts`**

Replace the health line block in `createApp()` with:

```ts
  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1", requireAuth, apiRouter);
```

and add these imports at the top of `src/app.ts`:

```ts
import apiRouter from "./routes";
import authRouter from "./routes/auth";
import { requireAuth } from "./middleware/auth";
```

- [ ] **Step 7: Create `tests/helpers/factory.ts`**

```ts
import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { testPrisma } from "./db";
import { signToken } from "../../src/middleware/auth";

let seq = 0;

export async function makeUser(role: UserRole, over: Partial<{ username: string; team: string | null; password: string }> = {}) {
  seq += 1;
  const password = over.password ?? "psru1234";
  return testPrisma.user.create({
    data: {
      username: over.username ?? `user${seq}`,
      passwordHash: await bcrypt.hash(password, 10),
      name: `user ${seq}`,
      role,
      team: over.team ?? null,
    },
  });
}

export async function makeProjectWithPoints(count: number) {
  const project = await testPrisma.project.create({
    data: {
      name: "test project",
      contractNo: "C-1",
      torRef: "TOR-1",
      totalPoints: count,
      criteria: {
        create: [
          { key: "rssi", label: "RSSI", operator: "gte", threshold: -67, unit: "dBm", torClause: "4.2" },
          { key: "latencyMs", label: "Latency", operator: "lte", threshold: 30, unit: "ms", torClause: "4.4" },
        ],
      },
      buildings: { create: [{ code: "B01", name: "building one" }] },
    },
    include: { buildings: true, criteria: true },
  });
  const building = project.buildings[0];
  await testPrisma.point.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      code: `AP-${String(i + 1).padStart(4, "0")}`,
      buildingId: building.id,
      floor: "1",
      room: `room ${i + 1}`,
      deviceModel: "model-x",
    })),
  });
  const points = await testPrisma.point.findMany({ orderBy: { code: "asc" } });
  return { project, building, points, criteria: project.criteria };
}

export function authHeader(user: { id: string; username: string; role: UserRole; team: string | null }) {
  return `Bearer ${signToken({ uid: user.id, sub: user.username, role: user.role, team: user.team })}`;
}
```

- [ ] **Step 8: Write the test `tests/auth.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { testPrisma, resetDb } from "./helpers/db";
import { makeUser, authHeader } from "./helpers/factory";
import { hasPermission } from "../src/lib/permissions";

const app = createApp();

describe("auth", () => {
  beforeEach(resetDb);
  afterAll(() => testPrisma.$disconnect());

  it("issues a token for valid credentials", async () => {
    await makeUser("FIELD", { username: "field1", password: "psru1234" });
    const res = await request(app).post("/api/v1/auth/login").send({ username: "field1", password: "psru1234" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe("FIELD");
  });

  it("rejects a wrong password with the same message as an unknown user", async () => {
    await makeUser("FIELD", { username: "field1", password: "psru1234" });
    const wrongPass = await request(app).post("/api/v1/auth/login").send({ username: "field1", password: "nope" });
    const noUser = await request(app).post("/api/v1/auth/login").send({ username: "ghost", password: "nope" });
    expect(wrongPass.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPass.body.error).toBe(noUser.body.error);
  });

  it("rejects an inactive user", async () => {
    const u = await makeUser("FIELD", { username: "gone", password: "psru1234" });
    await testPrisma.user.update({ where: { id: u.id }, data: { active: false } });
    const res = await request(app).post("/api/v1/auth/login").send({ username: "gone", password: "psru1234" });
    expect(res.status).toBe(401);
  });

  it("refuses protected routes without a token", async () => {
    const res = await request(app).get("/api/v1/me");
    expect(res.status).toBe(401);
  });

  it("allows protected routes with a token", async () => {
    const u = await makeUser("COMMITTEE");
    const res = await request(app).get("/api/v1/me").set("authorization", authHeader(u));
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("COMMITTEE");
  });
});

describe("permissions matrix", () => {
  it("does not let field technicians close defects", () => {
    expect(hasPermission("FIELD", "defect:close")).toBe(false);
    expect(hasPermission("COMMITTEE", "defect:close")).toBe(true);
    expect(hasPermission("ADMIN", "defect:close")).toBe(true);
  });

  it("does not let the committee submit inspections", () => {
    expect(hasPermission("COMMITTEE", "inspection:write")).toBe(false);
    expect(hasPermission("FIELD", "inspection:write")).toBe(true);
  });
});
```

- [ ] **Step 9: Run the tests**

Run: `npm test -- tests/auth.test.ts`
Expected: 7 tests PASS

- [ ] **Step 10: Commit**

```bash
git add src/lib src/middleware src/routes src/app.ts tests
git commit -m "feat: add JWT auth and role permission matrix"
```

---

## Task 6: Points API — list, filter, paginate, detail

**Files:**
- Create: `src/services/pointQuery.ts`, `src/routes/points.ts`
- Modify: `src/routes/index.ts`
- Create: `tests/points.test.ts`

**Interfaces:**
- Consumes: `derivePointStatus`, `evidenceCompleteness` (Task 4), `evaluateMeasurements` (Task 3), `prisma` (Task 2), `requirePermission` (Task 5)
- Produces:
  ```ts
  export interface PointListRow {
    id: string; code: string; buildingId: string; buildingName: string; floor: string; room: string;
    deviceModel: string | null; serial: string | null; mac: string | null;
    status: PointStatus; evidenceHave: number; evidenceNeed: number;
    openDefects: number; lastInspectedAt: string | null; lastInspector: string | null;
  }
  export interface PointListResult { rows: PointListRow[]; total: number; page: number; pageSize: number }
  export function listPoints(q: {
    search?: string; buildingId?: string; status?: PointStatus; page?: number; pageSize?: number;
  }): Promise<PointListResult>;
  export function getPointDetail(pointId: string): Promise<...>;   // inferred return type; throws AppError(404)
  ```
  Endpoints: `GET /api/v1/points`, `GET /api/v1/points/:id`, `GET /api/v1/buildings`, `GET /api/v1/criteria`

- [ ] **Step 1: Write the failing test `tests/points.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { testPrisma, resetDb } from "./helpers/db";
import { makeUser, makeProjectWithPoints, authHeader } from "./helpers/factory";

const app = createApp();

describe("points api", () => {
  beforeEach(resetDb);
  afterAll(() => testPrisma.$disconnect());

  it("paginates instead of silently truncating", async () => {
    await makeProjectWithPoints(120);
    const user = await makeUser("COMMITTEE");
    const res = await request(app).get("/api/v1/points?page=1&pageSize=50").set("authorization", authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(50);
    expect(res.body.total).toBe(120);

    const last = await request(app).get("/api/v1/points?page=3&pageSize=50").set("authorization", authHeader(user));
    expect(last.body.rows).toHaveLength(20);
  });

  it("reports PENDING for points never inspected", async () => {
    await makeProjectWithPoints(3);
    const user = await makeUser("COMMITTEE");
    const res = await request(app).get("/api/v1/points").set("authorization", authHeader(user));
    expect(res.body.rows.every((r: { status: string }) => r.status === "PENDING")).toBe(true);
  });

  it("searches by point code and by serial", async () => {
    const { points } = await makeProjectWithPoints(5);
    await testPrisma.point.update({ where: { id: points[2].id }, data: { serial: "SN-ZZZ-9" } });
    const user = await makeUser("COMMITTEE");

    const byCode = await request(app).get("/api/v1/points?search=AP-0002").set("authorization", authHeader(user));
    expect(byCode.body.rows).toHaveLength(1);
    expect(byCode.body.rows[0].code).toBe("AP-0002");

    const bySerial = await request(app).get("/api/v1/points?search=ZZZ").set("authorization", authHeader(user));
    expect(bySerial.body.rows).toHaveLength(1);
    expect(bySerial.body.rows[0].code).toBe("AP-0003");
  });

  it("filters by status", async () => {
    const { points } = await makeProjectWithPoints(3);
    const field = await makeUser("FIELD");
    await testPrisma.inspection.create({
      data: {
        clientUuid: "u-1", pointId: points[0].id, inspectorId: field.id,
        inspectedAt: new Date(), measurements: { rssi: -50 },
      },
    });
    const user = await makeUser("COMMITTEE");
    const res = await request(app).get("/api/v1/points?status=PENDING").set("authorization", authHeader(user));
    expect(res.body.total).toBe(2);
  });

  it("returns full inspection history on the detail endpoint, newest first", async () => {
    const { points } = await makeProjectWithPoints(1);
    const field = await makeUser("FIELD");
    await testPrisma.inspection.create({
      data: { clientUuid: "u-1", pointId: points[0].id, inspectorId: field.id, inspectedAt: new Date("2026-08-01"), measurements: { rssi: -80 } },
    });
    await testPrisma.inspection.create({
      data: { clientUuid: "u-2", pointId: points[0].id, inspectorId: field.id, inspectedAt: new Date("2026-08-05"), measurements: { rssi: -55 } },
    });
    const user = await makeUser("COMMITTEE");
    const res = await request(app).get(`/api/v1/points/${points[0].id}`).set("authorization", authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.inspections).toHaveLength(2);
    expect(res.body.inspections[0].clientUuid).toBe("u-2");
    expect(res.body.inspections[0].checks.find((c: { key: string }) => c.key === "rssi").belowThreshold).toBe(false);
    expect(res.body.inspections[1].checks.find((c: { key: string }) => c.key === "rssi").belowThreshold).toBe(true);
  });

  it("returns 404 in Thai for an unknown point", async () => {
    const user = await makeUser("COMMITTEE");
    const res = await request(app).get("/api/v1/points/does-not-exist").set("authorization", authHeader(user));
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it("exposes the TOR criteria list for offline caching", async () => {
    await makeProjectWithPoints(1);
    const user = await makeUser("FIELD");
    const res = await request(app).get("/api/v1/criteria").set("authorization", authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.criteria.map((c: { key: string }) => c.key)).toEqual(["latencyMs", "rssi"]);
    expect(res.body.criteria[1].threshold).toBe(-67);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/points.test.ts`
Expected: FAIL — all requests 404 because the routes do not exist yet.

- [ ] **Step 3: Create `src/services/pointQuery.ts`**

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { CriteriaDef, evaluateMeasurements, MeasurementCheck } from "./criteria";
import { derivePointStatus, evidenceCompleteness, PointStatus } from "./pointStatus";
import { AppError } from "../middleware/error";

export interface PointListRow {
  id: string;
  code: string;
  buildingId: string;
  buildingName: string;
  floor: string;
  room: string;
  deviceModel: string | null;
  serial: string | null;
  mac: string | null;
  status: PointStatus;
  evidenceHave: number;
  evidenceNeed: number;
  openDefects: number;
  lastInspectedAt: string | null;
  lastInspector: string | null;
}

export interface PointListResult {
  rows: PointListRow[];
  total: number;
  page: number;
  pageSize: number;
}

async function loadCriteria(): Promise<CriteriaDef[]> {
  const rows = await prisma.criteria.findMany({ orderBy: { key: "asc" } });
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    operator: r.operator === "lte" ? "lte" : "gte",
    threshold: r.threshold,
    unit: r.unit,
    torClause: r.torClause,
  }));
}

const pointInclude = {
  building: true,
  defects: { select: { status: true } },
  inspections: {
    orderBy: { inspectedAt: "desc" as const },
    take: 1,
    include: { evidences: { select: { kind: true } }, inspector: { select: { name: true } } },
  },
};

type PointWithRelations = Prisma.PointGetPayload<{ include: typeof pointInclude }>;

function toRow(p: PointWithRelations, defs: CriteriaDef[]): PointListRow {
  const latest = p.inspections[0] ?? null;
  const checks = latest
    ? evaluateMeasurements(defs, (latest.measurements ?? {}) as Record<string, unknown>)
    : [];
  const kinds = latest ? latest.evidences.map((e) => e.kind as string) : [];
  const status = derivePointStatus({
    latestInspection: latest ? { evidenceKinds: kinds, checks } : null,
    defects: p.defects,
  });
  const { have, need } = evidenceCompleteness(kinds);
  return {
    id: p.id,
    code: p.code,
    buildingId: p.buildingId,
    buildingName: p.building.name,
    floor: p.floor,
    room: p.room,
    deviceModel: p.deviceModel,
    serial: p.serial,
    mac: p.mac,
    status,
    evidenceHave: have,
    evidenceNeed: need,
    openDefects: p.defects.filter((d) => d.status === "OPEN").length,
    lastInspectedAt: latest ? latest.inspectedAt.toISOString() : null,
    lastInspector: latest ? latest.inspector.name : null,
  };
}

/**
 * สถานะเป็นค่าที่คำนวณ จึงกรองสถานะในหน่วยความจำหลังดึงข้อมูล
 * ตัวกรองที่เป็นคอลัมน์จริง (ค้นหา/อาคาร) ทำที่ฐานข้อมูลเพื่อลดปริมาณข้อมูล
 */
export async function listPoints(q: {
  search?: string;
  buildingId?: string;
  status?: PointStatus;
  page?: number;
  pageSize?: number;
}): Promise<PointListResult> {
  const page = Math.max(1, q.page ?? 1);
  // ไม่จำกัดเพดานที่ชั้นนี้ เพราะ summary/CSV/PDF เรียกใช้เพื่อดึงทั้งทะเบียน
  // การจำกัดค่าที่ผู้ใช้ส่งเข้ามาทำที่ schema ของ route แทน
  const pageSize = Math.max(1, q.pageSize ?? 50);
  const search = q.search?.trim();

  const where: Prisma.PointWhereInput = {
    ...(q.buildingId ? { buildingId: q.buildingId } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { serial: { contains: search, mode: "insensitive" } },
            { mac: { contains: search, mode: "insensitive" } },
            { room: { contains: search, mode: "insensitive" } },
            { floor: { contains: search, mode: "insensitive" } },
            { building: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const defs = await loadCriteria();
  const found = await prisma.point.findMany({ where, include: pointInclude, orderBy: { code: "asc" } });
  const all = found.map((p) => toRow(p, defs));
  const filtered = q.status ? all.filter((r) => r.status === q.status) : all;

  return {
    rows: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
  };
}

export interface PointDetailInspection {
  id: string;
  clientUuid: string;
  inspectedAt: string;
  inspectorName: string;
  note: string | null;
  serial: string | null;
  mac: string | null;
  checks: MeasurementCheck[];
  evidences: { id: string; kind: string; mime: string; capturedAt: string; url: string }[];
}

export async function getPointDetail(pointId: string) {
  const defs = await loadCriteria();
  const point = await prisma.point.findUnique({
    where: { id: pointId },
    include: {
      building: true,
      defects: { orderBy: { createdAt: "desc" } },
      inspections: {
        orderBy: { inspectedAt: "desc" },
        include: { evidences: true, inspector: { select: { name: true } } },
      },
    },
  });
  if (!point) throw new AppError(404, "ไม่พบจุดติดตั้งที่ร้องขอ");

  const inspections: PointDetailInspection[] = point.inspections.map((i) => ({
    id: i.id,
    clientUuid: i.clientUuid,
    inspectedAt: i.inspectedAt.toISOString(),
    inspectorName: i.inspector.name,
    note: i.note,
    serial: i.serial,
    mac: i.mac,
    checks: evaluateMeasurements(defs, (i.measurements ?? {}) as Record<string, unknown>),
    evidences: i.evidences.map((e) => ({
      id: e.id,
      kind: e.kind,
      mime: e.mime,
      capturedAt: e.capturedAt.toISOString(),
      url: `/api/v1/evidence/${e.id}/file`,
    })),
  }));

  const latest = point.inspections[0] ?? null;
  const status = derivePointStatus({
    latestInspection: latest
      ? { evidenceKinds: latest.evidences.map((e) => e.kind as string), checks: inspections[0].checks }
      : null,
    defects: point.defects,
  });

  return {
    id: point.id,
    code: point.code,
    buildingId: point.buildingId,
    buildingName: point.building.name,
    floor: point.floor,
    room: point.room,
    deviceModel: point.deviceModel,
    serial: point.serial,
    mac: point.mac,
    status,
    criteria: defs,
    inspections,
    defects: point.defects.map((d) => ({
      id: d.id,
      severity: d.severity,
      title: d.title,
      detail: d.detail,
      owner: d.owner,
      dueDate: d.dueDate ? d.dueDate.toISOString() : null,
      status: d.status,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}
```

In-memory status filtering is the right call at 1,000 rows: status depends on the latest inspection and open defects, and pushing that into SQL would mean a correlated subquery per row plus duplicating the rule in two places. Revisit only if the registry grows past roughly 20,000 points.

- [ ] **Step 4: Create `src/routes/points.ts`**

```ts
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ah } from "../utils/asyncHandler";
import { requirePermission } from "../middleware/auth";
import { getPointDetail, listPoints } from "../services/pointQuery";
import { PointStatus } from "../services/pointStatus";

const router = Router();

const listQuery = z.object({
  search: z.string().optional(),
  buildingId: z.string().optional(),
  status: z.enum(["PENDING", "DEFECT", "AWAITING_RETEST", "EVIDENCE_COMPLETE", "UNDER_REVIEW"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});

router.get(
  "/points",
  requirePermission("point:read"),
  ah(async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json(await listPoints({ ...q, status: q.status as PointStatus | undefined }));
  })
);

router.get(
  "/points/:id",
  requirePermission("point:read"),
  ah(async (req, res) => {
    res.json(await getPointDetail(req.params.id));
  })
);

router.get(
  "/buildings",
  requirePermission("point:read"),
  ah(async (_req, res) => {
    const buildings = await prisma.building.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    });
    res.json({ buildings });
  })
);

/** เกณฑ์ TOR ทั้งชุด — หน้ามือถือต้องแคชไว้เพื่อแสดงเกณฑ์กำกับช่องกรอกตอนออฟไลน์ */
router.get(
  "/criteria",
  requirePermission("point:read"),
  ah(async (_req, res) => {
    const criteria = await prisma.criteria.findMany({
      orderBy: { key: "asc" },
      select: { key: true, label: true, operator: true, threshold: true, unit: true, torClause: true },
    });
    res.json({ criteria });
  })
);

export default router;
```

- [ ] **Step 5: Mount the router in `src/routes/index.ts`**

```ts
import { Router } from "express";
import { currentUser } from "../middleware/auth";
import pointsRouter from "./points";

const router = Router();

router.get("/me", (req, res) => res.json({ user: currentUser(req) }));
router.use(pointsRouter);

export default router;
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- tests/points.test.ts`
Expected: 6 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/pointQuery.ts src/routes tests/points.test.ts
git commit -m "feat: add points list/detail api with derived status and pagination"
```

---

## Task 7: Inspection submission (idempotent)

**Files:**
- Create: `src/services/inspectionWrite.ts`, `src/routes/inspections.ts`
- Modify: `src/routes/index.ts`
- Create: `tests/inspections.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `currentUser`, `requirePermission`, `writeAudit` (Task 5), `AppError` (Task 1)
- Produces:
  ```ts
  export interface SubmitInspectionInput {
    clientUuid: string; pointCode: string; inspectedAt: string;
    measurements: Record<string, number | string | null>;
    note?: string; serial?: string; mac?: string; planId?: string;
    defect?: { severity: "URGENT" | "MAJOR" | "MINOR"; title: string; detail: string; owner?: string; dueDate?: string };
  }
  export interface SubmitInspectionResult {
    inspectionId: string; created: boolean; warnings: string[];
  }
  export function submitInspection(input: SubmitInspectionInput, actor: { uid: string }): Promise<SubmitInspectionResult>;
  ```
  Endpoint: `POST /api/v1/inspections` (permission `inspection:write`)

- [ ] **Step 1: Write the failing test `tests/inspections.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { testPrisma, resetDb } from "./helpers/db";
import { makeUser, makeProjectWithPoints, authHeader } from "./helpers/factory";

const app = createApp();

function body(over: Record<string, unknown> = {}) {
  return {
    clientUuid: "11111111-1111-4111-8111-111111111111",
    pointCode: "AP-0001",
    inspectedAt: "2026-08-07T03:00:00.000Z",
    measurements: { rssi: -51, latencyMs: 12 },
    note: "ตรวจปกติ",
    serial: "SN-PSRU-0001",
    mac: "AA:BB:CC:DD:EE:01",
    ...over,
  };
}

describe("inspection submission", () => {
  beforeEach(resetDb);
  afterAll(() => testPrisma.$disconnect());

  it("creates one inspection", async () => {
    await makeProjectWithPoints(2);
    const field = await makeUser("FIELD");
    const res = await request(app).post("/api/v1/inspections").set("authorization", authHeader(field)).send(body());
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(await testPrisma.inspection.count()).toBe(1);
  });

  it("is idempotent: the same clientUuid three times yields one row", async () => {
    await makeProjectWithPoints(2);
    const field = await makeUser("FIELD");
    const send = () => request(app).post("/api/v1/inspections").set("authorization", authHeader(field)).send(body());

    const first = await send();
    const second = await send();
    const third = await send();

    expect(first.body.created).toBe(true);
    expect(second.body.created).toBe(false);
    expect(third.body.created).toBe(false);
    expect(second.body.inspectionId).toBe(first.body.inspectionId);
    expect(await testPrisma.inspection.count()).toBe(1);
  });

  it("never overwrites an existing inspection's result on replay", async () => {
    await makeProjectWithPoints(2);
    const field = await makeUser("FIELD");
    await request(app).post("/api/v1/inspections").set("authorization", authHeader(field)).send(body());
    await request(app)
      .post("/api/v1/inspections")
      .set("authorization", authHeader(field))
      .send(body({ measurements: { rssi: -99 }, note: "แก้ทีหลัง" }));

    const row = await testPrisma.inspection.findUniqueOrThrow({ where: { clientUuid: body().clientUuid } });
    expect((row.measurements as { rssi: number }).rssi).toBe(-51);
    expect(row.note).toBe("ตรวจปกติ");
  });

  it("re-inspecting the same point appends a new row", async () => {
    await makeProjectWithPoints(2);
    const field = await makeUser("FIELD");
    await request(app).post("/api/v1/inspections").set("authorization", authHeader(field)).send(body());
    await request(app)
      .post("/api/v1/inspections")
      .set("authorization", authHeader(field))
      .send(body({ clientUuid: "22222222-2222-4222-8222-222222222222" }));
    expect(await testPrisma.inspection.count()).toBe(2);
  });

  it("opens a defect when one is supplied", async () => {
    await makeProjectWithPoints(2);
    const field = await makeUser("FIELD");
    const res = await request(app)
      .post("/api/v1/inspections")
      .set("authorization", authHeader(field))
      .send(body({ defect: { severity: "URGENT", title: "จุดไม่ออนไลน์", detail: "ไม่พบสัญญาณ" } }));
    expect(res.status).toBe(201);
    const defect = await testPrisma.defect.findFirstOrThrow();
    expect(defect.status).toBe("OPEN");
    expect(defect.severity).toBe("URGENT");
  });

  it("warns but does not block when a serial is already used by another point", async () => {
    const { points } = await makeProjectWithPoints(2);
    await testPrisma.point.update({ where: { id: points[1].id }, data: { serial: "SN-PSRU-0001" } });
    const field = await makeUser("FIELD");
    const res = await request(app).post("/api/v1/inspections").set("authorization", authHeader(field)).send(body());
    expect(res.status).toBe(201);
    expect(res.body.warnings.length).toBeGreaterThan(0);
  });

  it("rejects an unknown point code with 404", async () => {
    await makeProjectWithPoints(1);
    const field = await makeUser("FIELD");
    const res = await request(app)
      .post("/api/v1/inspections")
      .set("authorization", authHeader(field))
      .send(body({ pointCode: "AP-9999" }));
    expect(res.status).toBe(404);
  });

  it("refuses submissions from the committee role", async () => {
    await makeProjectWithPoints(1);
    const committee = await makeUser("COMMITTEE");
    const res = await request(app).post("/api/v1/inspections").set("authorization", authHeader(committee)).send(body());
    expect(res.status).toBe(403);
  });

  it("survives two concurrent submissions of the same clientUuid without a 500", async () => {
    await makeProjectWithPoints(2);
    const field = await makeUser("FIELD");
    const send = () => request(app).post("/api/v1/inspections").set("authorization", authHeader(field)).send(body());

    const [a, b] = await Promise.all([send(), send()]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.inspectionId).toBe(b.body.inspectionId);
    expect([a.body.created, b.body.created].sort()).toEqual([false, true]);
    expect(await testPrisma.inspection.count()).toBe(1);
  });

  it("marks the point done only on the plan the technician is working from", async () => {
    const { points } = await makeProjectWithPoints(2);
    const field = await makeUser("FIELD");

    const today = await testPrisma.plan.create({
      data: {
        date: new Date("2026-08-07T00:00:00.000Z"), team: "ทีม A", gates: {},
        items: { create: [{ pointId: points[0].id, order: 0 }] },
      },
      include: { items: true },
    });
    const retestLater = await testPrisma.plan.create({
      data: {
        date: new Date("2026-08-10T00:00:00.000Z"), team: "ทีม B", gates: {},
        items: { create: [{ pointId: points[0].id, order: 0 }] },
      },
      include: { items: true },
    });

    await request(app)
      .post("/api/v1/inspections")
      .set("authorization", authHeader(field))
      .send(body({ planId: today.id }));

    expect((await testPrisma.planItem.findUniqueOrThrow({ where: { id: today.items[0].id } })).doneAt).not.toBeNull();
    expect((await testPrisma.planItem.findUniqueOrThrow({ where: { id: retestLater.items[0].id } })).doneAt).toBeNull();
  });

  it("falls back to the plan dated the same day when no planId is sent", async () => {
    const { points } = await makeProjectWithPoints(2);
    const field = await makeUser("FIELD");

    const sameDay = await testPrisma.plan.create({
      data: {
        date: new Date("2026-08-07T00:00:00.000Z"), team: "ทีม A", gates: {},
        items: { create: [{ pointId: points[0].id, order: 0 }] },
      },
      include: { items: true },
    });
    const otherDay = await testPrisma.plan.create({
      data: {
        date: new Date("2026-08-10T00:00:00.000Z"), team: "ทีม B", gates: {},
        items: { create: [{ pointId: points[0].id, order: 0 }] },
      },
      include: { items: true },
    });

    await request(app).post("/api/v1/inspections").set("authorization", authHeader(field)).send(body());

    expect((await testPrisma.planItem.findUniqueOrThrow({ where: { id: sameDay.items[0].id } })).doneAt).not.toBeNull();
    expect((await testPrisma.planItem.findUniqueOrThrow({ where: { id: otherDay.items[0].id } })).doneAt).toBeNull();
  });
});
```

The replay test is the load-bearing one: a phone retrying a queued submission must not be able to rewrite a result that is already on the server.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/inspections.test.ts`
Expected: FAIL — 404 on every POST, route missing.

- [ ] **Step 3: Create `src/services/inspectionWrite.ts`**

```ts
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/error";
import { writeAudit } from "../lib/audit";

export interface SubmitInspectionInput {
  clientUuid: string;
  pointCode: string;
  inspectedAt: string;
  measurements: Record<string, number | string | null>;
  note?: string;
  serial?: string;
  mac?: string;
  /** แผนที่ช่างกำลังเดินตามอยู่ ใช้จำกัดขอบเขตการติ๊กจุดว่าตรวจแล้ว */
  planId?: string;
  defect?: {
    severity: "URGENT" | "MAJOR" | "MINOR";
    title: string;
    detail: string;
    owner?: string;
    dueDate?: string;
  };
}

export interface SubmitInspectionResult {
  inspectionId: string;
  created: boolean;
  warnings: string[];
}

/** ชนกันที่ unique constraint ของ clientUuid หรือไม่ */
function isDuplicateClientUuid(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e?.code !== "P2002") return false;
  const target = e.meta?.target;
  return Array.isArray(target)
    ? target.includes("clientUuid")
    : String(target ?? "").includes("clientUuid");
}

/** เที่ยงคืน UTC ของวันที่ตรวจ ให้ตรงกับคอลัมน์ Plan.date ที่เป็น @db.Date */
function planDateOf(inspectedAt: string): Date {
  return new Date(`${new Date(inspectedAt).toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/**
 * บันทึกผลตรวจแบบเพิ่มอย่างเดียวและทำซ้ำได้ (idempotent)
 * ถ้า clientUuid นี้เคยบันทึกแล้ว จะคืนผลเดิมโดยไม่แก้ข้อมูล
 */
export async function submitInspection(
  input: SubmitInspectionInput,
  actor: { uid: string }
): Promise<SubmitInspectionResult> {
  const existing = await prisma.inspection.findUnique({ where: { clientUuid: input.clientUuid } });
  if (existing) {
    return { inspectionId: existing.id, created: false, warnings: [] };
  }

  const point = await prisma.point.findUnique({ where: { code: input.pointCode } });
  if (!point) throw new AppError(404, `ไม่พบจุดติดตั้งรหัส ${input.pointCode}`);

  const warnings: string[] = [];
  if (input.serial) {
    const clash = await prisma.point.findFirst({
      where: { serial: input.serial, id: { not: point.id } },
      select: { code: true },
    });
    if (clash) warnings.push(`หมายเลข Serial นี้ถูกบันทึกไว้ที่จุด ${clash.code} แล้ว กรุณาตรวจสอบ`);
  }

  const runWrite = () => prisma.$transaction(async (tx) => {
    const inspection = await tx.inspection.create({
      data: {
        clientUuid: input.clientUuid,
        pointId: point.id,
        inspectorId: actor.uid,
        inspectedAt: new Date(input.inspectedAt),
        measurements: input.measurements as never,
        note: input.note ?? null,
        serial: input.serial ?? null,
        mac: input.mac ?? null,
      },
    });

    if (input.serial || input.mac) {
      await tx.point.update({
        where: { id: point.id },
        data: {
          ...(input.serial ? { serial: input.serial } : {}),
          ...(input.mac ? { mac: input.mac } : {}),
        },
      });
    }

    if (input.defect) {
      await tx.defect.create({
        data: {
          pointId: point.id,
          inspectionId: inspection.id,
          severity: input.defect.severity,
          title: input.defect.title,
          detail: input.defect.detail,
          owner: input.defect.owner ?? null,
          dueDate: input.defect.dueDate ? new Date(input.defect.dueDate) : null,
        },
      });
    }

    // จำกัดขอบเขตไว้ที่แผนที่ช่างกำลังเดินตาม ไม่งั้นจะไปติ๊กแผนตรวจซ้ำของวันอื่นให้เสร็จตามไปด้วย
    await tx.planItem.updateMany({
      where: {
        pointId: point.id,
        doneAt: null,
        ...(input.planId ? { planId: input.planId } : { plan: { date: planDateOf(input.inspectedAt) } }),
      },
      data: { doneAt: new Date() },
    });

    return inspection.id;
  });

  let inspectionId: string;
  try {
    inspectionId = await runWrite();
  } catch (err) {
    // สองคำขอที่มี clientUuid เดียวกันวิ่งชนกัน — ผู้แพ้อ่านแถวที่อีกฝั่ง commit ไปแล้ว
    // ห้ามปล่อยเป็น 500 เพราะมือถือจะเข้าใจว่าส่งไม่สำเร็จทั้งที่ข้อมูลถึงเซิร์ฟเวอร์แล้ว
    if (isDuplicateClientUuid(err)) {
      const raced = await prisma.inspection.findUnique({ where: { clientUuid: input.clientUuid } });
      if (raced) return { inspectionId: raced.id, created: false, warnings };
    }
    throw err;
  }

  await writeAudit(actor.uid, "Inspection", inspectionId, "create", { pointCode: point.code });
  return { inspectionId, created: true, warnings };
}
```

Three mechanisms, in order. The `findUnique` short-circuit handles the ordinary replay. If two retries land concurrently and both pass that check, the unique constraint on `clientUuid` rejects the loser — the constraint, not the check, is what actually guarantees correctness. The `P2002` catch then converts that rejection into the same `created: false` response the short-circuit would have produced, because a bare 500 would tell a phone its work was lost when it was in fact saved.

- [ ] **Step 4: Create `src/routes/inspections.ts`**

```ts
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
```

Status is 201 on both create and replay: from the phone's point of view the record exists either way, and a distinct status for replay would only invite the client to treat a successful sync as an error.

- [ ] **Step 5: Mount the router in `src/routes/index.ts`**

Add the import and `router.use(inspectionsRouter);` below the points router:

```ts
import inspectionsRouter from "./inspections";
// ...
router.use(inspectionsRouter);
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- tests/inspections.test.ts`
Expected: 8 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/inspectionWrite.ts src/routes tests/inspections.test.ts
git commit -m "feat: add idempotent append-only inspection submission"
```

---

## Task 8: Evidence upload and authenticated file serving

**Files:**
- Create: `src/middleware/upload.ts`, `src/routes/evidence.ts`
- Modify: `src/routes/index.ts`
- Create: `tests/evidence.test.ts`, `tests/fixtures/sample.jpg`

**Interfaces:**
- Consumes: `prisma`, `env`, `currentUser`, `requirePermission`, `AppError`
- Produces:
  - `POST /api/v1/inspections/:inspectionId/evidence` — multipart, field `file`, body field `kind`, `capturedAt`
  - `GET /api/v1/evidence/:id/file` — streams the file, requires `point:read`
  - `export const uploadEvidence: RequestHandler` (multer single-file middleware)

- [ ] **Step 1: Create `src/middleware/upload.ts`**

```ts
import fs from "fs";
import path from "path";
import multer from "multer";
import { env } from "../config/env";
import { AppError } from "./error";

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
      // ต้องใช้เส้นทาง "ข้ามไฟล์" ของ multer ไม่ใช่โยน error ที่นี่:
      // เส้นทาง error ของ multer ไม่ระบายสตรีมของไฟล์ที่ปฏิเสธ ทำให้การเชื่อมต่อถูกตัด (ECONNRESET)
      // ก่อนที่ client จะส่ง body จบ แล้ว 415 จะไปไม่ถึงเครื่องปลายทาง
      (req as unknown as { fileRejected?: boolean }).fileRejected = true;
      return cb(null, false);
    }
    cb(null, true);
  },
}).single("file");
```

- [ ] **Step 2: Create `src/routes/evidence.ts`**

```ts
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
    // ลำดับสำคัญ: ไฟล์ผิดชนิดกับไม่ได้แนบไฟล์เลย ต้องแยกจากกันให้ได้
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
```

Only the basename goes in `filePath`, and reads join it back onto the configured upload directory — a stored path can never escape it.

- [ ] **Step 3: Mount the router in `src/routes/index.ts`**

```ts
import evidenceRouter from "./evidence";
// ...
router.use(evidenceRouter);
```

- [ ] **Step 4: Create the fixture `tests/fixtures/sample.jpg`**

```bash
node -e "const fs=require('fs');fs.mkdirSync('tests/fixtures',{recursive:true});fs.writeFileSync('tests/fixtures/sample.jpg',Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb0043008080808080808080808080808080808080808080808080808080808080808080808080808080808080808080808080ffc0000b080001000101011100ffc40014000100000000000000000000000000000009ffda0008010100003f00d2cf20ffd9','hex'))"
```

Expected: no output. Verify with `ls -l tests/fixtures/sample.jpg` — a small file, roughly 130 bytes.

- [ ] **Step 5: Write the test `tests/evidence.test.ts`**

```ts
import fs from "fs";
import path from "path";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { testPrisma, resetDb } from "./helpers/db";
import { makeUser, makeProjectWithPoints, authHeader } from "./helpers/factory";

const app = createApp();
const fixture = path.join(__dirname, "fixtures", "sample.jpg");

async function makeInspection() {
  const { points } = await makeProjectWithPoints(1);
  const field = await makeUser("FIELD");
  const inspection = await testPrisma.inspection.create({
    data: {
      clientUuid: "33333333-3333-4333-8333-333333333333",
      pointId: points[0].id,
      inspectorId: field.id,
      inspectedAt: new Date(),
      measurements: { rssi: -50 },
    },
  });
  return { inspection, field };
}

describe("evidence", () => {
  beforeEach(resetDb);
  afterAll(() => testPrisma.$disconnect());

  it("stores a file with its sha256", async () => {
    const { inspection, field } = await makeInspection();
    const res = await request(app)
      .post(`/api/v1/inspections/${inspection.id}/evidence`)
      .set("authorization", authHeader(field))
      .field("kind", "LOCATION")
      .attach("file", fixture);

    expect(res.status).toBe(201);
    expect(res.body.sha256).toMatch(/^[a-f0-9]{64}$/);

    const row = await testPrisma.evidence.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.filePath).not.toContain("/");
    expect(row.filePath).not.toContain("\\");
    expect(fs.existsSync(path.join(path.resolve(process.env.UPLOAD_DIR ?? "uploads"), row.filePath))).toBe(true);
  });

  it("rejects a disallowed file type", async () => {
    const { inspection, field } = await makeInspection();
    const txt = path.join(__dirname, "fixtures", "note.txt");
    fs.writeFileSync(txt, "hello");
    const res = await request(app)
      .post(`/api/v1/inspections/${inspection.id}/evidence`)
      .set("authorization", authHeader(field))
      .field("kind", "LOCATION")
      .attach("file", txt);
    expect(res.status).toBe(415);
  });

  it("refuses to serve a file without a token", async () => {
    const { inspection, field } = await makeInspection();
    const up = await request(app)
      .post(`/api/v1/inspections/${inspection.id}/evidence`)
      .set("authorization", authHeader(field))
      .field("kind", "LABEL")
      .attach("file", fixture);
    const res = await request(app).get(`/api/v1/evidence/${up.body.id}/file`);
    expect(res.status).toBe(401);
  });

  it("serves the file to an authenticated reader", async () => {
    const { inspection, field } = await makeInspection();
    const up = await request(app)
      .post(`/api/v1/inspections/${inspection.id}/evidence`)
      .set("authorization", authHeader(field))
      .field("kind", "LABEL")
      .attach("file", fixture);
    const committee = await makeUser("COMMITTEE");
    const res = await request(app)
      .get(`/api/v1/evidence/${up.body.id}/file`)
      .set("authorization", authHeader(committee));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- tests/evidence.test.ts`
Expected: 4 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/middleware/upload.ts src/routes/evidence.ts src/routes/index.ts tests
git commit -m "feat: add evidence upload with sha256 and authenticated serving"
```

---

## Task 9: Defects API with a closure rule

**Files:**
- Create: `src/routes/defects.ts`
- Modify: `src/routes/index.ts`
- Create: `tests/defects.test.ts`

**Interfaces:**
- Consumes: `prisma`, `requirePermission`, `currentUser`, `writeAudit`, `AppError`
- Produces:
  - `GET /api/v1/defects?status=&severity=` → `{ defects: DefectRow[] }` grouped-ready, newest first
  - `POST /api/v1/defects` (permission `defect:open`)
  - `POST /api/v1/defects/:id/fix` (permission `defect:open`) — marks `FIXED`
  - `POST /api/v1/defects/:id/close` (permission `defect:close`) — requires `closingInspectionId` whose inspection is on the same point **and has at least one evidence file**

- [ ] **Step 1: Write the failing test `tests/defects.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { testPrisma, resetDb } from "./helpers/db";
import { makeUser, makeProjectWithPoints, authHeader } from "./helpers/factory";

const app = createApp();

async function setup() {
  const { points } = await makeProjectWithPoints(2);
  const field = await makeUser("FIELD");
  const committee = await makeUser("COMMITTEE");
  const inspection = await testPrisma.inspection.create({
    data: {
      clientUuid: "44444444-4444-4444-8444-444444444444",
      pointId: points[0].id, inspectorId: field.id,
      inspectedAt: new Date(), measurements: { rssi: -85 },
    },
  });
  const defect = await testPrisma.defect.create({
    data: {
      pointId: points[0].id, inspectionId: inspection.id,
      severity: "URGENT", title: "จุดไม่ออนไลน์", detail: "ไม่พบสัญญาณ",
    },
  });
  return { points, field, committee, inspection, defect };
}

async function retestWithEvidence(pointId: string, fieldId: string, uuid: string) {
  const retest = await testPrisma.inspection.create({
    // เผื่อเวลาไว้ 1 วินาที ให้แน่ใจว่าอยู่หลังเวลาที่เปิดข้อบกพร่อง ไม่ใช่มิลลิวินาทีเดียวกัน
    data: {
      clientUuid: uuid, pointId, inspectorId: fieldId,
      inspectedAt: new Date(Date.now() + 1000), measurements: { rssi: -55 },
    },
  });
  await testPrisma.evidence.create({
    data: {
      inspectionId: retest.id, kind: "PERFORMANCE", filePath: "x.jpg",
      mime: "image/jpeg", size: 10, sha256: "a".repeat(64), capturedAt: new Date(),
    },
  });
  return retest;
}

describe("defects", () => {
  beforeEach(resetDb);
  afterAll(() => testPrisma.$disconnect());

  it("lists defects with point context", async () => {
    const { committee } = await setup();
    const res = await request(app).get("/api/v1/defects").set("authorization", authHeader(committee));
    expect(res.status).toBe(200);
    expect(res.body.defects).toHaveLength(1);
    expect(res.body.defects[0].pointCode).toBe("AP-0001");
  });

  it("filters by status", async () => {
    const { committee } = await setup();
    const res = await request(app).get("/api/v1/defects?status=CLOSED").set("authorization", authHeader(committee));
    expect(res.body.defects).toHaveLength(0);
  });

  it("forbids a field technician from closing a defect", async () => {
    const { defect, field, points } = await setup();
    const retest = await retestWithEvidence(points[0].id, field.id, "55555555-5555-4555-8555-555555555555");
    const res = await request(app)
      .post(`/api/v1/defects/${defect.id}/close`)
      .set("authorization", authHeader(field))
      .send({ closingInspectionId: retest.id });
    expect(res.status).toBe(403);
  });

  it("refuses to close without a closing inspection", async () => {
    const { defect, committee } = await setup();
    const res = await request(app)
      .post(`/api/v1/defects/${defect.id}/close`)
      .set("authorization", authHeader(committee))
      .send({});
    expect(res.status).toBe(400);
  });

  it("refuses to close when the closing inspection has no evidence", async () => {
    const { defect, committee, field, points } = await setup();
    const bare = await testPrisma.inspection.create({
      data: {
        clientUuid: "66666666-6666-4666-8666-666666666666",
        pointId: points[0].id, inspectorId: field.id,
        inspectedAt: new Date(), measurements: { rssi: -55 },
      },
    });
    const res = await request(app)
      .post(`/api/v1/defects/${defect.id}/close`)
      .set("authorization", authHeader(committee))
      .send({ closingInspectionId: bare.id });
    expect(res.status).toBe(400);
  });

  it("refuses a closing inspection that belongs to a different point", async () => {
    const { defect, committee, field, points } = await setup();
    const other = await retestWithEvidence(points[1].id, field.id, "77777777-7777-4777-8777-777777777777");
    const res = await request(app)
      .post(`/api/v1/defects/${defect.id}/close`)
      .set("authorization", authHeader(committee))
      .send({ closingInspectionId: other.id });
    expect(res.status).toBe(400);
  });

  it("closes with a valid retest that carries evidence", async () => {
    const { defect, committee, field, points } = await setup();
    const retest = await retestWithEvidence(points[0].id, field.id, "88888888-8888-4888-8888-888888888888");
    const res = await request(app)
      .post(`/api/v1/defects/${defect.id}/close`)
      .set("authorization", authHeader(committee))
      .send({ closingInspectionId: retest.id });
    expect(res.status).toBe(200);
    const row = await testPrisma.defect.findUniqueOrThrow({ where: { id: defect.id } });
    expect(row.status).toBe("CLOSED");
    expect(row.closingInspectionId).toBe(retest.id);
    expect(row.closedAt).not.toBeNull();
  });

  it("marks a defect fixed and awaiting retest", async () => {
    const { defect, field } = await setup();
    const res = await request(app)
      .post(`/api/v1/defects/${defect.id}/fix`)
      .set("authorization", authHeader(field))
      .send({ note: "เปลี่ยนสาย LAN แล้ว" });
    expect(res.status).toBe(200);
    const row = await testPrisma.defect.findUniqueOrThrow({ where: { id: defect.id } });
    expect(row.status).toBe("FIXED");
  });

  it("refuses to mark an already-fixed defect fixed again", async () => {
    const { defect, field } = await setup();
    const fix = () =>
      request(app)
        .post(`/api/v1/defects/${defect.id}/fix`)
        .set("authorization", authHeader(field))
        .send({ note: "เปลี่ยนสาย LAN แล้ว" });

    await fix();
    const second = await fix();
    expect(second.status).toBe(400);

    const row = await testPrisma.defect.findUniqueOrThrow({ where: { id: defect.id } });
    expect(row.detail.split("การแก้ไข:")).toHaveLength(2);
  });

  it("refuses to close a defect that is already closed", async () => {
    const { defect, committee, field, points } = await setup();
    const first = await retestWithEvidence(points[0].id, field.id, "a1111111-1111-4111-8111-111111111111");
    await request(app)
      .post(`/api/v1/defects/${defect.id}/close`)
      .set("authorization", authHeader(committee))
      .send({ closingInspectionId: first.id });

    const second = await retestWithEvidence(points[0].id, field.id, "a2222222-2222-4222-8222-222222222222");
    const res = await request(app)
      .post(`/api/v1/defects/${defect.id}/close`)
      .set("authorization", authHeader(committee))
      .send({ closingInspectionId: second.id });

    expect(res.status).toBe(400);
    const row = await testPrisma.defect.findUniqueOrThrow({ where: { id: defect.id } });
    expect(row.closingInspectionId).toBe(first.id);
    expect(row.closedById).toBe(committee.id);
    expect(row.closedAt).not.toBeNull();
  });

  it("lets only one of two concurrent close attempts win", async () => {
    const { defect, committee, field, points } = await setup();
    const a = await retestWithEvidence(points[0].id, field.id, "a4444444-4444-4444-8444-444444444444");
    const b = await retestWithEvidence(points[0].id, field.id, "a5555555-5555-4555-8555-555555555555");

    const close = (inspectionId: string) =>
      request(app)
        .post(`/api/v1/defects/${defect.id}/close`)
        .set("authorization", authHeader(committee))
        .send({ closingInspectionId: inspectionId });

    const results = await Promise.all([close(a.id), close(b.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);

    const row = await testPrisma.defect.findUniqueOrThrow({ where: { id: defect.id } });
    expect([a.id, b.id]).toContain(row.closingInspectionId);
  });

  it("refuses a closing inspection recorded before the defect was opened", async () => {
    const { defect, committee, field, points } = await setup();
    const stale = await testPrisma.inspection.create({
      data: {
        clientUuid: "a3333333-3333-4333-8333-333333333333",
        pointId: points[0].id,
        inspectorId: field.id,
        inspectedAt: new Date(defect.createdAt.getTime() - 60_000),
        measurements: { rssi: -55 },
      },
    });
    await testPrisma.evidence.create({
      data: {
        inspectionId: stale.id, kind: "PERFORMANCE", filePath: "old.jpg",
        mime: "image/jpeg", size: 10, sha256: "b".repeat(64), capturedAt: new Date(),
      },
    });

    const res = await request(app)
      .post(`/api/v1/defects/${defect.id}/close`)
      .set("authorization", authHeader(committee))
      .send({ closingInspectionId: stale.id });

    expect(res.status).toBe(400);
    const row = await testPrisma.defect.findUniqueOrThrow({ where: { id: defect.id } });
    expect(row.status).toBe("OPEN");
  });

  it("returns 400 for a closing inspection that does not exist", async () => {
    const { defect, committee } = await setup();
    const res = await request(app)
      .post(`/api/v1/defects/${defect.id}/close`)
      .set("authorization", authHeader(committee))
      .send({ closingInspectionId: "no-such-inspection" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/defects.test.ts`
Expected: FAIL — routes missing.

- [ ] **Step 3: Create `src/routes/defects.ts`**

```ts
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ah } from "../utils/asyncHandler";
import { currentUser, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { writeAudit } from "../lib/audit";

const router = Router();

const listQuery = z.object({
  status: z.enum(["OPEN", "FIXED", "CLOSED"]).optional(),
  severity: z.enum(["URGENT", "MAJOR", "MINOR"]).optional(),
});

router.get(
  "/defects",
  requirePermission("point:read"),
  ah(async (req, res) => {
    const q = listQuery.parse(req.query);
    const defects = await prisma.defect.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.severity ? { severity: q.severity } : {}) },
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      include: { point: { include: { building: true } } },
    });
    res.json({
      defects: defects.map((d) => ({
        id: d.id,
        pointId: d.pointId,
        pointCode: d.point.code,
        buildingName: d.point.building.name,
        floor: d.point.floor,
        room: d.point.room,
        severity: d.severity,
        title: d.title,
        detail: d.detail,
        owner: d.owner,
        dueDate: d.dueDate ? d.dueDate.toISOString() : null,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
        closedAt: d.closedAt ? d.closedAt.toISOString() : null,
      })),
    });
  })
);

const createSchema = z.object({
  pointId: z.string().min(1),
  inspectionId: z.string().min(1),
  severity: z.enum(["URGENT", "MAJOR", "MINOR"]),
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(2000),
  owner: z.string().max(200).optional(),
  dueDate: z.string().datetime().optional(),
});

router.post(
  "/defects",
  requirePermission("defect:open"),
  ah(async (req, res) => {
    const input = createSchema.parse(req.body);
    const defect = await prisma.defect.create({
      data: {
        pointId: input.pointId,
        inspectionId: input.inspectionId,
        severity: input.severity,
        title: input.title,
        detail: input.detail,
        owner: input.owner ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
      },
    });
    await writeAudit(currentUser(req).uid, "Defect", defect.id, "open");
    res.status(201).json({ id: defect.id });
  })
);

router.post(
  "/defects/:id/fix",
  requirePermission("defect:open"),
  ah(async (req, res) => {
    const note = z.object({ note: z.string().max(2000).optional() }).parse(req.body);
    const defect = await prisma.defect.findUnique({ where: { id: req.params.id } });
    if (!defect) throw new AppError(404, "ไม่พบข้อบกพร่องที่ร้องขอ");
    if (defect.status === "CLOSED") throw new AppError(400, "ข้อบกพร่องนี้ปิดแล้ว");
    // กันการกดซ้ำ ไม่งั้นบันทึกการแก้ไขจะถูกต่อท้ายลงในรายละเอียดเรื่อย ๆ ไม่มีที่สิ้นสุด
    if (defect.status === "FIXED")
      throw new AppError(400, "ข้อบกพร่องนี้บันทึกว่าแก้ไขแล้ว อยู่ระหว่างรอตรวจซ้ำ");

    // เงื่อนไขสถานะอยู่ใน where ของ updateMany ไม่ใช่แค่ if ข้างบน
    // เพื่อให้สองคำขอที่วิ่งพร้อมกันมีผู้ชนะเพียงรายเดียว
    const fixed = await prisma.defect.updateMany({
      where: { id: defect.id, status: "OPEN" },
      data: { status: "FIXED", detail: note.note ? `${defect.detail}\n\nการแก้ไข: ${note.note}` : defect.detail },
    });
    if (fixed.count === 0) throw new AppError(400, "ข้อบกพร่องนี้ถูกอัปเดตสถานะไปแล้ว");

    await writeAudit(currentUser(req).uid, "Defect", defect.id, "fix");
    res.json({ ok: true });
  })
);

const closeSchema = z.object({ closingInspectionId: z.string().min(1) });

router.post(
  "/defects/:id/close",
  requirePermission("defect:close"),
  ah(async (req, res) => {
    const parsed = closeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "การปิดข้อบกพร่องต้องอ้างอิงผลตรวจซ้ำที่มีหลักฐานแนบ");
    }
    const defect = await prisma.defect.findUnique({ where: { id: req.params.id } });
    if (!defect) throw new AppError(404, "ไม่พบข้อบกพร่องที่ร้องขอ");
    // ปิดซ้ำจะเขียนทับว่าใครปิดและปิดเมื่อไร ซึ่งทำลายร่องรอยการตรวจรับ
    if (defect.status === "CLOSED")
      throw new AppError(400, "ข้อบกพร่องนี้ปิดไปแล้ว ไม่สามารถปิดซ้ำได้");

    const retest = await prisma.inspection.findUnique({
      where: { id: parsed.data.closingInspectionId },
      include: { evidences: { select: { id: true } } },
    });
    if (!retest) throw new AppError(400, "ไม่พบผลตรวจซ้ำที่อ้างอิง");
    if (retest.pointId !== defect.pointId)
      throw new AppError(400, "ผลตรวจซ้ำที่อ้างอิงไม่ได้อยู่ที่จุดติดตั้งเดียวกับข้อบกพร่องนี้");
    if (retest.evidences.length === 0)
      throw new AppError(400, "ผลตรวจซ้ำที่อ้างอิงยังไม่มีหลักฐานแนบ ปิดข้อบกพร่องไม่ได้");
    // หลักฐานที่ถ่ายไว้ก่อนเปิดข้อบกพร่องไม่ใช่หลักฐานการแก้ไข
    if (retest.inspectedAt <= defect.createdAt)
      throw new AppError(400, "ผลตรวจซ้ำที่อ้างอิงเกิดขึ้นก่อนการเปิดข้อบกพร่องนี้ ใช้ปิดไม่ได้");

    const actor = currentUser(req);
    // เงื่อนไข "ยังไม่ปิด" อยู่ใน where ของ updateMany ไม่ใช่แค่ if ข้างบน
    // ไม่งั้นสองคำขอที่วิ่งพร้อมกันจะผ่าน if ทั้งคู่ แล้วรายหลังเขียนทับบันทึกว่าใครปิด
    const closed = await prisma.defect.updateMany({
      where: { id: defect.id, status: { not: "CLOSED" } },
      data: {
        status: "CLOSED",
        closingInspectionId: retest.id,
        closedAt: new Date(),
        closedById: actor.uid,
      },
    });
    if (closed.count === 0) throw new AppError(400, "ข้อบกพร่องนี้ปิดไปแล้ว ไม่สามารถปิดซ้ำได้");

    await writeAudit(actor.uid, "Defect", defect.id, "close", { closingInspectionId: retest.id });
    res.json({ ok: true });
  })
);

export default router;
```

- [ ] **Step 4: Mount the router in `src/routes/index.ts`**

```ts
import defectsRouter from "./defects";
// ...
router.use(defectsRouter);
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- tests/defects.test.ts`
Expected: 8 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes tests/defects.test.ts
git commit -m "feat: add defects api requiring evidence-backed retest to close"
```

---

## Task 10: Inspection plans and gates

**Files:**
- Create: `src/routes/plans.ts`
- Modify: `src/routes/index.ts`
- Create: `tests/plans.test.ts`

**Interfaces:**
- Consumes: `prisma`, `requirePermission`, `currentUser`, `AppError`
- Produces:
  - `GET /api/v1/plans?date=YYYY-MM-DD` → `{ plans: PlanRow[] }` with `done`/`total` counts and `gates`
  - `POST /api/v1/plans` (permission `plan:write`) — body `{ date, team, note?, pointIds[] }`, upserts on `[date, team]`
  - `PATCH /api/v1/plans/:id/gates` (permission `plan:write`) — body `{ gates: { docs, site, test, summary } }`
  - `GET /api/v1/plans/today/mine` — the caller's team plan for today, with full point rows for the mobile screen
  - `export const DEFAULT_GATES = { docs: "PENDING", site: "PENDING", test: "PENDING", summary: "PENDING" }`

- [ ] **Step 1: Write the failing test `tests/plans.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { testPrisma, resetDb } from "./helpers/db";
import { makeUser, makeProjectWithPoints, authHeader } from "./helpers/factory";

const app = createApp();
// วันที่ตามเวลาไทยเหมือนที่เซิร์ฟเวอร์ใช้ ถ้าเขียนเป็น UTC การทดสอบจะเห็นตรงกันเองและกลบบั๊กข้ามวัน
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

describe("plans", () => {
  beforeEach(resetDb);
  afterAll(() => testPrisma.$disconnect());

  it("creates a plan with items and default gates", async () => {
    const { points } = await makeProjectWithPoints(3);
    const committee = await makeUser("COMMITTEE");
    const res = await request(app)
      .post("/api/v1/plans")
      .set("authorization", authHeader(committee))
      .send({ date: TODAY, team: "ทีม A", pointIds: points.map((p) => p.id) });

    expect(res.status).toBe(201);
    const plan = await testPrisma.plan.findFirstOrThrow({ include: { items: true } });
    expect(plan.items).toHaveLength(3);
    expect((plan.gates as Record<string, string>).docs).toBe("PENDING");
  });

  it("replaces the item list when the same date and team is submitted again", async () => {
    const { points } = await makeProjectWithPoints(4);
    const committee = await makeUser("COMMITTEE");
    const send = (ids: string[]) =>
      request(app).post("/api/v1/plans").set("authorization", authHeader(committee))
        .send({ date: TODAY, team: "ทีม A", pointIds: ids });

    await send(points.slice(0, 3).map((p) => p.id));
    await send(points.slice(0, 2).map((p) => p.id));

    expect(await testPrisma.plan.count()).toBe(1);
    expect(await testPrisma.planItem.count()).toBe(2);
  });

  it("forbids a field technician from creating plans", async () => {
    const { points } = await makeProjectWithPoints(1);
    const field = await makeUser("FIELD");
    const res = await request(app)
      .post("/api/v1/plans")
      .set("authorization", authHeader(field))
      .send({ date: TODAY, team: "ทีม A", pointIds: [points[0].id] });
    expect(res.status).toBe(403);
  });

  it("reports progress as done over total", async () => {
    const { points } = await makeProjectWithPoints(3);
    const committee = await makeUser("COMMITTEE");
    await request(app).post("/api/v1/plans").set("authorization", authHeader(committee))
      .send({ date: TODAY, team: "ทีม A", pointIds: points.map((p) => p.id) });

    const item = await testPrisma.planItem.findFirstOrThrow();
    await testPrisma.planItem.update({ where: { id: item.id }, data: { doneAt: new Date() } });

    const res = await request(app).get(`/api/v1/plans?date=${TODAY}`).set("authorization", authHeader(committee));
    expect(res.body.plans[0].done).toBe(1);
    expect(res.body.plans[0].total).toBe(3);
  });

  it("updates gate states", async () => {
    const { points } = await makeProjectWithPoints(1);
    const committee = await makeUser("COMMITTEE");
    const created = await request(app).post("/api/v1/plans").set("authorization", authHeader(committee))
      .send({ date: TODAY, team: "ทีม A", pointIds: [points[0].id] });

    const res = await request(app)
      .patch(`/api/v1/plans/${created.body.id}/gates`)
      .set("authorization", authHeader(committee))
      .send({ gates: { docs: "DONE", site: "ACTIVE", test: "PENDING", summary: "PENDING" } });

    expect(res.status).toBe(200);
    const plan = await testPrisma.plan.findUniqueOrThrow({ where: { id: created.body.id } });
    expect((plan.gates as Record<string, string>).site).toBe("ACTIVE");
  });

  it("gives a field technician only their own team's plan for today", async () => {
    const { points } = await makeProjectWithPoints(4);
    const committee = await makeUser("COMMITTEE");
    await request(app).post("/api/v1/plans").set("authorization", authHeader(committee))
      .send({ date: TODAY, team: "ทีม A", pointIds: [points[0].id, points[1].id] });
    await request(app).post("/api/v1/plans").set("authorization", authHeader(committee))
      .send({ date: TODAY, team: "ทีม B", pointIds: [points[2].id] });

    const field = await makeUser("FIELD", { team: "ทีม A" });
    const res = await request(app).get("/api/v1/plans/today/mine").set("authorization", authHeader(field));
    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(2);
    expect(res.body.points[0].code).toBe("AP-0001");
  });

  it("returns an empty list when the technician has no plan today", async () => {
    await makeProjectWithPoints(1);
    const field = await makeUser("FIELD", { team: "ทีม Z" });
    const res = await request(app).get("/api/v1/plans/today/mine").set("authorization", authHeader(field));
    expect(res.status).toBe(200);
    expect(res.body.points).toEqual([]);
  });

  it("keeps completed work when the plan is revised", async () => {
    const { points } = await makeProjectWithPoints(4);
    const committee = await makeUser("COMMITTEE");
    const save = (ids: string[]) =>
      request(app).post("/api/v1/plans").set("authorization", authHeader(committee))
        .send({ date: TODAY, team: "ทีม A", pointIds: ids });

    await save([points[0].id, points[1].id, points[2].id]);
    const done = await testPrisma.planItem.findFirstOrThrow({ where: { pointId: points[0].id } });
    await testPrisma.planItem.update({ where: { id: done.id }, data: { doneAt: new Date() } });

    // เพิ่มจุดที่ 4 เข้าไปกลางวัน จุดที่ตรวจไปแล้วต้องไม่ถูกรีเซ็ต
    await save([points[0].id, points[1].id, points[2].id, points[3].id]);

    const after = await testPrisma.planItem.findFirstOrThrow({ where: { pointId: points[0].id } });
    expect(after.doneAt).not.toBeNull();
    expect(await testPrisma.planItem.count()).toBe(4);
  });

  it("rejects a point id that is not in the registry with a Thai 400", async () => {
    const { points } = await makeProjectWithPoints(1);
    const committee = await makeUser("COMMITTEE");
    const res = await request(app).post("/api/v1/plans").set("authorization", authHeader(committee))
      .send({ date: TODAY, team: "ทีม A", pointIds: [points[0].id, "no-such-point"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(await testPrisma.plan.count()).toBe(0);
  });

  it("tolerates a duplicated point id instead of failing on the unique constraint", async () => {
    const { points } = await makeProjectWithPoints(2);
    const committee = await makeUser("COMMITTEE");
    const res = await request(app).post("/api/v1/plans").set("authorization", authHeader(committee))
      .send({ date: TODAY, team: "ทีม A", pointIds: [points[0].id, points[0].id, points[1].id] });

    expect(res.status).toBe(201);
    expect(await testPrisma.planItem.count()).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/plans.test.ts`
Expected: FAIL — routes missing.

- [ ] **Step 3: Create `src/routes/plans.ts`**

```ts
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { ah } from "../utils/asyncHandler";
import { currentUser, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/error";

const router = Router();

export const DEFAULT_GATES = { docs: "PENDING", site: "PENDING", test: "PENDING", summary: "PENDING" };

const gateState = z.enum(["PENDING", "ACTIVE", "DONE"]);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ต้องเป็นวันที่รูปแบบ YYYY-MM-DD");

/** เก็บวันที่แผนเป็นเที่ยงคืน UTC เพื่อให้คอลัมน์ @db.Date เทียบตรงกันทุกเครื่อง */
function toPlanDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * วันที่ "วันนี้" ตามเวลาไทย ไม่ใช่ UTC
 * ถ้าใช้ toISOString() ช่างที่เปิดแอปก่อน 07:00 น. จะได้แผนของเมื่อวาน
 * เพราะ UTC ยังไม่ข้ามวัน ซึ่งเป็นช่วงเวลาที่ทีมภาคสนามเริ่มงานพอดี
 */
function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: env.tz }).format(new Date());
}

router.get(
  "/plans",
  requirePermission("point:read"),
  ah(async (req, res) => {
    const q = z.object({ date: dateOnly.optional() }).parse(req.query);
    const plans = await prisma.plan.findMany({
      where: q.date ? { date: toPlanDate(q.date) } : {},
      orderBy: [{ date: "desc" }, { team: "asc" }],
      include: { items: { select: { doneAt: true } } },
    });
    res.json({
      plans: plans.map((p) => ({
        id: p.id,
        date: p.date.toISOString().slice(0, 10),
        team: p.team,
        note: p.note,
        gates: p.gates,
        total: p.items.length,
        done: p.items.filter((i) => i.doneAt !== null).length,
      })),
    });
  })
);

const upsertSchema = z.object({
  date: dateOnly,
  team: z.string().min(1).max(100),
  note: z.string().max(1000).optional(),
  pointIds: z.array(z.string().min(1)).min(1, "ต้องเลือกอย่างน้อย 1 จุด"),
});

router.post(
  "/plans",
  requirePermission("plan:write"),
  ah(async (req, res) => {
    const input = upsertSchema.parse(req.body);
    const date = toPlanDate(input.date);

    const incoming = [...new Set(input.pointIds)];

    const plan = await prisma.$transaction(async (tx) => {
      // ตรวจรหัสจุดก่อนเขียน ไม่งั้น FK violation จะโผล่เป็น 500 ทั้งที่เป็นข้อมูลนำเข้าผิด
      const found = await tx.point.count({ where: { id: { in: incoming } } });
      if (found !== incoming.length)
        throw new AppError(400, "มีรหัสจุดติดตั้งที่ไม่พบในทะเบียน กรุณาตรวจสอบรายการที่เลือก");

      const existing = await tx.plan.findUnique({ where: { date_team: { date, team: input.team } } });
      const saved = existing
        ? await tx.plan.update({
            where: { id: existing.id },
            // แก้ note เฉพาะเมื่อส่งมาจริง ไม่งั้นการแก้รายการจุดจะลบหมายเหตุเดิมทิ้ง
            data: input.note !== undefined ? { note: input.note } : {},
          })
        : await tx.plan.create({
            data: { date, team: input.team, note: input.note ?? null, gates: DEFAULT_GATES },
          });

      // แก้แผนแบบเทียบส่วนต่าง ไม่ใช่ลบทิ้งแล้วสร้างใหม่
      // เพราะ doneAt อยู่บน PlanItem — ลบทิ้งเท่ากับล้างงานที่ช่างตรวจไปแล้วของวันนั้น
      const currentItems = await tx.planItem.findMany({
        where: { planId: saved.id },
        select: { pointId: true },
      });
      const currentIds = new Set(currentItems.map((i) => i.pointId));

      await tx.planItem.deleteMany({ where: { planId: saved.id, pointId: { notIn: incoming } } });
      await tx.planItem.createMany({
        data: incoming
          .filter((pointId) => !currentIds.has(pointId))
          .map((pointId) => ({ planId: saved.id, pointId, order: incoming.indexOf(pointId) })),
      });
      for (const pointId of incoming.filter((id) => currentIds.has(id))) {
        await tx.planItem.update({
          where: { planId_pointId: { planId: saved.id, pointId } },
          data: { order: incoming.indexOf(pointId) },
        });
      }
      return saved;
    });

    res.status(201).json({ id: plan.id });
  })
);

router.patch(
  "/plans/:id/gates",
  requirePermission("plan:write"),
  ah(async (req, res) => {
    const { gates } = z
      .object({
        gates: z.object({ docs: gateState, site: gateState, test: gateState, summary: gateState }),
      })
      .parse(req.body);
    const plan = await prisma.plan.findUnique({ where: { id: req.params.id } });
    if (!plan) throw new AppError(404, "ไม่พบแผนตรวจที่ร้องขอ");
    await prisma.plan.update({ where: { id: plan.id }, data: { gates } });
    res.json({ ok: true });
  })
);

router.get(
  "/plans/today/mine",
  requirePermission("point:read"),
  ah(async (req, res) => {
    const user = currentUser(req);
    if (!user.team) return res.json({ plan: null, points: [] });

    const plan = await prisma.plan.findUnique({
      where: { date_team: { date: toPlanDate(todayStr()), team: user.team } },
      include: {
        items: {
          orderBy: { order: "asc" },
          include: { point: { include: { building: true } } },
        },
      },
    });
    if (!plan) return res.json({ plan: null, points: [] });

    res.json({
      plan: { id: plan.id, date: plan.date.toISOString().slice(0, 10), team: plan.team, gates: plan.gates },
      points: plan.items.map((i) => ({
        id: i.point.id,
        code: i.point.code,
        buildingName: i.point.building.name,
        floor: i.point.floor,
        room: i.point.room,
        deviceModel: i.point.deviceModel,
        serial: i.point.serial,
        mac: i.point.mac,
        doneAt: i.doneAt ? i.doneAt.toISOString() : null,
      })),
    });
  })
);

export default router;
```

- [ ] **Step 4: Mount the router in `src/routes/index.ts`**

```ts
import plansRouter from "./plans";
// ...
router.use(plansRouter);
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- tests/plans.test.ts`
Expected: 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes tests/plans.test.ts
git commit -m "feat: add inspection plans, gates, and per-team today view"
```

---

## Task 11: Summary API, CSV export, and committee PDF

**Files:**
- Create: `src/services/summary.ts`, `src/services/csv.ts`, `src/services/pdf.ts`, `src/routes/reports.ts`
- Create: `public/fonts/Sarabun-Regular.ttf`, `public/fonts/Sarabun-Bold.ttf`
- Modify: `src/routes/index.ts`
- Create: `tests/reports.test.ts`

**Interfaces:**
- Consumes: `listPoints` (Task 6), `prisma`, `requirePermission`
- Produces:
  ```ts
  export interface SummaryResult {
    total: number; inspected: number; pending: number; withDefects: number;
    evidenceComplete: number; awaitingRetest: number;
    byBuilding: { buildingId: string; buildingName: string; total: number; inspected: number; withDefects: number }[];
    defectsBySeverity: { URGENT: number; MAJOR: number; MINOR: number };
  }
  export function buildSummary(): Promise<SummaryResult>;
  export function pointsToCsv(rows: PointListRow[]): string;          // returns text with UTF-8 BOM
  export function buildCommitteePdf(): Promise<Buffer>;
  ```
  Endpoints: `GET /api/v1/summary`, `GET /api/v1/reports/points.csv`, `GET /api/v1/reports/committee.pdf`

- [ ] **Step 1: Obtain the Sarabun fonts**

Sarabun is an SIL Open Font License Thai family from Google Fonts. Download `Sarabun-Regular.ttf` and `Sarabun-Bold.ttf` and place them in `public/fonts/`.

```bash
mkdir -p public/fonts
curl -L -o public/fonts/Sarabun-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/sarabun/Sarabun-Regular.ttf"
curl -L -o public/fonts/Sarabun-Bold.ttf "https://github.com/google/fonts/raw/main/ofl/sarabun/Sarabun-Bold.ttf"
```

Verify both files are over 100 KB — an HTML error page saved as `.ttf` will be a few KB and will fail at PDF build time:

```bash
ls -l public/fonts/
```

- [ ] **Step 2: Create `src/services/summary.ts`**

```ts
import { prisma } from "../lib/prisma";
import { listPoints } from "./pointQuery";

export interface SummaryResult {
  total: number;
  inspected: number;
  pending: number;
  withDefects: number;
  evidenceComplete: number;
  awaitingRetest: number;
  byBuilding: { buildingId: string; buildingName: string; total: number; inspected: number; withDefects: number }[];
  defectsBySeverity: { URGENT: number; MAJOR: number; MINOR: number };
}

export async function buildSummary(): Promise<SummaryResult> {
  const { rows } = await listPoints({ page: 1, pageSize: 100000 });

  const byBuilding = new Map<string, { buildingId: string; buildingName: string; total: number; inspected: number; withDefects: number }>();
  for (const r of rows) {
    const entry =
      byBuilding.get(r.buildingId) ??
      { buildingId: r.buildingId, buildingName: r.buildingName, total: 0, inspected: 0, withDefects: 0 };
    entry.total += 1;
    if (r.status !== "PENDING") entry.inspected += 1;
    if (r.status === "DEFECT") entry.withDefects += 1;
    byBuilding.set(r.buildingId, entry);
  }

  const severities = await prisma.defect.groupBy({
    by: ["severity"],
    where: { status: { not: "CLOSED" } },
    _count: { _all: true },
  });
  const defectsBySeverity = { URGENT: 0, MAJOR: 0, MINOR: 0 };
  for (const s of severities) {
    defectsBySeverity[s.severity as keyof typeof defectsBySeverity] = s._count._all;
  }

  return {
    total: rows.length,
    inspected: rows.filter((r) => r.status !== "PENDING").length,
    pending: rows.filter((r) => r.status === "PENDING").length,
    withDefects: rows.filter((r) => r.status === "DEFECT").length,
    evidenceComplete: rows.filter((r) => r.status === "EVIDENCE_COMPLETE").length,
    awaitingRetest: rows.filter((r) => r.status === "AWAITING_RETEST").length,
    byBuilding: [...byBuilding.values()].sort((a, b) => a.buildingName.localeCompare(b.buildingName, "th")),
    defectsBySeverity,
  };
}
```

- [ ] **Step 3: Create `src/services/csv.ts`**

```ts
import { PointListRow } from "./pointQuery";

const HEADERS = [
  "รหัสจุด", "อาคาร", "ชั้น", "พื้นที่", "รุ่นอุปกรณ์", "Serial", "MAC",
  "สถานะ", "หลักฐาน", "ข้อบกพร่องคงค้าง", "ตรวจล่าสุด", "ผู้ตรวจ",
];

const STATUS_TH: Record<string, string> = {
  PENDING: "รอตรวจ",
  DEFECT: "มีข้อบกพร่อง",
  AWAITING_RETEST: "รอตรวจซ้ำ",
  EVIDENCE_COMPLETE: "หลักฐานครบ",
  UNDER_REVIEW: "รอตรวจสอบ",
};

/** ค่าที่ขึ้นต้นด้วยอักขระเหล่านี้ Excel จะตีความเป็นสูตร */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function cell(v: unknown): string {
  const raw = String(v ?? "");
  // Serial, รุ่นอุปกรณ์ และชื่อผู้ตรวจ กรอกจากหน้างาน จึงต้องกันไม่ให้กลายเป็นสูตร
  // เมื่อกรรมการเปิดไฟล์บนเครื่องของหน่วยงาน
  const safe = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** ขึ้นต้นด้วย BOM เพื่อให้ Excel บน Windows อ่านภาษาไทยถูกต้อง */
export function pointsToCsv(rows: PointListRow[]): string {
  const lines = [
    HEADERS.map(cell).join(","),
    ...rows.map((r) =>
      [
        r.code, r.buildingName, r.floor, r.room, r.deviceModel, r.serial, r.mac,
        STATUS_TH[r.status] ?? r.status,
        `${r.evidenceHave}/${r.evidenceNeed}`,
        r.openDefects,
        r.lastInspectedAt ? new Date(r.lastInspectedAt).toLocaleString("th-TH") : "",
        r.lastInspector,
      ].map(cell).join(",")
    ),
  ];
  return "\ufeff" + lines.join("\r\n");
}
```

- [ ] **Step 4: Create `src/services/pdf.ts`**

```ts
import path from "path";
import PdfPrinter from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { prisma } from "../lib/prisma";
import { buildSummary } from "./summary";
import { listPoints } from "./pointQuery";

const FONT_DIR = path.join(__dirname, "..", "..", "public", "fonts");

const printer = new PdfPrinter({
  Sarabun: {
    normal: path.join(FONT_DIR, "Sarabun-Regular.ttf"),
    bold: path.join(FONT_DIR, "Sarabun-Bold.ttf"),
    italics: path.join(FONT_DIR, "Sarabun-Regular.ttf"),
    bolditalics: path.join(FONT_DIR, "Sarabun-Bold.ttf"),
  },
});

const SEVERITY_TH: Record<string, string> = { URGENT: "เร่งด่วน", MAJOR: "สำคัญ", MINOR: "ทั่วไป" };

export async function buildCommitteePdf(): Promise<Buffer> {
  const project = await prisma.project.findFirst();
  const summary = await buildSummary();
  const { rows } = await listPoints({ page: 1, pageSize: 100000 });
  const defects = await prisma.defect.findMany({
    where: { status: { not: "CLOSED" } },
    orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
    include: { point: { include: { building: true } } },
  });
  const flagged = rows.filter((r) => r.status === "DEFECT" || r.status === "UNDER_REVIEW");

  const doc: TDocumentDefinitions = {
    defaultStyle: { font: "Sarabun", fontSize: 11 },
    pageMargins: [40, 50, 40, 60],
    footer: (page, count) => ({
      columns: [
        { text: "เอกสารประกอบการพิจารณาของคณะกรรมการตรวจรับ ไม่ใช่คำวินิจฉัยของระบบ", fontSize: 8, color: "#666666" },
        { text: `หน้า ${page} / ${count}`, alignment: "right", fontSize: 8, color: "#666666" },
      ],
      margin: [40, 10, 40, 0],
    }),
    content: [
      { text: "รายงานสรุปผลการตรวจรับระบบเครือข่ายไร้สาย", style: "h1" },
      { text: project?.name ?? "-", margin: [0, 0, 0, 2] },
      { text: `เลขที่สัญญา: ${project?.contractNo ?? "-"} · อ้างอิง: ${project?.torRef ?? "-"}`, fontSize: 10, color: "#555555" },
      { text: `วันที่ออกรายงาน: ${new Date().toLocaleDateString("th-TH")}`, fontSize: 10, color: "#555555", margin: [0, 0, 0, 14] },

      {
        table: {
          widths: ["*", "auto"],
          body: [
            [{ text: "รายการ", bold: true }, { text: "จำนวน (จุด)", bold: true, alignment: "right" }],
            ["จุดติดตั้งทั้งหมด", { text: String(summary.total), alignment: "right" }],
            ["ตรวจแล้ว", { text: String(summary.inspected), alignment: "right" }],
            ["ยังไม่ได้ตรวจ", { text: String(summary.pending), alignment: "right" }],
            ["หลักฐานครบตามแบบตรวจ", { text: String(summary.evidenceComplete), alignment: "right" }],
            ["มีข้อบกพร่องคงค้าง", { text: String(summary.withDefects), alignment: "right" }],
            ["รอตรวจซ้ำ", { text: String(summary.awaitingRetest), alignment: "right" }],
          ],
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 16],
      },

      { text: "จุดที่ต้องพิจารณา", style: "h2" },
      flagged.length === 0
        ? { text: "ไม่มีจุดที่ต้องพิจารณาเพิ่มเติม", italics: true, margin: [0, 0, 0, 14] }
        : {
            table: {
              headerRows: 1,
              widths: ["auto", "*", "auto", "auto"],
              body: [
                [
                  { text: "รหัสจุด", bold: true },
                  { text: "สถานที่", bold: true },
                  { text: "หลักฐาน", bold: true },
                  { text: "ข้อบกพร่อง", bold: true },
                ],
                // ไม่ตัดรายการ เอกสารนี้คือฐานการพิจารณาของกรรมการ
                // การซ่อนจุดที่เกินโควตาโดยไม่บอก คือข้อบกพร่องเดียวกับที่ระบบนี้ตั้งใจมาแก้
                ...flagged.map((r) => [
                  r.code,
                  `${r.buildingName} ${r.floor} ${r.room}`,
                  `${r.evidenceHave}/${r.evidenceNeed}`,
                  String(r.openDefects),
                ]),
              ],
            },
            layout: "lightHorizontalLines",
            fontSize: 9,
            margin: [0, 0, 0, 16],
          },

      { text: "ข้อบกพร่องคงค้าง (NCR)", style: "h2" },
      defects.length === 0
        ? { text: "ไม่มีข้อบกพร่องคงค้าง", italics: true, margin: [0, 0, 0, 14] }
        : {
            table: {
              headerRows: 1,
              widths: ["auto", "auto", "*", "auto"],
              body: [
                [
                  { text: "ระดับ", bold: true },
                  { text: "จุด", bold: true },
                  { text: "รายละเอียด", bold: true },
                  { text: "กำหนดเสร็จ", bold: true },
                ],
                ...defects.map((d) => [
                  SEVERITY_TH[d.severity] ?? d.severity,
                  d.point.code,
                  `${d.title} — ${d.detail}`,
                  d.dueDate ? d.dueDate.toLocaleDateString("th-TH") : "-",
                ]),
              ],
            },
            layout: "lightHorizontalLines",
            fontSize: 9,
            margin: [0, 0, 0, 20],
          },

      {
        text: "ข้อมูลในเอกสารนี้เป็นผลบันทึกจากการตรวจภาคสนามเทียบกับเกณฑ์ที่อ้างอิงจาก TOR/สัญญา ระบบไม่ได้วินิจฉัยว่างานผ่านการตรวจรับ การพิจารณาเป็นอำนาจของคณะกรรมการตรวจรับพัสดุ",
        fontSize: 9,
        color: "#7a5c00",
        margin: [0, 0, 0, 24],
      },

      {
        columns: [
          { stack: [{ text: "ลงชื่อ ........................................" }, { text: "(ประธานกรรมการตรวจรับ)", fontSize: 9, margin: [0, 4, 0, 0] }] },
          { stack: [{ text: "ลงชื่อ ........................................" }, { text: "(กรรมการ)", fontSize: 9, margin: [0, 4, 0, 0] }] },
          { stack: [{ text: "ลงชื่อ ........................................" }, { text: "(กรรมการ)", fontSize: 9, margin: [0, 4, 0, 0] }] },
        ],
        columnGap: 16,
      },
    ],
    styles: {
      h1: { fontSize: 18, bold: true, margin: [0, 0, 0, 6] },
      h2: { fontSize: 13, bold: true, margin: [0, 8, 0, 6] },
    },
  };

  const pdf = printer.createPdfKitDocument(doc);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.end();
  });
}
```

- [ ] **Step 5: Create `src/routes/reports.ts`**

```ts
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
```

- [ ] **Step 6: Mount the router in `src/routes/index.ts`**

```ts
import reportsRouter from "./reports";
// ...
router.use(reportsRouter);
```

- [ ] **Step 7: Write the test `tests/reports.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { testPrisma, resetDb } from "./helpers/db";
import { makeUser, makeProjectWithPoints, authHeader } from "./helpers/factory";

const app = createApp();

describe("reports", () => {
  beforeEach(resetDb);
  afterAll(() => testPrisma.$disconnect());

  it("summarises totals and per-building counts", async () => {
    const { points } = await makeProjectWithPoints(5);
    const field = await makeUser("FIELD");
    await testPrisma.inspection.create({
      data: {
        clientUuid: "99999999-9999-4999-8999-999999999999",
        pointId: points[0].id, inspectorId: field.id,
        inspectedAt: new Date(), measurements: { rssi: -50 },
      },
    });
    const committee = await makeUser("COMMITTEE");
    const res = await request(app).get("/api/v1/summary").set("authorization", authHeader(committee));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
    expect(res.body.inspected).toBe(1);
    expect(res.body.pending).toBe(4);
    expect(res.body.byBuilding[0].total).toBe(5);
  });

  it("exports CSV with a BOM and Thai headers", async () => {
    await makeProjectWithPoints(2);
    const committee = await makeUser("COMMITTEE");
    const res = await request(app).get("/api/v1/reports/points.csv").set("authorization", authHeader(committee));
    expect(res.status).toBe(200);
    expect(res.text.startsWith("\ufeff")).toBe(true);
    expect(res.text).toContain("AP-0001");
  });

  it("refuses CSV export for a field technician", async () => {
    await makeProjectWithPoints(1);
    const field = await makeUser("FIELD");
    const res = await request(app).get("/api/v1/reports/points.csv").set("authorization", authHeader(field));
    expect(res.status).toBe(403);
  });

  it("builds a PDF that is a real PDF", async () => {
    await makeProjectWithPoints(2);
    const committee = await makeUser("COMMITTEE");
    const res = await request(app)
      .get("/api/v1/reports/committee.pdf")
      .set("authorization", authHeader(committee))
      .buffer()
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(body.length).toBeGreaterThan(2000);
    // ชื่อฟอนต์อยู่ใน font descriptor แบบไม่บีบอัด ถ้าฟอนต์ไทยไม่ถูกฝัง
    // ข้อความไทยจะกลายเป็นกล่องสี่เหลี่ยมโดยที่ไฟล์ยังเป็น PDF ที่ถูกต้องทุกประการ
    expect(body.includes(Buffer.from("Sarabun"))).toBe(true);
  });

  it("neutralises spreadsheet formulas in exported free-text fields", async () => {
    const { points } = await makeProjectWithPoints(2);
    await testPrisma.point.update({
      where: { id: points[0].id },
      data: { serial: '=CMD|\'/c calc\'!A1', deviceModel: "+1+1" },
    });

    const committee = await makeUser("COMMITTEE");
    const res = await request(app).get("/api/v1/reports/points.csv").set("authorization", authHeader(committee));

    expect(res.status).toBe(200);
    expect(res.text).toContain(`"'=CMD`);
    expect(res.text).toContain(`"'+1+1"`);
    expect(res.text).not.toContain('"=CMD');
  });
});
```

- [ ] **Step 8: Run the tests**

Run: `npm test -- tests/reports.test.ts`
Expected: 4 tests PASS. If the PDF test throws about a font file, re-check Step 1 — the TTFs are missing or truncated.

- [ ] **Step 9: Commit**

```bash
git add src/services/summary.ts src/services/csv.ts src/services/pdf.ts src/routes public/fonts tests/reports.test.ts
git commit -m "feat: add summary api, CSV export, and Thai committee PDF"
```

---

## Task 12: Legacy CSV import script

**Files:**
- Create: `src/scripts/importCsv.ts`
- Create: `tests/importCsv.test.ts`

**Interfaces:**
- Consumes: `prisma`
- Produces:
  ```ts
  export interface ImportResult { pointsCreated: number; pointsUpdated: number; skipped: string[] }
  export function parseLegacyCsv(text: string): LegacyRow[];
  export function importLegacyRows(rows: LegacyRow[], projectId: string): Promise<ImportResult>;
  ```
  CLI: `npm run import:csv -- <path-to-csv>`

The legacy prototype exports these headers: `AP_ID`, `อาคาร`, `ชั้น`, `พื้นที่`, `Serial`, `MAC`, `ผู้ตรวจ`, `วันที่ตรวจ`, `Test_ID`, `หลักฐานครบ_รายการ`, `สถานะ`, `ข้อบกพร่อง`, `หมายเหตุ`, `แก้ไขล่าสุด`.

- [ ] **Step 1: Write the failing test `tests/importCsv.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testPrisma, resetDb } from "./helpers/db";
import { makeProjectWithPoints } from "./helpers/factory";
import { parseLegacyCsv, importLegacyRows } from "../src/scripts/importCsv";

const CSV = [
  '"AP_ID","อาคาร","ชั้น","พื้นที่","Serial","MAC","ผู้ตรวจ","วันที่ตรวจ","Test_ID","หลักฐานครบ_รายการ","สถานะ","ข้อบกพร่อง","หมายเหตุ","แก้ไขล่าสุด"',
  '"AP-0001","อาคาร 1","ชั้น 1","พื้นที่ 01","SN-1","AA:BB","ช่าง ก","2026-08-01","SAT-01","3","รอตรวจสอบ","","",""',
  '"AP-9001","อาคาร 9","ชั้น 2","พื้นที่ 05","SN-9","CC:DD","ช่าง ข","2026-08-02","SAT-02","0","ยังไม่ตรวจ","","",""',
].join("\n");

describe("legacy csv import", () => {
  beforeEach(resetDb);
  afterAll(() => testPrisma.$disconnect());

  it("parses quoted Thai fields", () => {
    const rows = parseLegacyCsv(CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0].apId).toBe("AP-0001");
    expect(rows[0].building).toBe("อาคาร 1");
    expect(rows[0].serial).toBe("SN-1");
  });

  it("handles a UTF-8 BOM and CRLF line endings", () => {
    const rows = parseLegacyCsv("\ufeff" + CSV.replaceAll("\n", "\r\n"));
    expect(rows).toHaveLength(2);
    expect(rows[0].apId).toBe("AP-0001");
  });

  it("handles escaped double quotes inside a field", () => {
    const csv = [
      '"AP_ID","อาคาร","ชั้น","พื้นที่","Serial","MAC","ผู้ตรวจ","วันที่ตรวจ","Test_ID","หลักฐานครบ_รายการ","สถานะ","ข้อบกพร่อง","หมายเหตุ","แก้ไขล่าสุด"',
      '"AP-0001","อาคาร 1","ชั้น 1","พื้นที่ 01","SN-1","AA:BB","ช่าง ก","","","0","ยังไม่ตรวจ","พบปัญหา ""สายหลุด""","",""',
    ].join("\n");
    const rows = parseLegacyCsv(csv);
    expect(rows[0].defect).toBe('พบปัญหา "สายหลุด"');
  });

  it("keeps a row intact when a free-text field contains a line break", async () => {
    const csv = [
      '"AP_ID","อาคาร","ชั้น","พื้นที่","Serial","MAC","ผู้ตรวจ","วันที่ตรวจ","Test_ID","หลักฐานครบ_รายการ","สถานะ","ข้อบกพร่อง","หมายเหตุ","แก้ไขล่าสุด"',
      '"AP-0001","อาคาร 1","ชั้น 1","พื้นที่ 01","SN-1","AA:BB","ช่าง ก","","","0","ยังไม่ตรวจ","บรรทัดแรก\nบรรทัดสอง","หมายเหตุ",""',
      '"AP-0002","อาคาร 1","ชั้น 2","พื้นที่ 02","SN-2","CC:DD","ช่าง ข","","","0","ยังไม่ตรวจ","","",""',
    ].join("\n");

    const rows = parseLegacyCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].defect).toBe("บรรทัดแรก\nบรรทัดสอง");
    expect(rows[0].note).toBe("หมายเหตุ");
    expect(rows[1].apId).toBe("AP-0002");
    expect(rows[1].serial).toBe("SN-2");
  });

  it("matches a building whose legacy name carries stray whitespace", async () => {
    const { project } = await makeProjectWithPoints(1);
    const csv = [
      '"AP_ID","อาคาร","ชั้น","พื้นที่","Serial","MAC","ผู้ตรวจ","วันที่ตรวจ","Test_ID","หลักฐานครบ_รายการ","สถานะ","ข้อบกพร่อง","หมายเหตุ","แก้ไขล่าสุด"',
      '"AP-0002","  building one  ","ชั้น 1","พื้นที่ 02","SN-2","CC:DD","","","","0","","","",""',
    ].join("\n");

    const result = await importLegacyRows(parseLegacyCsv(csv), project.id);
    expect(result.skipped).toEqual([]);
    expect(result.pointsCreated).toBe(1);
  });

  it("updates existing points and reports unknown codes as skipped", async () => {
    const { project } = await makeProjectWithPoints(1);
    const result = await importLegacyRows(parseLegacyCsv(CSV), project.id);
    expect(result.pointsUpdated).toBe(1);
    expect(result.skipped).toEqual(["AP-9001"]);
    const point = await testPrisma.point.findUniqueOrThrow({ where: { code: "AP-0001" } });
    expect(point.serial).toBe("SN-1");
    expect(point.mac).toBe("AA:BB");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/importCsv.test.ts`
Expected: FAIL — "Cannot find module '../src/scripts/importCsv'"

- [ ] **Step 3: Create `src/scripts/importCsv.ts`**

```ts
import fs from "fs";
import { prisma } from "../lib/prisma";

export interface LegacyRow {
  apId: string;
  building: string;
  floor: string;
  room: string;
  serial: string;
  mac: string;
  inspector: string;
  inspectionDate: string;
  testId: string;
  evidenceCount: string;
  status: string;
  defect: string;
  note: string;
  updated: string;
}

export interface ImportResult {
  pointsCreated: number;
  pointsUpdated: number;
  skipped: string[];
}

/**
 * แยกทั้งข้อความเป็นแถวและช่องในรอบเดียว โดยรู้จักเครื่องหมายคำพูด
 * ห้ามตัดบรรทัดก่อนแล้วค่อยแยกช่อง เพราะช่อง "หมายเหตุ" และ "ข้อบกพร่อง"
 * ของต้นแบบเดิมเป็น textarea ช่างจึงขึ้นบรรทัดใหม่ภายในช่องได้
 * ถ้าตัดที่ขึ้นบรรทัดใหม่ก่อน แถวนั้นจะแตกเป็นสองแถวและคอลัมน์เลื่อนทั้งแถวโดยไม่มีสัญญาณเตือน
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

export function parseLegacyCsv(text: string): LegacyRow[] {
  const rows = parseCsv(text.replace(/^\ufeff/, ""));
  return rows.slice(1).map((c) => {
    return {
      apId: c[0] ?? "",
      building: c[1] ?? "",
      floor: c[2] ?? "",
      room: c[3] ?? "",
      serial: c[4] ?? "",
      mac: c[5] ?? "",
      inspector: c[6] ?? "",
      inspectionDate: c[7] ?? "",
      testId: c[8] ?? "",
      evidenceCount: c[9] ?? "",
      status: c[10] ?? "",
      defect: c[11] ?? "",
      note: c[12] ?? "",
      updated: c[13] ?? "",
    };
  });
}

/**
 * นำเข้าเฉพาะข้อมูลทะเบียนจุด (Serial/MAC) เท่านั้น
 * ไม่สร้าง Inspection ย้อนหลัง เพราะข้อมูลเดิมไม่มีหลักฐานแนบและระบุผู้ตรวจเป็นบัญชีจริงไม่ได้
 */
export async function importLegacyRows(rows: LegacyRow[], projectId: string): Promise<ImportResult> {
  const result: ImportResult = { pointsCreated: 0, pointsUpdated: 0, skipped: [] };
  const buildings = await prisma.building.findMany({ where: { projectId } });
  const byName = new Map(buildings.map((b) => [b.name, b]));

  for (const row of rows) {
    const existing = await prisma.point.findUnique({ where: { code: row.apId } });
    if (existing) {
      await prisma.point.update({
        where: { id: existing.id },
        data: {
          ...(row.serial ? { serial: row.serial } : {}),
          ...(row.mac ? { mac: row.mac } : {}),
        },
      });
      result.pointsUpdated += 1;
      continue;
    }
    // ข้อมูลเดิมมักมีช่องว่างหัวท้ายติดมา ถ้าเทียบตรง ๆ อาคารที่มีอยู่จริงจะถูกข้ามทิ้ง
    const building = byName.get(row.building.trim());
    if (!building) {
      result.skipped.push(row.apId);
      continue;
    }
    await prisma.point.create({
      data: {
        code: row.apId,
        buildingId: building.id,
        floor: row.floor,
        room: row.room,
        serial: row.serial || null,
        mac: row.mac || null,
      },
    });
    result.pointsCreated += 1;
  }
  return result;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run import:csv -- <path-to-csv>");
    process.exit(1);
  }
  const project = await prisma.project.findFirst();
  if (!project) {
    console.error("No project found. Run `npm run db:seed` first.");
    process.exit(1);
  }
  const result = await importLegacyRows(parseLegacyCsv(fs.readFileSync(file, "utf8")), project.id);
  console.log(
    `Imported: created=${result.pointsCreated} updated=${result.pointsUpdated} skipped=${result.skipped.length}`
  );
  if (result.skipped.length) console.log("Skipped codes:", result.skipped.join(", "));
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
```

Deliberately importing registry data only: legacy rows carry a free-text inspector name and no evidence files, so fabricating `Inspection` records from them would put unverifiable rows into an audit trail the committee relies on.

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/importCsv.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Run the whole backend suite**

Run: `npm test`
Expected: all suites pass (health, schema, criteria, pointStatus, auth, points, inspections, evidence, defects, plans, reports, importCsv).

- [ ] **Step 6: Commit**

```bash
git add src/scripts tests/importCsv.test.ts
git commit -m "feat: import legacy prototype CSV into the point registry"
```

---
## Task 13: Design tokens, app shell, and login

**Files:**
- Create: `public/index.html`, `public/css/tokens.css`, `public/css/app.css`
- Create: `public/js/core/api.js`, `public/js/core/dom.js`, `public/js/core/format.js`, `public/js/core/labels.js`, `public/js/core/store.js`, `public/js/core/router.js`
- Create: `public/js/app.js`
- Create: `public/fonts/IBMPlexSansThai-Regular.ttf`, `public/fonts/IBMPlexSansThai-SemiBold.ttf`
- Create: `tests/labels.test.ts`

**Interfaces:**
- Consumes: `POST /api/v1/auth/login`, `GET /api/v1/me` (Task 5)
- Produces:
  ```js
  // public/js/core/api.js
  export const SESSION_EXPIRED_EVENT = "psru:session-expired";  // window event; shells listen and show login
  export const api = {
    login(username, password): Promise<{token, user}>,   // 401 here surfaces the server's Thai message, not "session expired"
    logout(): void,
    token(): string | null,
    user(): {id,username,name,role,team} | null,
    get(path): Promise<any>,           // throws Error with .status and Thai .message
    post(path, body): Promise<any>,
    patch(path, body): Promise<any>,
    postForm(path, formData): Promise<any>,
    download(path, filename): Promise<void>,
  };
  // public/js/core/dom.js
  export function h(tag, props, ...children): HTMLElement;
  export function mount(el, node): void;   // replaces children
  export function qs(sel, root=document): HTMLElement | null;
  // public/js/core/format.js
  export function thNumber(n): string;
  export function thDateTime(iso): string;
  export function thDate(iso): string;
  export function pct(part, whole): number;
  export function todayStr(): string;   // YYYY-MM-DD in Asia/Bangkok, matching the server
  // public/js/core/labels.js
  export const POINT_STATUS_TH, POINT_STATUS_CLASS, SEVERITY_TH, SEVERITY_CLASS,
               DEFECT_STATUS_TH, EVIDENCE_TH, EVIDENCE_ORDER,
               GATE_TH, GATE_STATE_TH, GATE_ORDER, ROLE_TH, DISCLAIMER;
  // public/js/core/router.js
  export function startRouter(routes, fallback): void;   // hash-based
  export function navigate(hash): void;
  // public/js/core/store.js
  export const store = { buildings: [], async loadBuildings(force = false) };
  ```

- [ ] **Step 1: Download the UI font**

```bash
curl -L -o public/fonts/IBMPlexSansThai-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/ibmplexsansthai/IBMPlexSansThai-Regular.ttf"
curl -L -o public/fonts/IBMPlexSansThai-SemiBold.ttf "https://github.com/google/fonts/raw/main/ofl/ibmplexsansthai/IBMPlexSansThai-SemiBold.ttf"
ls -l public/fonts/
```

Expected: four font files now (two Sarabun from Task 11, two IBM Plex Sans Thai), each over 100 KB.

- [ ] **Step 2: Create `public/css/tokens.css`**

```css
@font-face {
  font-family: "IBM Plex Sans Thai";
  src: url("../fonts/IBMPlexSansThai-Regular.ttf") format("truetype");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "IBM Plex Sans Thai";
  src: url("../fonts/IBMPlexSansThai-SemiBold.ttf") format("truetype");
  font-weight: 600;
  font-display: swap;
}

:root {
  --sidebar: #0e2e2b;
  --sidebar-active: #17403c;
  --sidebar-text: #c6d8d4;
  --bg: #f5f7f6;
  --surface: #ffffff;
  --line: #e4e9e7;
  --ink: #16302c;
  --muted: #6b7d79;
  --primary: #0e8a6b;
  --primary-dark: #0b7259;
  --accent: #e8b84b;

  --pass-bg: #dff3e9;
  --pass-ink: #12764f;
  --fail-bg: #fce4e4;
  --fail-ink: #b03a3a;
  --warn-bg: #fcf0d8;
  --warn-ink: #8a6100;
  --idle-bg: #eceff0;
  --idle-ink: #5c6b68;
  --notice-bg: #fdf8ec;

  --radius: 14px;
  --shadow: 0 8px 24px rgba(14, 46, 43, 0.07);
  --sidebar-w: 260px;
  --content-max: 1440px;
}
```

- [ ] **Step 3: Create `public/css/app.css`**

```css
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.55 "IBM Plex Sans Thai", system-ui, sans-serif;
}
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
a { color: var(--primary); }

.layout { display: grid; grid-template-columns: var(--sidebar-w) 1fr; min-height: 100vh; }

.sidebar { background: var(--sidebar); color: var(--sidebar-text); padding: 22px 16px; }
.brand { display: flex; gap: 12px; align-items: center; margin-bottom: 28px; }
.brand-mark {
  width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center;
  background: var(--accent); color: var(--sidebar); font-weight: 600; font-size: 20px;
}
.brand-name { color: #fff; font-weight: 600; font-size: 17px; }
.brand-sub { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; opacity: .65; }

.nav { display: grid; gap: 4px; }
.nav a {
  display: flex; align-items: center; gap: 10px; padding: 11px 14px;
  border-radius: 10px; color: var(--sidebar-text); text-decoration: none;
}
.nav a::before {
  content: ""; width: 7px; height: 7px; border-radius: 50%;
  border: 1.5px solid currentColor; opacity: .5;
}
.nav a:hover { background: rgba(255,255,255,.05); }
.nav a.active { background: var(--sidebar-active); color: #fff; }
.nav a.active::before { background: var(--accent); border-color: var(--accent); opacity: 1; }

.side-foot { margin-top: 28px; padding: 14px; border-radius: 12px; background: rgba(255,255,255,.05); font-size: 13px; }
.side-foot b { display: block; color: #fff; }

.content { padding: 26px clamp(18px, 3vw, 40px); max-width: var(--content-max); }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.page-head h1 { margin: 4px 0 0; font-size: 30px; font-weight: 600; }
.page-head .eyebrow { color: var(--muted); font-size: 14px; }

.notice {
  background: var(--notice-bg); border: 1px solid #f0e2bf; border-radius: 12px;
  padding: 14px 18px; margin: 20px 0; font-size: 14px;
}
.notice b { color: #7a5c00; }

.btn {
  border: 0; border-radius: 10px; padding: 11px 18px;
  background: var(--primary); color: #fff; font-weight: 600;
}
.btn:hover { background: var(--primary-dark); }
.btn.secondary { background: var(--surface); color: var(--ink); border: 1px solid #c9d4d1; }
.btn.small { padding: 7px 12px; font-size: 13px; }
.btn:disabled { opacity: .55; cursor: not-allowed; }

.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
.card-pad { padding: 20px; }

.kpis { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 16px; margin: 18px 0; }
.kpi { padding: 20px; }
.kpi-mark { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; color: #fff; font-weight: 600; }
.kpi-mark.a { background: var(--sidebar); }
.kpi-mark.b { background: var(--primary); }
.kpi-mark.c { background: #c9922e; }
.kpi-mark.d { background: #c0504e; }
.kpi-top { display: flex; align-items: center; gap: 12px; }
.kpi-label { color: var(--muted); font-size: 14px; }
.kpi-value { font-size: 38px; font-weight: 600; line-height: 1.1; margin: 10px 0 4px; }
.kpi-note { color: var(--muted); font-size: 13px; }

.bar { height: 6px; border-radius: 999px; background: #e7ecea; overflow: hidden; margin-top: 10px; }
.bar > i { display: block; height: 100%; background: var(--primary); }

.grid-2 { display: grid; grid-template-columns: minmax(0,1.7fr) minmax(0,1fr); gap: 16px; }

table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 13px 16px; border-bottom: 1px solid #eef2f1; }
th { color: var(--muted); font-size: 13px; font-weight: 400; }
tbody tr:hover { background: #fafcfb; }
.table-wrap { overflow-x: auto; }

.chip { display: inline-flex; padding: 4px 11px; border-radius: 999px; font-size: 12.5px; font-weight: 600; }
.chip.pass { background: var(--pass-bg); color: var(--pass-ink); }
.chip.fail { background: var(--fail-bg); color: var(--fail-ink); }
.chip.warn { background: var(--warn-bg); color: var(--warn-ink); }
.chip.idle { background: var(--idle-bg); color: var(--idle-ink); }

.toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.input, .select {
  border: 1px solid #cfd9d6; border-radius: 10px; padding: 10px 12px; background: #fff; min-width: 180px;
}
.linkbtn { border: 0; background: none; color: var(--primary); font-weight: 600; padding: 0; }

.pager { display: flex; gap: 8px; align-items: center; justify-content: flex-end; padding: 14px 16px; }
.pager span { color: var(--muted); font-size: 13px; margin-right: auto; }

.drawer-backdrop {
  position: fixed; inset: 0; background: rgba(16,42,43,.42); display: none; z-index: 40;
}
.drawer-backdrop.open { display: block; }
.drawer {
  position: fixed; top: 0; right: 0; height: 100vh; width: min(620px, 96vw);
  background: var(--surface); box-shadow: -12px 0 40px rgba(0,0,0,.16); overflow-y: auto; z-index: 41;
  transform: translateX(100%); transition: transform .2s ease;
}
.drawer.open { transform: none; }
.drawer-head { position: sticky; top: 0; background: #fff; border-bottom: 1px solid var(--line); padding: 18px 22px; display: flex; justify-content: space-between; align-items: flex-start; }
.drawer-body { padding: 22px; }
.close-x { border: 0; background: #eef2f1; border-radius: 50%; width: 34px; height: 34px; font-size: 18px; }

.evidence-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px,1fr)); gap: 10px; }
.evidence-grid img { width: 100%; height: 92px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); }

.empty { text-align: center; padding: 44px; color: var(--muted); }
.error-banner { background: var(--fail-bg); color: var(--fail-ink); border-radius: 10px; padding: 12px 16px; margin-bottom: 14px; }

.login-wrap { min-height: 100vh; display: grid; place-items: center; background: var(--sidebar); }
.login-card { width: min(400px, 92vw); background: #fff; border-radius: 16px; padding: 30px; }
.login-card h1 { font-size: 21px; margin: 14px 0 4px; }
.login-card .field { display: grid; gap: 6px; margin-bottom: 14px; }
.login-card .input { width: 100%; }

@media (max-width: 1100px) {
  .kpis { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .grid-2 { grid-template-columns: 1fr; }
}
@media (max-width: 820px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { display: none; }
}
```

- [ ] **Step 4: Create `public/js/core/dom.js`**

```js
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function mount(el, node) {
  el.replaceChildren(node);
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}
```

There is deliberately no raw-markup escape hatch: every child goes through `createTextNode`, so Thai free-text notes and defect titles cannot inject markup no matter what a technician types.

- [ ] **Step 5: Create `public/js/core/format.js`**

```js
export function thNumber(n) {
  return Number(n ?? 0).toLocaleString("th-TH");
}

export function thDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

export function thDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("th-TH", { dateStyle: "medium" });
}

export function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

/**
 * วันที่ "วันนี้" ตามเวลาไทย ให้ตรงกับที่เซิร์ฟเวอร์ใช้
 * ห้ามใช้ toISOString() เพราะก่อน 07:00 น. UTC ยังไม่ข้ามวัน
 * หน้าจอจะไปขอแผนของเมื่อวานในช่วงเวลาที่ทีมภาคสนามเริ่มงานพอดี
 */
export function todayStr() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}
```

- [ ] **Step 6: Create `public/js/core/labels.js`**

```js
export const POINT_STATUS_TH = {
  PENDING: "รอตรวจ",
  DEFECT: "มีข้อบกพร่อง",
  AWAITING_RETEST: "รอตรวจซ้ำ",
  EVIDENCE_COMPLETE: "หลักฐานครบ",
  UNDER_REVIEW: "รอตรวจสอบ",
};

export const POINT_STATUS_CLASS = {
  PENDING: "idle",
  DEFECT: "fail",
  AWAITING_RETEST: "warn",
  EVIDENCE_COMPLETE: "pass",
  UNDER_REVIEW: "warn",
};

export const SEVERITY_TH = { URGENT: "เร่งด่วน", MAJOR: "สำคัญ", MINOR: "ทั่วไป" };
export const SEVERITY_CLASS = { URGENT: "fail", MAJOR: "warn", MINOR: "pass" };
export const DEFECT_STATUS_TH = { OPEN: "ยังไม่แก้ไข", FIXED: "แก้ไขแล้ว รอตรวจซ้ำ", CLOSED: "ปิดแล้ว" };

export const EVIDENCE_TH = {
  LOCATION: "ภาพตำแหน่งติดตั้ง",
  LABEL: "ภาพฉลาก / Serial",
  CONFIG: "หลักฐานการตั้งค่า",
  FUNCTIONAL: "ผลทดสอบการใช้งาน",
  PERFORMANCE: "ผลทดสอบประสิทธิภาพ",
  DOCS: "เอกสารส่งมอบ / รับประกัน",
};

export const EVIDENCE_ORDER = ["LOCATION", "LABEL", "CONFIG", "FUNCTIONAL", "PERFORMANCE", "DOCS"];

export const GATE_TH = { docs: "ตรวจเอกสาร", site: "ตรวจหน้างาน", test: "ทดสอบระบบ", summary: "สรุปผล" };
export const GATE_STATE_TH = { PENDING: "รอดำเนินการ", ACTIVE: "กำลังดำเนินการ", DONE: "ครบ" };
export const GATE_ORDER = ["docs", "site", "test", "summary"];

export const ROLE_TH = { FIELD: "ช่างภาคสนาม", COMMITTEE: "กรรมการตรวจรับ", ADMIN: "ผู้ดูแลระบบ" };

export const DISCLAIMER =
  "ระบบไม่ตัดสินผลการตรวจรับแทนคณะกรรมการ ค่าที่แสดงเป็นการเทียบผลที่วัดได้กับเกณฑ์ที่อ้างอิงจาก TOR/สัญญา การตรวจรับเป็นอำนาจของคณะกรรมการตรวจรับพัสดุ";
```

- [ ] **Step 7: Create `public/js/core/api.js`**

```js
const TOKEN_KEY = "psru_wifi_token";
const USER_KEY = "psru_wifi_user";

/** แจ้งให้ชั้นหน้าจอพากลับไปหน้าเข้าสู่ระบบ โดยที่ api.js ไม่ต้องรู้จักหน้าไหนเลย */
export const SESSION_EXPIRED_EVENT = "psru:session-expired";

/**
 * @param {Response} res
 * @param {{ handle401?: boolean }} opts
 *   handle401=false ใช้กับการเข้าสู่ระบบเอง เพราะ 401 ตรงนั้นแปลว่า
 *   "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" ไม่ใช่ "เซสชันหมดอายุ"
 *   ถ้าเหมารวมกัน ช่างที่พิมพ์รหัสผิดจะเห็นข้อความว่าเซสชันหมดอายุ ซึ่งไม่จริงและชวนงง
 */
async function handle(res, { handle401 = true } = {}) {
  if (res.status === 401 && handle401) {
    api.logout();
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    throw Object.assign(new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"), { status: 401 });
  }
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await res.json() : null;
  if (!res.ok) {
    throw Object.assign(new Error(payload?.error || "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ"), { status: res.status });
  }
  return payload;
}

function authHeaders(extra = {}) {
  const token = api.token();
  return token ? { ...extra, authorization: `Bearer ${token}` } : extra;
}

export const api = {
  token: () => localStorage.getItem(TOKEN_KEY),
  user: () => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  },
  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  async login(username, password) {
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await handle(res, { handle401: false });
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    return data;
  },
  async get(path) {
    return handle(await fetch(`/api/v1${path}`, { headers: authHeaders() }));
  },
  async post(path, body) {
    return handle(
      await fetch(`/api/v1${path}`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(body ?? {}),
      })
    );
  },
  async patch(path, body) {
    return handle(
      await fetch(`/api/v1${path}`, {
        method: "PATCH",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(body ?? {}),
      })
    );
  },
  async postForm(path, formData) {
    return handle(await fetch(`/api/v1${path}`, { method: "POST", headers: authHeaders(), body: formData }));
  },
  async download(path, filename) {
    const res = await fetch(`/api/v1${path}`, { headers: authHeaders() });
    if (!res.ok) throw new Error("ดาวน์โหลดไม่สำเร็จ");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
```

- [ ] **Step 8: Create `public/js/core/store.js`**

```js
import { api } from "./api.js";

export const store = {
  buildings: [],
  async loadBuildings(force = false) {
    if (this.buildings.length && !force) return this.buildings;
    const data = await api.get("/buildings");
    this.buildings = data.buildings;
    return this.buildings;
  },
};
```

- [ ] **Step 9: Create `public/js/core/router.js`**

```js
let table = {};
let fallbackRoute = "#/overview";

async function run() {
  const hash = location.hash || fallbackRoute;
  const path = hash.split("?")[0];
  const view = table[path] || table[fallbackRoute];
  document.querySelectorAll(".nav a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === path);
  });
  if (!view) return;
  try {
    await view();
  } catch (err) {
    // ทุกหน้าโหลดข้อมูลผ่าน await ถ้าปล่อยให้ error หลุดไป
    // ผู้ใช้จะค้างอยู่กับข้อความ "กำลังโหลดข้อมูล..." ตลอดไปโดยไม่รู้ว่าเกิดอะไรขึ้น
    // เซสชันหมดอายุ (401) มีทางกลับหน้าเข้าสู่ระบบของตัวเองอยู่แล้ว จึงไม่ต้องแสดงซ้ำ
    if (err?.status === 401) return;
    const view0 = document.querySelector("#view");
    if (!view0) throw err;
    const box = document.createElement("div");
    box.className = "error-banner";
    box.textContent = err?.message || "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
    const retry = document.createElement("button");
    retry.className = "btn secondary small";
    retry.style.marginLeft = "12px";
    retry.textContent = "ลองใหม่";
    retry.addEventListener("click", run);
    box.append(retry);
    view0.replaceChildren(box);
  }
}

export function startRouter(routes, fallback = "#/overview") {
  table = routes;
  fallbackRoute = fallback;
  window.addEventListener("hashchange", run);
  run();
}

export function navigate(hash) {
  if (location.hash === hash) run();
  else location.hash = hash;
}
```

- [ ] **Step 10: Create `public/index.html`**

```html
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ระบบสนับสนุนการตรวจรับ Wi-Fi 1,000 จุด · PSRU</title>
  <link rel="stylesheet" href="/css/tokens.css">
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  <div id="root"></div>
  <div class="drawer-backdrop" id="drawerBackdrop"></div>
  <aside class="drawer" id="drawer"></aside>
  <script type="module" src="/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 11: Create `public/js/app.js`**

```js
import { api, SESSION_EXPIRED_EVENT } from "./core/api.js";
import { h, mount, qs } from "./core/dom.js";
import { startRouter, navigate } from "./core/router.js";
import { ROLE_TH } from "./core/labels.js";
import { renderOverview } from "./pages/overview.js";

const root = () => qs("#root");

const NAV = [
  { hash: "#/overview", label: "ภาพรวม" },
  { hash: "#/points", label: "จุดติดตั้ง" },
  { hash: "#/plans", label: "แผนตรวจ" },
  { hash: "#/defects", label: "ข้อบกพร่อง" },
  { hash: "#/reports", label: "รายงาน" },
];

function loginView() {
  const error = h("div", { class: "error-banner", style: "display:none" });
  const username = h("input", { class: "input", id: "u", autocomplete: "username" });
  const password = h("input", { class: "input", id: "p", type: "password", autocomplete: "current-password" });

  const submit = async (e) => {
    e.preventDefault();
    error.style.display = "none";
    try {
      await api.login(username.value.trim(), password.value);
      navigate("#/overview");
      renderShell();
    } catch (err) {
      error.textContent = err.message;
      error.style.display = "block";
    }
  };

  mount(
    root(),
    h("div", { class: "login-wrap" },
      h("form", { class: "login-card", onsubmit: submit },
        h("div", { class: "brand-mark" }, "W"),
        h("h1", {}, "ระบบสนับสนุนการตรวจรับ Wi-Fi"),
        h("div", { class: "brand-sub", style: "color:var(--muted)" }, "PSRU INSPECTION"),
        h("div", { style: "height:18px" }),
        error,
        h("div", { class: "field" }, h("label", { for: "u" }, "ชื่อผู้ใช้"), username),
        h("div", { class: "field" }, h("label", { for: "p" }, "รหัสผ่าน"), password),
        h("button", { class: "btn", style: "width:100%", type: "submit" }, "เข้าสู่ระบบ")
      )
    )
  );
}

function shell() {
  const user = api.user();
  return h("div", { class: "layout" },
    h("aside", { class: "sidebar" },
      h("div", { class: "brand" },
        h("div", { class: "brand-mark" }, "W"),
        h("div", {},
          h("div", { class: "brand-name" }, "WiFi Accept"),
          h("div", { class: "brand-sub" }, "PSRU Inspection")
        )
      ),
      h("nav", { class: "nav" }, NAV.map((n) => h("a", { href: n.hash }, n.label))),
      h("div", { class: "side-foot" },
        h("b", {}, user?.name ?? "-"),
        h("div", {}, ROLE_TH[user?.role] ?? "-"),
        user?.team ? h("div", {}, user.team) : null,
        h("button", {
          class: "linkbtn",
          style: "margin-top:10px;color:var(--accent)",
          onclick: () => { api.logout(); loginView(); },
        }, "ออกจากระบบ")
      )
    ),
    h("main", { class: "content", id: "view" })
  );
}

export function renderShell() {
  mount(root(), shell());
  startRouter(
    {
      "#/overview": renderOverview,
    },
    "#/overview"
  );
}

// โทเค็นหมดอายุระหว่างใช้งาน ต้องพากลับหน้าเข้าสู่ระบบจริง ๆ
// ไม่ใช่ปล่อยให้เชลล์เดิมค้างอยู่บนจอทั้งที่เรียก API ไม่ได้แล้ว
window.addEventListener(SESSION_EXPIRED_EVENT, () => loginView());

if (api.token()) renderShell();
else loginView();
```

Later tasks add one line per page to the routes object and one import — the shell itself does not change again.

- [ ] **Step 12: Write the test `tests/labels.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { POINT_STATUS_TH, POINT_STATUS_CLASS, EVIDENCE_TH, EVIDENCE_ORDER, GATE_ORDER, GATE_TH } from "../public/js/core/labels.js";
import { REQUIRED_EVIDENCE_KINDS } from "../src/services/pointStatus";

const STATUSES = ["PENDING", "DEFECT", "AWAITING_RETEST", "EVIDENCE_COMPLETE", "UNDER_REVIEW"];

describe("frontend labels stay in sync with the backend", () => {
  it("has a Thai label and a chip class for every point status", () => {
    for (const s of STATUSES) {
      expect(POINT_STATUS_TH[s], `missing label for ${s}`).toBeTruthy();
      expect(POINT_STATUS_CLASS[s], `missing class for ${s}`).toBeTruthy();
    }
  });

  it("covers exactly the evidence kinds the backend requires", () => {
    expect([...EVIDENCE_ORDER].sort()).toEqual([...REQUIRED_EVIDENCE_KINDS].sort());
    for (const kind of EVIDENCE_ORDER) expect(EVIDENCE_TH[kind]).toBeTruthy();
  });

  it("labels all four gates", () => {
    expect(GATE_ORDER).toEqual(["docs", "site", "test", "summary"]);
    for (const g of GATE_ORDER) expect(GATE_TH[g]).toBeTruthy();
  });
});
```

This catches the classic drift where a status is added on the server and the UI silently renders a blank chip.

- [ ] **Step 13: Run the test**

Run: `npm test -- tests/labels.test.ts`
Expected: 3 tests PASS

- [ ] **Step 14: Verify the login screen in a browser**

Start the dev server (create `.claude/launch.json` if it does not exist):

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "wifi1000", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 3200 }
  ]
}
```

Open the preview, log in as `committee` / `psru1234`. Expected: the dark teal sidebar with five nav items and the user card at the bottom. Check the browser console for errors.

- [ ] **Step 15: Commit**

```bash
git add public .claude/launch.json tests/labels.test.ts
git commit -m "feat: add design tokens, app shell, login, and core frontend modules"
```

---

## Task 14: Overview page

**Files:**
- Create: `public/js/pages/overview.js`
- Modify: `public/js/app.js` (already imports it from Task 13 — no change needed)

**Interfaces:**
- Consumes: `GET /api/v1/summary`, `GET /api/v1/plans?date=`, `GET /api/v1/defects?status=OPEN`, `GET /api/v1/points?pageSize=6`
- Produces: `export async function renderOverview(): Promise<void>` — renders into `#view`

- [ ] **Step 1: Create `public/js/pages/overview.js`**

```js
import { api } from "../core/api.js";
import { h, mount, qs } from "../core/dom.js";
import { thNumber, thDate, thDateTime, pct, todayStr } from "../core/format.js";
import {
  POINT_STATUS_TH, POINT_STATUS_CLASS, SEVERITY_TH, SEVERITY_CLASS,
  GATE_ORDER, GATE_TH, GATE_STATE_TH, DISCLAIMER,
} from "../core/labels.js";

function kpi(mark, markClass, label, value, note, ratio) {
  return h("div", { class: "card kpi" },
    h("div", { class: "kpi-top" },
      h("div", { class: `kpi-mark ${markClass}` }, mark),
      h("div", { class: "kpi-label" }, label)
    ),
    h("div", { class: "kpi-value" }, thNumber(value)),
    h("div", { class: "kpi-note" }, note),
    ratio === null ? null : h("div", { class: "bar" }, h("i", { style: `width:${ratio}%` }))
  );
}

function planCard(plan) {
  if (!plan) {
    return h("div", { class: "card card-pad" },
      h("div", { class: "kpi-label" }, "แผนงานวันนี้"),
      h("div", { class: "empty" }, "ยังไม่มีแผนลงพื้นที่สำหรับวันนี้")
    );
  }
  const ratio = pct(plan.done, plan.total);
  return h("div", { class: "card card-pad" },
    h("div", { style: "display:flex;justify-content:space-between;align-items:center" },
      h("div", { class: "kpi-label" }, "แผนงานวันนี้"),
      h("a", { href: "#/plans", class: "linkbtn" }, "ดูแผนทั้งหมด")
    ),
    h("h2", { style: "margin:8px 0 16px;font-size:22px;font-weight:600" }, "ความคืบหน้าการตรวจภาคสนาม"),
    h("div", { style: "display:flex;gap:16px;align-items:center;flex-wrap:wrap" },
      h("div", { style: "background:var(--sidebar);color:#fff;border-radius:12px;padding:14px 18px;text-align:center;min-width:92px" },
        h("div", { style: "font-size:26px;font-weight:600" }, thDate(plan.date).split(" ")[0]),
        h("div", { style: "font-size:12px;opacity:.75" }, plan.team)
      ),
      h("div", { style: "flex:1;min-width:220px" },
        h("div", { style: "font-weight:600" }, `${plan.team} · ${thNumber(plan.total)} จุด`),
        h("div", { class: "bar", style: "margin:10px 0 6px" }, h("i", { style: `width:${ratio}%` })),
        h("div", { class: "kpi-note" }, `ตรวจแล้ว ${thNumber(plan.done)} จาก ${thNumber(plan.total)} จุด`)
      )
    ),
    h("div", { style: "display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px" },
      GATE_ORDER.map((key, i) =>
        h("div", { style: "border-left:2px solid var(--line);padding-left:12px" },
          h("div", { class: "kpi-note" }, `Gate ${i + 1}`),
          h("div", { style: "font-weight:600" }, GATE_TH[key]),
          h("div", {
            class: "kpi-note",
            style: (plan.gates?.[key] === "DONE" ? "color:var(--pass-ink)" : plan.gates?.[key] === "ACTIVE" ? "color:var(--warn-ink)" : ""),
          }, GATE_STATE_TH[plan.gates?.[key] ?? "PENDING"])
        )
      )
    )
  );
}

function defectsCard(defects) {
  const groups = ["URGENT", "MAJOR", "MINOR"].map((sev) => ({
    sev,
    items: defects.filter((d) => d.severity === sev),
  }));
  return h("div", { class: "card card-pad" },
    h("div", { style: "display:flex;justify-content:space-between;align-items:center" },
      h("div", { class: "kpi-label" }, "ต้องดำเนินการ"),
      h("span", { class: "chip fail" }, thNumber(defects.length))
    ),
    h("h2", { style: "margin:8px 0 14px;font-size:22px;font-weight:600" }, "ข้อบกพร่องคงค้าง"),
    defects.length === 0
      ? h("div", { class: "empty" }, "ไม่มีข้อบกพร่องคงค้าง")
      : h("div", {},
          groups.filter((g) => g.items.length).map((g) =>
            h("div", { style: "padding:12px 0;border-top:1px solid var(--line)" },
              h("div", { style: "display:flex;gap:10px;align-items:baseline" },
                h("span", { class: `chip ${SEVERITY_CLASS[g.sev]}` }, SEVERITY_TH[g.sev]),
                h("b", {}, `${thNumber(g.items.length)} รายการ`)
              ),
              h("div", { class: "kpi-note", style: "margin-top:6px" },
                g.items.slice(0, 2).map((d) => d.pointCode + " " + d.title).join(" · ")
              )
            )
          )
        ),
    h("a", { href: "#/defects", class: "linkbtn", style: "display:inline-block;margin-top:12px" }, "จัดการข้อบกพร่องทั้งหมด")
  );
}

function recentTable(rows) {
  return h("div", { class: "card" },
    h("div", { style: "padding:18px 20px 4px" },
      h("div", { class: "kpi-label" }, "ทะเบียนตรวจรับ"),
      h("h2", { style: "margin:6px 0 0;font-size:22px;font-weight:600" }, "จุดติดตั้งล่าสุด")
    ),
    h("div", { class: "table-wrap" },
      h("table", {},
        h("thead", {},
          h("tr", {},
            ["รหัสจุด", "สถานที่", "อุปกรณ์", "สถานะ", "หลักฐาน", "ตรวจล่าสุด"].map((t) => h("th", {}, t))
          )
        ),
        h("tbody", {},
          rows.map((r) =>
            h("tr", {},
              h("td", {}, h("b", {}, r.code), h("div", { class: "kpi-note" }, r.serial || "—")),
              h("td", {}, h("b", {}, r.buildingName), h("div", { class: "kpi-note" }, `${r.floor} · ${r.room}`)),
              h("td", {}, r.deviceModel || "—"),
              h("td", {}, h("span", { class: `chip ${POINT_STATUS_CLASS[r.status]}` }, POINT_STATUS_TH[r.status])),
              h("td", {},
                h("div", { class: "bar", style: "width:110px" },
                  h("i", { style: `width:${pct(r.evidenceHave, r.evidenceNeed)}%` })
                ),
                h("div", { class: "kpi-note" }, `${r.evidenceHave}/${r.evidenceNeed}`)
              ),
              h("td", {}, thDateTime(r.lastInspectedAt))
            )
          )
        )
      )
    ),
    h("div", { style: "padding:14px 20px" }, h("a", { href: "#/points", class: "linkbtn" }, "ดูทะเบียนทั้งหมด"))
  );
}

export async function renderOverview() {
  const view = qs("#view");
  mount(view, h("div", { class: "empty" }, "กำลังโหลดข้อมูล..."));

  const today = todayStr();
  const [summary, plans, defects, points] = await Promise.all([
    api.get("/summary"),
    api.get(`/plans?date=${today}`),
    api.get("/defects?status=OPEN"),
    api.get("/points?page=1&pageSize=6"),
  ]);

  mount(view,
    h("div", {},
      h("div", { class: "page-head" },
        h("div", {},
          h("div", { class: "eyebrow" }, "ระบบควบคุมหลักฐานการตรวจรับ"),
          h("h1", {}, "ภาพรวม")
        ),
        h("div", { class: "toolbar" },
          h("a", { class: "btn secondary", href: "#/reports" }, "รายงาน"),
          h("a", { class: "btn", href: "#/points" }, "เปิดทะเบียนจุด")
        )
      ),
      h("div", { class: "notice" }, h("b", {}, "หมายเหตุสำคัญ: "), DISCLAIMER),
      h("div", { class: "kpis" },
        kpi("จ", "a", "จุดทั้งหมด", summary.total, "ครบตามทะเบียนโครงการ", null),
        kpi("ต", "b", "ตรวจแล้ว", summary.inspected, `${pct(summary.inspected, summary.total)}% ของแผนทั้งหมด`, pct(summary.inspected, summary.total)),
        kpi("ร", "c", "รอตรวจ", summary.pending, `${pct(summary.pending, summary.total)}% ยังไม่ลงพื้นที่`, pct(summary.pending, summary.total)),
        kpi("พ", "d", "พบข้อบกพร่อง", summary.withDefects, "ต้องแก้ไข / ตรวจซ้ำ", null)
      ),
      h("div", { class: "grid-2" }, planCard(plans.plans[0] ?? null), defectsCard(defects.defects)),
      h("div", { style: "height:16px" }),
      recentTable(points.rows)
    )
  );
}
```

- [ ] **Step 2: Verify in the browser**

Log in as `committee` / `psru1234` and open `#/overview`.
Expected: four KPI cards reading 1,000 / 0 / 1,000 / 0 against fresh seed data, the cream disclaimer banner, an empty-plan card, "ไม่มีข้อบกพร่องคงค้าง", and six seeded points in the table with the grey "รอตรวจ" chip. Console clean.

- [ ] **Step 3: Commit**

```bash
git add public/js/pages/overview.js
git commit -m "feat: add overview dashboard page"
```

---

## Task 15: Points registry page and detail drawer

**Files:**
- Create: `public/js/pages/points.js`, `public/js/pages/pointDrawer.js`
- Modify: `public/js/app.js` (add route `#/points`)

**Interfaces:**
- Consumes: `GET /api/v1/points`, `GET /api/v1/points/:id`, `GET /api/v1/buildings`, `POST /api/v1/defects/:id/fix`
- Produces:
  - `export async function renderPoints(): Promise<void>`
  - `export async function openPointDrawer(pointId: string): Promise<void>`, `export function closeDrawer(): void`

- [ ] **Step 1: Create `public/js/pages/pointDrawer.js`**

```js
import { api } from "../core/api.js";
import { h, qs } from "../core/dom.js";
import { thDateTime } from "../core/format.js";
import {
  POINT_STATUS_TH, POINT_STATUS_CLASS, SEVERITY_TH, SEVERITY_CLASS,
  DEFECT_STATUS_TH, EVIDENCE_TH,
} from "../core/labels.js";

// ตัวนับรุ่นของคำขอ กันไม่ให้คำตอบของจุดที่กดก่อนหน้ามาทับจุดที่ผู้ใช้กดล่าสุด
// ถ้าปล่อยไว้ ผู้ใช้จะเห็นประวัติของอีกจุดหนึ่งใต้หัวข้อของจุดที่ตัวเองเลือก
let drawerRequest = 0;
let objectUrls = [];

function releaseObjectUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = [];
}

export function closeDrawer() {
  drawerRequest += 1;
  releaseObjectUrls();
  qs("#drawer").classList.remove("open");
  qs("#drawerBackdrop").classList.remove("open");
}

function checkRow(c) {
  const shown = c.value === null ? "ยังไม่ได้วัด" : `${c.value} ${c.unit}`;
  const target = `${c.operator === "gte" ? "ไม่น้อยกว่า" : "ไม่เกิน"} ${c.threshold} ${c.unit}`;
  return h("tr", {},
    h("td", {}, c.label, h("div", { class: "kpi-note" }, c.torClause)),
    h("td", {}, shown),
    h("td", {}, target),
    h("td", {}, c.belowThreshold ? h("span", { class: "chip fail" }, "ต่ำกว่าเกณฑ์") : h("span", { class: "chip idle" }, "—"))
  );
}

async function evidenceThumb(ev) {
  // ไฟล์หลักฐานต้องส่ง token จึงดึงเป็น blob แทนการใส่ URL ตรงใน src
  const label = EVIDENCE_TH[ev.kind] ?? ev.kind;
  const img = h("img", { alt: label });
  const status = h("div", { class: "kpi-note" }, label);
  try {
    const res = await fetch(ev.url, { headers: { authorization: `Bearer ${api.token()}` } });
    if (res.ok) {
      const url = URL.createObjectURL(await res.blob());
      objectUrls.push(url);
      img.src = url;
    } else {
      status.textContent = `${label} — โหลดไฟล์ไม่สำเร็จ`;
    }
  } catch {
    // ต้องบอกให้รู้ว่าโหลดไม่ได้ ไม่ใช่ปล่อยกล่องว่างที่แยกไม่ออกจากกำลังโหลด
    status.textContent = `${label} — โหลดไฟล์ไม่สำเร็จ`;
  }
  return h("div", {}, img, status);
}

function inspectionBlock(ins) {
  const wrap = h("div", { style: "border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px" },
    h("div", { style: "display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px" },
      h("b", {}, thDateTime(ins.inspectedAt)),
      h("span", { class: "kpi-note" }, `ผู้ตรวจ: ${ins.inspectorName}`)
    ),
    ins.note ? h("div", { style: "margin:8px 0" }, ins.note) : null,
    h("div", { class: "table-wrap" },
      h("table", {},
        h("thead", {}, h("tr", {}, ["เกณฑ์", "ค่าที่วัดได้", "เกณฑ์ TOR", "ผลเทียบ"].map((t) => h("th", {}, t)))),
        h("tbody", {}, ins.checks.map(checkRow))
      )
    ),
    h("div", { class: "kpi-note", style: "margin:12px 0 6px" }, `หลักฐานแนบ ${ins.evidences.length} รายการ`)
  );
  const grid = h("div", { class: "evidence-grid" });
  wrap.append(grid);
  const token = drawerRequest;
  ins.evidences.forEach((ev) =>
    evidenceThumb(ev).then((node) => {
      if (token === drawerRequest) grid.append(node);
    })
  );
  return wrap;
}

export async function openPointDrawer(pointId) {
  const drawer = qs("#drawer");
  const backdrop = qs("#drawerBackdrop");
  const token = (drawerRequest += 1);
  releaseObjectUrls();
  backdrop.classList.add("open");
  drawer.classList.add("open");
  backdrop.onclick = closeDrawer;
  drawer.replaceChildren(h("div", { class: "empty" }, "กำลังโหลด..."));

  let p;
  try {
    p = await api.get(`/points/${pointId}`);
  } catch (err) {
    if (token !== drawerRequest) return;
    if (err?.status === 401) return;
    drawer.replaceChildren(
      h("div", { class: "drawer-head" },
        h("b", {}, "โหลดข้อมูลจุดไม่สำเร็จ"),
        h("button", { class: "close-x", onclick: closeDrawer, "aria-label": "ปิด" }, "×")
      ),
      h("div", { class: "drawer-body" },
        h("div", { class: "error-banner" }, err?.message || "กรุณาลองใหม่อีกครั้ง")
      )
    );
    return;
  }
  // ผู้ใช้กดจุดอื่นไปแล้วระหว่างรอ — ทิ้งคำตอบนี้
  if (token !== drawerRequest) return;

  drawer.replaceChildren(
    h("div", { class: "drawer-head" },
      h("div", {},
        h("h2", { style: "margin:0;font-size:22px" }, p.code),
        h("div", { class: "kpi-note" }, `${p.buildingName} · ${p.floor} · ${p.room}`),
        h("div", { style: "margin-top:8px" },
          h("span", { class: `chip ${POINT_STATUS_CLASS[p.status]}` }, POINT_STATUS_TH[p.status])
        )
      ),
      h("button", { class: "close-x", onclick: closeDrawer, "aria-label": "ปิด" }, "×")
    ),
    h("div", { class: "drawer-body" },
      h("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px" },
        h("div", {}, h("div", { class: "kpi-note" }, "อุปกรณ์"), h("b", {}, p.deviceModel || "—")),
        h("div", {}, h("div", { class: "kpi-note" }, "Serial"), h("b", {}, p.serial || "—")),
        h("div", {}, h("div", { class: "kpi-note" }, "MAC"), h("b", {}, p.mac || "—")),
        h("div", {}, h("div", { class: "kpi-note" }, "จำนวนรอบการตรวจ"), h("b", {}, String(p.inspections.length)))
      ),
      h("h3", { style: "font-size:17px" }, "ข้อบกพร่อง"),
      p.defects.length === 0
        ? h("div", { class: "kpi-note", style: "margin-bottom:18px" }, "ไม่มีข้อบกพร่องที่จุดนี้")
        : h("div", { style: "margin-bottom:18px" },
            p.defects.map((d) =>
              h("div", { style: "border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:8px" },
                h("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" },
                  h("span", { class: `chip ${SEVERITY_CLASS[d.severity]}` }, SEVERITY_TH[d.severity]),
                  h("b", {}, d.title),
                  h("span", { class: "kpi-note" }, DEFECT_STATUS_TH[d.status])
                ),
                h("div", { class: "kpi-note", style: "margin-top:6px" }, d.detail)
              )
            )
          ),
      h("h3", { style: "font-size:17px" }, "ประวัติการตรวจ"),
      p.inspections.length === 0
        ? h("div", { class: "kpi-note" }, "ยังไม่มีการลงตรวจที่จุดนี้")
        : h("div", {}, p.inspections.map(inspectionBlock))
    )
  );
}
```

Evidence images are fetched with the bearer token and turned into object URLs — an `<img src>` pointing at the API would arrive without the `Authorization` header and get a 401.

- [ ] **Step 2: Create `public/js/pages/points.js`**

```js
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { h, mount, qs } from "../core/dom.js";
import { thNumber, thDateTime, pct } from "../core/format.js";
import { POINT_STATUS_TH, POINT_STATUS_CLASS } from "../core/labels.js";
import { openPointDrawer } from "./pointDrawer.js";

const state = { search: "", buildingId: "", status: "", page: 1, pageSize: 50 };

// ตัวนับรุ่นของคำขอ ตารางนี้ถูกสั่งโหลดจากทั้งช่องค้นหา ตัวกรอง และปุ่มเปลี่ยนหน้า
// ถ้าคำตอบเก่ามาถึงทีหลัง แถวที่แสดงกับตัวเลขหน้าจะไม่ตรงกับสิ่งที่ผู้ใช้เลือกไว้
let loadToken = 0;

async function load() {
  const token = (loadToken += 1);
  const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
  if (state.search) params.set("search", state.search);
  if (state.buildingId) params.set("buildingId", state.buildingId);
  if (state.status) params.set("status", state.status);

  const body = qs("#pointsBody");
  let data;
  try {
    data = await api.get(`/points?${params}`);
  } catch (err) {
    if (token !== loadToken || err?.status === 401) return;
    body.replaceChildren(
      h("tr", {}, h("td", { colspan: "7" },
        h("div", { class: "error-banner" }, err?.message || "โหลดทะเบียนจุดไม่สำเร็จ")))
    );
    qs("#pagerInfo").textContent = "";
    return;
  }
  if (token !== loadToken) return;

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  body.replaceChildren(
    ...(data.rows.length
      ? data.rows.map((r) =>
          h("tr", {},
            h("td", {},
              h("button", { class: "linkbtn", onclick: () => openPointDrawer(r.id) }, r.code),
              h("div", { class: "kpi-note" }, r.serial || "—")
            ),
            h("td", {}, h("b", {}, r.buildingName), h("div", { class: "kpi-note" }, `${r.floor} · ${r.room}`)),
            h("td", {}, r.deviceModel || "—"),
            h("td", {}, h("span", { class: `chip ${POINT_STATUS_CLASS[r.status]}` }, POINT_STATUS_TH[r.status])),
            h("td", {},
              h("div", { class: "bar", style: "width:110px" }, h("i", { style: `width:${pct(r.evidenceHave, r.evidenceNeed)}%` })),
              h("div", { class: "kpi-note" }, `${r.evidenceHave}/${r.evidenceNeed}`)
            ),
            h("td", {}, r.openDefects ? h("span", { class: "chip fail" }, thNumber(r.openDefects)) : "—"),
            h("td", {}, thDateTime(r.lastInspectedAt))
          )
        )
      : [h("tr", {}, h("td", { colspan: "7" }, h("div", { class: "empty" }, "ไม่พบจุดติดตั้งตามเงื่อนไขที่เลือก")))])
  );

  qs("#pagerInfo").textContent =
    `พบ ${thNumber(data.total)} จุด · หน้า ${thNumber(data.page)} จาก ${thNumber(pages)}`;
  qs("#prevBtn").disabled = data.page <= 1;
  qs("#nextBtn").disabled = data.page >= pages;
}

export async function renderPoints() {
  const view = qs("#view");
  const buildings = await store.loadBuildings();

  const searchInput = h("input", {
    class: "input", placeholder: "ค้นหารหัสจุด อาคาร ห้อง หรือ Serial", value: state.search,
  });
  let timer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.search = searchInput.value.trim(); state.page = 1; load(); }, 250);
  });

  const buildingSelect = h("select", { class: "select", onchange: (e) => { state.buildingId = e.target.value; state.page = 1; load(); } },
    h("option", { value: "" }, "ทุกอาคาร"),
    buildings.map((b) => h("option", { value: b.id, ...(b.id === state.buildingId ? { selected: "selected" } : {}) }, b.name))
  );

  const statusSelect = h("select", { class: "select", onchange: (e) => { state.status = e.target.value; state.page = 1; load(); } },
    h("option", { value: "" }, "ทุกสถานะ"),
    Object.entries(POINT_STATUS_TH).map(([k, v]) =>
      h("option", { value: k, ...(k === state.status ? { selected: "selected" } : {}) }, v)
    )
  );

  mount(view,
    h("div", {},
      h("div", { class: "page-head" },
        h("div", {},
          h("div", { class: "eyebrow" }, "ทะเบียนตรวจรับ"),
          h("h1", {}, "จุดติดตั้ง")
        ),
        h("div", { class: "toolbar" }, searchInput, buildingSelect, statusSelect)
      ),
      h("div", { style: "height:16px" }),
      h("div", { class: "card" },
        h("div", { class: "table-wrap" },
          h("table", {},
            h("thead", {},
              h("tr", {}, ["รหัสจุด", "สถานที่", "อุปกรณ์", "สถานะ", "หลักฐาน", "ข้อบกพร่อง", "ตรวจล่าสุด"].map((t) => h("th", {}, t)))
            ),
            h("tbody", { id: "pointsBody" })
          )
        ),
        h("div", { class: "pager" },
          h("span", { id: "pagerInfo" }),
          h("button", { class: "btn secondary small", id: "prevBtn", onclick: () => { state.page -= 1; load(); } }, "ก่อนหน้า"),
          h("button", { class: "btn secondary small", id: "nextBtn", onclick: () => { state.page += 1; load(); } }, "ถัดไป")
        )
      )
    )
  );

  await load();
}
```

- [ ] **Step 3: Register the route in `public/js/app.js`**

Add the import beside the overview import:

```js
import { renderPoints } from "./pages/points.js";
```

and add the entry to the routes object inside `renderShell()`:

```js
      "#/points": renderPoints,
```

- [ ] **Step 4: Verify in the browser**

Open `#/points`.
Expected: 50 rows, the pager reads "พบ 1,000 จุด · หน้า 1 จาก 20", "ก่อนหน้า" disabled. Type `AP-0725` in the search box — one row. Clear it, pick a building — the count drops. Click a point code — the drawer slides in with "ยังไม่มีการลงตรวจที่จุดนี้". Press the × and confirm it closes.

- [ ] **Step 5: Commit**

```bash
git add public/js/pages/points.js public/js/pages/pointDrawer.js public/js/app.js
git commit -m "feat: add points registry page with pagination and detail drawer"
```

---

## Task 16: Plans page

**Files:**
- Create: `public/js/pages/plans.js`
- Modify: `public/js/app.js` (add route `#/plans`)

**Interfaces:**
- Consumes: `GET /api/v1/plans?date=`, `POST /api/v1/plans`, `PATCH /api/v1/plans/:id/gates`, `GET /api/v1/points`, `GET /api/v1/buildings`
- Produces: `export async function renderPlans(): Promise<void>`

- [ ] **Step 1: Create `public/js/pages/plans.js`**

```js
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { h, mount, qs } from "../core/dom.js";
import { thNumber, pct, todayStr } from "../core/format.js";
import { GATE_ORDER, GATE_TH, GATE_STATE_TH } from "../core/labels.js";

const state = { date: todayStr() };

function gateSelect(plan, key) {
  const select = h("select", {
      class: "select", style: "min-width:0;width:100%", "data-gate": key,
      onchange: async () => {
        // อ่านค่าจากช่องจริงทั้งสี่ช่อง ไม่ใช้ค่าที่จำไว้ใน plan.gates
        // ถ้าใช้ค่าที่จำไว้ การเปลี่ยน Gate สองอันติดกันเร็ว ๆ อันหลังจะเขียนทับอันแรกกลับเป็นค่าเดิม
        const card = select.closest("[data-plan]");
        const gates = {};
        card.querySelectorAll("[data-gate]").forEach((el) => {
          gates[el.getAttribute("data-gate")] = el.value;
        });
        try {
          await api.patch(`/plans/${plan.id}/gates`, { gates });
        } catch (err) {
          if (err?.status !== 401) alert(err?.message || "บันทึกสถานะ Gate ไม่สำเร็จ");
        }
        await load();
      },
    },
    ["PENDING", "ACTIVE", "DONE"].map((s) =>
      h("option", { value: s, ...(plan.gates?.[key] === s ? { selected: "selected" } : {}) }, GATE_STATE_TH[s])
    )
  );
  return select;
}

function planCard(plan) {
  const ratio = pct(plan.done, plan.total);
  return h("div", { class: "card card-pad", style: "margin-bottom:14px", "data-plan": plan.id },
    h("div", { style: "display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap" },
      h("div", {},
        h("b", { style: "font-size:18px" }, plan.team),
        h("div", { class: "kpi-note" }, plan.note || "ไม่มีหมายเหตุ")
      ),
      h("div", { style: "text-align:right" },
        h("b", {}, `${thNumber(plan.done)} / ${thNumber(plan.total)} จุด`),
        h("div", { class: "kpi-note" }, `${ratio}%`)
      )
    ),
    h("div", { class: "bar", style: "margin:12px 0 16px" }, h("i", { style: `width:${ratio}%` })),
    h("div", { style: "display:grid;grid-template-columns:repeat(4,1fr);gap:12px" },
      GATE_ORDER.map((key, i) =>
        h("div", {},
          h("div", { class: "kpi-note" }, `Gate ${i + 1} · ${GATE_TH[key]}`),
          gateSelect(plan, key)
        )
      )
    )
  );
}

// สั่งโหลดได้จากทั้งช่องเลือกวันที่และการเปลี่ยนสถานะ Gate
// ต้องกันคำตอบเก่ามาทับคำตอบใหม่ ไม่งั้นจะเห็นแผนของวันที่ไม่ได้เลือก
let loadToken = 0;

async function load() {
  const token = (loadToken += 1);
  const list = qs("#plansList");
  let data;
  try {
    data = await api.get(`/plans?date=${state.date}`);
  } catch (err) {
    if (token !== loadToken || err?.status === 401) return;
    list.replaceChildren(
      h("div", { class: "card card-pad" },
        h("div", { class: "error-banner" }, err?.message || "โหลดแผนตรวจไม่สำเร็จ"))
    );
    return;
  }
  if (token !== loadToken) return;

  list.replaceChildren(
    ...(data.plans.length
      ? data.plans.map(planCard)
      : [h("div", { class: "card card-pad" }, h("div", { class: "empty" }, "ยังไม่มีแผนลงพื้นที่ของวันที่เลือก"))])
  );
}

async function openCreateForm() {
  const buildings = await store.loadBuildings();
  const view = qs("#createForm");

  const teamInput = h("input", { class: "input", placeholder: "เช่น ทีม A" });
  const noteInput = h("input", { class: "input", placeholder: "หมายเหตุ (ไม่บังคับ)" });
  const buildingSelect = h("select", { class: "select" },
    h("option", { value: "" }, "เลือกอาคาร"),
    buildings.map((b) => h("option", { value: b.id }, b.name))
  );
  const statusSelect = h("select", { class: "select" },
    h("option", { value: "PENDING" }, "เฉพาะจุดที่ยังไม่ตรวจ"),
    h("option", { value: "" }, "ทุกสถานะ")
  );
  const limitInput = h("input", { class: "input", type: "number", value: "40", min: "1", max: "200" });
  const result = h("div", { class: "kpi-note", style: "margin-top:10px" });

  const submit = async () => {
    result.textContent = "";
    if (!teamInput.value.trim()) { result.textContent = "กรุณาระบุชื่อทีม"; return; }
    if (!buildingSelect.value) { result.textContent = "กรุณาเลือกอาคาร"; return; }

    // เซิร์ฟเวอร์จำกัด pageSize ไว้ที่ 200 ถ้าปล่อยค่าที่ผู้ใช้พิมพ์ผ่านไปตรง ๆ
    // ค่าอย่าง 0 หรือ 500 จะทำให้คำขอถูกปฏิเสธ แล้วฟอร์มจะว่างเปล่าโดยไม่บอกอะไรเลย
    const rawLimit = Number(limitInput.value);
    const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.trunc(rawLimit))) : 40;
    limitInput.value = String(limit);

    const params = new URLSearchParams({ page: "1", pageSize: String(limit), buildingId: buildingSelect.value });
    if (statusSelect.value) params.set("status", statusSelect.value);

    let points;
    try {
      points = await api.get(`/points?${params}`);
    } catch (err) {
      if (err?.status !== 401) result.textContent = err?.message || "ค้นหาจุดไม่สำเร็จ";
      return;
    }
    if (points.rows.length === 0) { result.textContent = "ไม่พบจุดที่ตรงเงื่อนไข"; return; }

    try {
      await api.post("/plans", {
        date: state.date,
        team: teamInput.value.trim(),
        note: noteInput.value.trim() || undefined,
        pointIds: points.rows.map((r) => r.id),
      });
      // บอกให้ชัดเมื่อจุดที่ตรงเงื่อนไขมีมากกว่าที่ใส่ลงแผนได้
      // ไม่งั้นกรรมการจะแยกไม่ออกระหว่าง "ครบแล้ว 40 จุด" กับ "ตัดเหลือ 40 จาก 87 จุด"
      result.textContent =
        points.total > points.rows.length
          ? `บันทึกแผนแล้ว ${points.rows.length} จุด จากที่ตรงเงื่อนไขทั้งหมด ${points.total} จุด — เพิ่มจำนวนจุดสูงสุดแล้วบันทึกซ้ำเพื่อให้ครบ`
          : `บันทึกแผนแล้ว ${points.rows.length} จุด ครบตามเงื่อนไขที่เลือก`;
      await load();
    } catch (err) {
      if (err?.status !== 401) result.textContent = err?.message || "บันทึกแผนไม่สำเร็จ";
    }
  };

  view.replaceChildren(
    h("div", { class: "card card-pad" },
      h("b", {}, "สร้าง / แก้ไขแผนของวันที่เลือก"),
      h("div", { class: "kpi-note", style: "margin:4px 0 14px" },
        "บันทึกซ้ำด้วยวันและทีมเดิมจะแทนที่รายการจุดของแผนนั้น"),
      h("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px" },
        h("div", {}, h("div", { class: "kpi-note" }, "ทีม"), teamInput),
        h("div", {}, h("div", { class: "kpi-note" }, "อาคาร"), buildingSelect),
        h("div", {}, h("div", { class: "kpi-note" }, "เลือกจุด"), statusSelect),
        h("div", {}, h("div", { class: "kpi-note" }, "จำนวนจุดสูงสุด"), limitInput)
      ),
      h("button", { class: "btn", style: "margin-top:14px", onclick: submit }, "บันทึกแผน"),
      result
    )
  );
}

export async function renderPlans() {
  const view = qs("#view");
  const dateInput = h("input", {
    class: "input", type: "date", value: state.date,
    onchange: (e) => { state.date = e.target.value; load(); },
  });

  mount(view,
    h("div", {},
      h("div", { class: "page-head" },
        h("div", {},
          h("div", { class: "eyebrow" }, "การวางแผนลงพื้นที่" ),
          h("h1", {}, "แผนตรวจ")
        ),
        h("div", { class: "toolbar" }, dateInput)
      ),
      h("div", { style: "height:16px" }),
      h("div", { id: "createForm" }),
      h("div", { style: "height:16px" }),
      h("div", { id: "plansList" })
    )
  );

  await openCreateForm();
  await load();
}
```

- [ ] **Step 2: Register the route in `public/js/app.js`**

```js
import { renderPlans } from "./pages/plans.js";
// ...
      "#/plans": renderPlans,
```

- [ ] **Step 3: Verify in the browser**

Open `#/plans`. Create a plan: team `ทีม A`, any building, 40 points, save.
Expected: "บันทึกแผนแล้ว 40 จุด" and a card showing `0 / 40 จุด` with four gate dropdowns. Change Gate 2 to "กำลังดำเนินการ" and reload the page — the value persists. Open `#/overview` and confirm the plan card now shows the same team and progress.

- [ ] **Step 4: Commit**

```bash
git add public/js/pages/plans.js public/js/app.js
git commit -m "feat: add inspection plan page with gate tracking"
```

---

## Task 17: Defects page

**Files:**
- Create: `public/js/pages/defects.js`
- Modify: `public/js/app.js` (add route `#/defects`)

**Interfaces:**
- Consumes: `GET /api/v1/defects`, `POST /api/v1/defects/:id/fix`, `POST /api/v1/defects/:id/close`, `GET /api/v1/points/:id`
- Produces: `export async function renderDefects(): Promise<void>`

- [ ] **Step 1: Create `public/js/pages/defects.js`**

```js
import { api } from "../core/api.js";
import { h, mount, qs } from "../core/dom.js";
import { thNumber, thDate, thDateTime } from "../core/format.js";
import { SEVERITY_TH, SEVERITY_CLASS, DEFECT_STATUS_TH } from "../core/labels.js";
import { openPointDrawer } from "./pointDrawer.js";

const state = { status: "OPEN" };

function canClose() {
  return ["COMMITTEE", "ADMIN"].includes(api.user()?.role);
}

/** ให้เลือกผลตรวจซ้ำที่มีหลักฐานแนบเท่านั้น เพราะเป็นเงื่อนไขการปิดของฝั่งเซิร์ฟเวอร์ */
async function closeFlow(defect, reload) {
  const msgEl = qs(`#msg-${defect.id}`);
  let point;
  try {
    point = await api.get(`/points/${defect.pointId}`);
  } catch (err) {
    if (err?.status !== 401) msgEl.textContent = err?.message || "โหลดข้อมูลจุดไม่สำเร็จ";
    return;
  }
  const eligible = point.inspections.filter(
    (i) => i.evidences.length > 0 && new Date(i.inspectedAt) > new Date(defect.createdAt)
  );

  const msg = msgEl;
  // ตัวกรองฝั่งนี้ต้องตรงกับกฎของเซิร์ฟเวอร์เป๊ะ ๆ (มีหลักฐานแนบ และเกิดหลังเปิดข้อบกพร่อง)
  // ไม่งั้นจะเสนอตัวเลือกที่เซิร์ฟเวอร์ปฏิเสธ หรือซ่อนตัวเลือกที่ใช้ได้จริง
  if (eligible.length === 0) {
    msg.textContent = "ยังไม่มีผลตรวจซ้ำที่มีหลักฐานแนบหลังจากเปิดข้อบกพร่องนี้ ปิดไม่ได้";
    return;
  }

  const select = h("select", { class: "select" },
    eligible.map((i) => h("option", { value: i.id }, `${thDateTime(i.inspectedAt)} · ${i.inspectorName} · หลักฐาน ${i.evidences.length} รายการ`))
  );
  const confirm = h("button", { class: "btn small", onclick: async () => {
    try {
      await api.post(`/defects/${defect.id}/close`, { closingInspectionId: select.value });
      await reload();
    } catch (err) {
      // 401 มีทางกลับหน้าเข้าสู่ระบบของตัวเองแล้ว ถ้ารายงานซ้ำผู้ใช้จะเห็นสองข้อความ
      if (err?.status !== 401) msg.textContent = err?.message || "ปิดข้อบกพร่องไม่สำเร็จ";
    }
  } }, "ยืนยันปิดข้อบกพร่อง");

  msg.replaceChildren(h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px" }, select, confirm));
}

function card(defect, reload) {
  const actions = h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px" });

  if (defect.status === "OPEN") {
    actions.append(
      h("button", { class: "btn secondary small", onclick: async () => {
        try {
          await api.post(`/defects/${defect.id}/fix`, {});
        } catch (err) {
          if (err?.status !== 401) qs(`#msg-${defect.id}`).textContent = err?.message || "บันทึกไม่สำเร็จ";
          return;
        }
        await reload();
      } }, "ทำเครื่องหมายว่าแก้ไขแล้ว")
    );
  }
  if (defect.status !== "CLOSED" && canClose()) {
    actions.append(h("button", { class: "btn small", onclick: () => closeFlow(defect, reload) }, "ปิดข้อบกพร่อง"));
  }
  actions.append(
    h("button", { class: "btn secondary small", onclick: () => openPointDrawer(defect.pointId) }, "ดูจุดติดตั้ง")
  );

  return h("div", { class: "card card-pad", style: "margin-bottom:12px" },
    h("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap" },
      h("span", { class: `chip ${SEVERITY_CLASS[defect.severity]}` }, SEVERITY_TH[defect.severity]),
      h("b", {}, defect.title),
      h("span", { class: "chip idle" }, DEFECT_STATUS_TH[defect.status])
    ),
    h("div", { class: "kpi-note", style: "margin:8px 0" },
      `${defect.pointCode} · ${defect.buildingName} ${defect.floor} ${defect.room}`),
    h("div", {}, defect.detail),
    h("div", { class: "kpi-note", style: "margin-top:8px" },
      `เปิดเมื่อ ${thDate(defect.createdAt)}`,
      defect.owner ? ` · ผู้รับผิดชอบ ${defect.owner}` : "",
      defect.dueDate ? ` · กำหนดเสร็จ ${thDate(defect.dueDate)}` : ""
    ),
    actions,
    h("div", { class: "kpi-note", id: `msg-${defect.id}`, style: "color:var(--fail-ink)" })
  );
}

// สั่งโหลดได้จากตัวกรองสถานะและหลังการปิด/แก้ไขข้อบกพร่องทุกครั้ง
let loadToken = 0;

async function load() {
  const token = (loadToken += 1);
  const list = qs("#defectsList");
  let data;
  try {
    data = await api.get(state.status ? `/defects?status=${state.status}` : "/defects");
  } catch (err) {
    if (token !== loadToken || err?.status === 401) return;
    list.replaceChildren(
      h("div", { class: "card card-pad" },
        h("div", { class: "error-banner" }, err?.message || "โหลดรายการข้อบกพร่องไม่สำเร็จ"))
    );
    return;
  }
  if (token !== loadToken) return;

  const groups = ["URGENT", "MAJOR", "MINOR"];

  list.replaceChildren(
    ...(data.defects.length
      ? groups
          .map((sev) => ({ sev, items: data.defects.filter((d) => d.severity === sev) }))
          .filter((g) => g.items.length)
          .map((g) =>
            h("section", { style: "margin-bottom:22px" },
              h("h2", { style: "font-size:19px;margin:0 0 10px" },
                `${SEVERITY_TH[g.sev]} (${thNumber(g.items.length)})`),
              g.items.map((d) => card(d, load))
            )
          )
      : [h("div", { class: "card card-pad" }, h("div", { class: "empty" }, "ไม่มีข้อบกพร่องตามเงื่อนไขที่เลือก"))])
  );
}

export async function renderDefects() {
  const view = qs("#view");
  // state อยู่ระดับโมดูล ถ้าไม่สะท้อนค่าที่เลือกไว้กลับมาที่ช่อง
  // ผู้ใช้ที่กรอง "ปิดแล้ว" แล้วออกไปหน้าอื่นและกลับมา จะเห็นช่องเขียนว่า "ยังไม่แก้ไข"
  // ทั้งที่รายการข้างล่างยังเป็นข้อบกพร่องที่ปิดแล้ว — อันตรายบนหน้าจอที่ใช้ติดตามข้อบกพร่อง
  const statusOptions = [
    ["OPEN", "ยังไม่แก้ไข"],
    ["FIXED", "แก้ไขแล้ว รอตรวจซ้ำ"],
    ["CLOSED", "ปิดแล้ว"],
    ["", "ทั้งหมด"],
  ];
  const statusSelect = h("select", { class: "select", onchange: (e) => { state.status = e.target.value; load(); } },
    statusOptions.map(([value, label]) =>
      h("option", { value, ...(value === state.status ? { selected: "selected" } : {}) }, label)
    )
  );

  mount(view,
    h("div", {},
      h("div", { class: "page-head" },
        h("div", {},
          h("div", { class: "eyebrow" }, "การจัดการข้อบกพร่อง (NCR)"),
          h("h1", {}, "ข้อบกพร่อง")
        ),
        h("div", { class: "toolbar" }, statusSelect)
      ),
      h("div", { class: "notice" },
        h("b", {}, "เงื่อนไขการปิด: "),
        "ต้องอ้างอิงผลตรวจซ้ำที่มีหลักฐานแนบ และปิดได้เฉพาะกรรมการตรวจรับหรือผู้ดูแลระบบ"),
      h("div", { id: "defectsList" })
    )
  );

  await load();
}
```

- [ ] **Step 2: Register the route in `public/js/app.js`**

```js
import { renderDefects } from "./pages/defects.js";
// ...
      "#/defects": renderDefects,
```

- [ ] **Step 3: Verify in the browser**

Defects only exist once a field submission creates one, so this is fully exercised at the end of Task 21. For now open `#/defects` and confirm it renders "ไม่มีข้อบกพร่องตามเงื่อนไขที่เลือก" with the notice banner and no console errors.

- [ ] **Step 4: Commit**

```bash
git add public/js/pages/defects.js public/js/app.js
git commit -m "feat: add defects board with evidence-backed closure flow"
```

---

## Task 18: Reports page

**Files:**
- Create: `public/js/pages/reports.js`
- Modify: `public/js/app.js` (add route `#/reports`)

**Interfaces:**
- Consumes: `GET /api/v1/summary`, `GET /api/v1/reports/points.csv`, `GET /api/v1/reports/committee.pdf`
- Produces: `export async function renderReports(): Promise<void>`

- [ ] **Step 1: Create `public/js/pages/reports.js`**

```js
import { api } from "../core/api.js";
import { h, mount, qs } from "../core/dom.js";
import { thNumber, pct, todayStr } from "../core/format.js";
import { SEVERITY_TH, DISCLAIMER } from "../core/labels.js";

function canExport() {
  return ["COMMITTEE", "ADMIN"].includes(api.user()?.role);
}

async function withBusy(button, label, fn) {
  const original = button.textContent;
  // ล้างข้อความผิดพลาดของครั้งก่อนเสมอ ไม่งั้นดาวน์โหลดสำเร็จแล้ว
  // แต่ยังมีข้อความสีแดงค้างอยู่ข้าง ๆ ทำให้เข้าใจว่ายังทำไม่สำเร็จ
  qs("#exportMsg").textContent = "";
  button.disabled = true;
  button.textContent = label;
  try {
    await fn();
  } catch (err) {
    if (err?.status !== 401) qs("#exportMsg").textContent = err?.message || "ดำเนินการไม่สำเร็จ";
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

export async function renderReports() {
  const view = qs("#view");
  mount(view, h("div", { class: "empty" }, "กำลังโหลดข้อมูล..."));
  const summary = await api.get("/summary");
  const stamp = todayStr();

  const csvBtn = h("button", { class: "btn secondary", onclick: () =>
    withBusy(csvBtn, "กำลังสร้างไฟล์...", () => api.download("/reports/points.csv", `PSRU_WiFi_Acceptance_${stamp}.csv`))
  }, "ส่งออก CSV");

  const pdfBtn = h("button", { class: "btn", onclick: () =>
    withBusy(pdfBtn, "กำลังสร้างเอกสาร...", () => api.download("/reports/committee.pdf", `PSRU_WiFi_Committee_${stamp}.pdf`))
  }, "สร้าง PDF เสนอกรรมการ");

  mount(view,
    h("div", {},
      h("div", { class: "page-head" },
        h("div", {},
          h("div", { class: "eyebrow" }, "สรุปผลและการส่งออก"),
          h("h1", {}, "รายงาน")
        ),
        canExport()
          ? h("div", { class: "toolbar" }, csvBtn, pdfBtn)
          : h("div", { class: "kpi-note" }, "บทบาทของคุณไม่มีสิทธิ์ส่งออกรายงาน")
      ),
      h("div", { class: "kpi-note", id: "exportMsg", style: "color:var(--fail-ink);margin-top:8px" }),
      h("div", { class: "notice" }, h("b", {}, "หมายเหตุสำคัญ: "), DISCLAIMER),

      h("div", { class: "kpis" },
        [
          ["จุดทั้งหมด", summary.total],
          ["ตรวจแล้ว", summary.inspected],
          ["หลักฐานครบ", summary.evidenceComplete],
          ["รอตรวจซ้ำ", summary.awaitingRetest],
        ].map(([label, value]) =>
          h("div", { class: "card kpi" },
            h("div", { class: "kpi-label" }, label),
            h("div", { class: "kpi-value" }, thNumber(value))
          )
        )
      ),

      h("div", { class: "card card-pad", style: "margin-bottom:16px" },
        h("b", {}, "ข้อบกพร่องคงค้างตามระดับ"),
        h("div", { style: "display:flex;gap:22px;margin-top:12px;flex-wrap:wrap" },
          Object.entries(summary.defectsBySeverity).map(([sev, count]) =>
            h("div", {},
              h("div", { class: "kpi-note" }, SEVERITY_TH[sev] ?? sev),
              h("div", { style: "font-size:26px;font-weight:600" }, thNumber(count))
            )
          )
        )
      ),

      h("div", { class: "card" },
        h("div", { style: "padding:18px 20px 4px" }, h("b", {}, "ความคืบหน้าตามอาคาร")),
        h("div", { class: "table-wrap" },
          h("table", {},
            h("thead", {}, h("tr", {}, ["อาคาร", "จุดทั้งหมด", "ตรวจแล้ว", "มีข้อบกพร่อง", "ความคืบหน้า"].map((t) => h("th", {}, t)))),
            h("tbody", {},
              summary.byBuilding.map((b) =>
                h("tr", {},
                  h("td", {}, b.buildingName),
                  h("td", {}, thNumber(b.total)),
                  h("td", {}, thNumber(b.inspected)),
                  h("td", {}, b.withDefects ? h("span", { class: "chip fail" }, thNumber(b.withDefects)) : "—"),
                  h("td", {},
                    h("div", { class: "bar", style: "width:150px" }, h("i", { style: `width:${pct(b.inspected, b.total)}%` })),
                    h("div", { class: "kpi-note" }, `${pct(b.inspected, b.total)}%`)
                  )
                )
              )
            )
          )
        )
      )
    )
  );
}
```

- [ ] **Step 2: Register the route in `public/js/app.js`**

```js
import { renderReports } from "./pages/reports.js";
// ...
      "#/reports": renderReports,
```

- [ ] **Step 3: Verify in the browser**

Open `#/reports` as `committee`.
Expected: the KPI row, the per-building table with 10 rows of 100 points each. Click "ส่งออก CSV" — a file downloads; open it in Excel and confirm Thai headers are not garbled. Click "สร้าง PDF เสนอกรรมการ" — a PDF downloads and opens with readable Thai and a signature block.

Then log in as `field1` / `psru1234` and open `#/reports`: the export buttons must be replaced by "บทบาทของคุณไม่มีสิทธิ์ส่งออกรายงาน".

- [ ] **Step 4: Commit**

```bash
git add public/js/pages/reports.js public/js/app.js
git commit -m "feat: add reports page with CSV and committee PDF export"
```

---

## Task 19: Offline outbox on IndexedDB

**Files:**
- Create: `public/js/offline/idb.js`, `public/js/offline/outbox.js`
- Create: `tests/outbox.test.ts`
- Modify: `package.json` (add `fake-indexeddb` dev dependency)

**Interfaces:**
- Consumes: nothing (storage layer only; the sender is injected so it can be tested)
- Produces:
  ```js
  // public/js/offline/idb.js
  export function openDb(name = "psru_wifi", version = 1): Promise<IDBDatabase>;
  export function put(db, store, value): Promise<any>;
  export function getAll(db, store): Promise<any[]>;
  export function del(db, store, key): Promise<void>;
  export function get(db, store, key): Promise<any>;
  export function clear(db, store): Promise<void>;

  // public/js/offline/outbox.js
  export const BACKOFF_MS = [10000, 30000, 120000, 600000];
  export async function enqueue(db, item): Promise<string>;           // item = {clientUuid, payload, photos:[{kind,blob,capturedAt}]}
  export async function listPending(db): Promise<OutboxItem[]>;
  export async function pendingCount(db): Promise<number>;
  export async function flush(db, sender, now = Date.now()): Promise<{sent: number; failed: number; skipped: number; busy?: true}>;
  // sender = { submit(payload) -> {inspectionId}, upload(inspectionId, photo) -> void }
  // flush is single-flight: a second concurrent call returns {sent:0,failed:0,skipped:0,busy:true}
  // and per-photo progress is persisted, so a retry resumes rather than re-uploading
  ```

- [ ] **Step 1: Add the test dependency**

```bash
npm install --save-dev fake-indexeddb
```

- [ ] **Step 2: Create `public/js/offline/idb.js`**

```js
export function openDb(name = "psru_wifi", version = 1) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "clientUuid" });
      if (!db.objectStoreNames.contains("points")) db.createObjectStore("points", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const put = (db, store, value) => wrap(tx(db, store, "readwrite").put(value));
export const getAll = (db, store) => wrap(tx(db, store, "readonly").getAll());
export const get = (db, store, key) => wrap(tx(db, store, "readonly").get(key));
export const del = (db, store, key) => wrap(tx(db, store, "readwrite").delete(key));
export const clear = (db, store) => wrap(tx(db, store, "readwrite").clear());
```

- [ ] **Step 3: Write the failing test `tests/outbox.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import "fake-indexeddb/auto";
import { openDb, getAll, clear } from "../public/js/offline/idb.js";
import { enqueue, flush, pendingCount, BACKOFF_MS } from "../public/js/offline/outbox.js";

function item(uuid: string, photos = 1) {
  return {
    clientUuid: uuid,
    payload: { clientUuid: uuid, pointCode: "AP-0001", inspectedAt: new Date().toISOString(), measurements: { rssi: -50 } },
    photos: Array.from({ length: photos }, (_, i) => ({ kind: "LOCATION", blob: new Blob([`p${i}`]), capturedAt: new Date().toISOString() })),
  };
}

function okSender() {
  const submitted: string[] = [];
  const uploaded: string[] = [];
  return {
    submitted,
    uploaded,
    async submit(payload: { clientUuid: string }) {
      submitted.push(payload.clientUuid);
      return { inspectionId: `ins-${payload.clientUuid}` };
    },
    async upload(inspectionId: string) {
      uploaded.push(inspectionId);
    },
  };
}

let db: IDBDatabase;

describe("offline outbox", () => {
  // เปิดฐานข้อมูลครั้งเดียวแล้วล้างเฉพาะข้อมูลก่อนแต่ละเทสต์
  // ห้ามใช้ deleteDatabase ที่นี่ เพราะถ้ายังมี connection เปิดค้างอยู่
  // คำสั่งลบจะถูกบล็อกและ hook จะค้างจนหมดเวลา
  beforeAll(async () => {
    db = await openDb("psru_wifi_test_store", 1);
  });

  afterAll(() => {
    (db as unknown as { close(): void }).close();
  });

  beforeEach(async () => {
    await clear(db, "outbox");
  });

  it("queues an item and reports it as pending", async () => {
    await enqueue(db, item("a"));
    expect(await pendingCount(db)).toBe(1);
  });

  it("sends queued items and clears them", async () => {
    await enqueue(db, item("a"));
    await enqueue(db, item("b"));
    const sender = okSender();
    const result = await flush(db, sender);
    expect(result.sent).toBe(2);
    expect(await pendingCount(db)).toBe(0);
    expect(sender.submitted.sort()).toEqual(["a", "b"]);
  });

  it("uploads every photo attached to an item", async () => {
    await enqueue(db, item("a", 3));
    const sender = okSender();
    await flush(db, sender);
    expect(sender.uploaded).toHaveLength(3);
  });

  it("keeps an item queued when the send fails and applies backoff", async () => {
    await enqueue(db, item("a"));
    const failing = {
      async submit() { throw new Error("offline"); },
      async upload() {},
    };
    const result = await flush(db, failing, 1_000_000);
    expect(result.failed).toBe(1);
    expect(await pendingCount(db)).toBe(1);

    const [row] = await getAll(db, "outbox");
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt).toBe(1_000_000 + BACKOFF_MS[0]);
    expect(row.lastError).toBeTruthy();
  });

  it("skips an item that is still inside its backoff window", async () => {
    await enqueue(db, item("a"));
    const failing = { async submit() { throw new Error("offline"); }, async upload() {} };
    await flush(db, failing, 1_000_000);

    const sender = okSender();
    const tooSoon = await flush(db, sender, 1_000_001);
    expect(tooSoon.skipped).toBe(1);
    expect(sender.submitted).toHaveLength(0);

    const later = await flush(db, sender, 1_000_000 + BACKOFF_MS[0] + 1);
    expect(later.sent).toBe(1);
  });

  it("survives replay: flushing twice never sends the same item twice", async () => {
    await enqueue(db, item("a"));
    const sender = okSender();
    await flush(db, sender);
    await flush(db, sender);
    expect(sender.submitted).toEqual(["a"]);
  });

  it("resumes photo uploads instead of re-uploading ones that already landed", async () => {
    await enqueue(db, item("a", 3));

    const uploaded: string[] = [];
    let submits = 0;
    const failsOnSecondPhoto = {
      async submit() {
        submits += 1;
        return { inspectionId: "ins-a" };
      },
      async upload(_id: string, photo: { blob: Blob }) {
        const tag = await photo.blob.text();
        if (tag === "p1" && !uploaded.includes("p1-retry")) {
          uploaded.push("p1-retry");
          throw new Error("upload failed");
        }
        uploaded.push(tag);
      },
    };

    const first = await flush(db, failsOnSecondPhoto, 1_000_000);
    expect(first.failed).toBe(1);
    expect(uploaded).toEqual(["p0", "p1-retry"]);

    const [queued] = await getAll(db, "outbox");
    expect(queued.inspectionId).toBe("ins-a");
    expect(queued.photos).toHaveLength(2);

    const second = await flush(db, failsOnSecondPhoto, 1_000_000 + BACKOFF_MS[0] + 1);
    expect(second.sent).toBe(1);
    expect(submits).toBe(1);
    expect(uploaded).toEqual(["p0", "p1-retry", "p1", "p2"]);
    expect(await pendingCount(db)).toBe(0);
  });

  it("does not double-send when two flushes overlap", async () => {
    await enqueue(db, item("a"));

    const sender = okSender();
    const slow = {
      submitted: sender.submitted,
      async submit(payload: { clientUuid: string }) {
        await new Promise((r) => setTimeout(r, 20));
        return sender.submit(payload);
      },
      async upload(inspectionId: string) {
        return sender.upload(inspectionId);
      },
    };

    const [a, b] = await Promise.all([flush(db, slow), flush(db, slow)]);

    expect(sender.submitted).toEqual(["a"]);
    expect([a.sent, b.sent].sort()).toEqual([0, 1]);
    expect(await pendingCount(db)).toBe(0);
  });

  it("never drops an item after repeated failures", async () => {
    await enqueue(db, item("a"));
    const failing = { async submit() { throw new Error("offline"); }, async upload() {} };
    let t = 1_000_000;
    for (let i = 0; i < 8; i += 1) {
      await flush(db, failing, t);
      t += 3_600_000;
    }
    expect(await pendingCount(db)).toBe(1);
  });
});
```

The last two tests encode the promises made to the field technician: a queued inspection is never sent twice and never silently discarded.

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- tests/outbox.test.ts`
Expected: FAIL — "Cannot find module '../public/js/offline/outbox.js'"

- [ ] **Step 5: Create `public/js/offline/outbox.js`**

```js
import { put, getAll, del } from "./idb.js";

export const BACKOFF_MS = [10000, 30000, 120000, 600000];

function backoffFor(attempts) {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
}

export async function enqueue(db, item) {
  await put(db, "outbox", {
    clientUuid: item.clientUuid,
    payload: item.payload,
    photos: item.photos ?? [],
    queuedAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
  });
  return item.clientUuid;
}

export async function listPending(db) {
  return getAll(db, "outbox");
}

export async function pendingCount(db) {
  return (await getAll(db, "outbox")).length;
}

// กันไม่ให้ flush สองรอบทำงานทับกัน เช่น event online ยิงขึ้นมาระหว่างที่ผู้ใช้กด "ส่งเดี๋ยวนี้"
// ถ้าปล่อยไว้ ทั้งสองรอบจะอ่านแถวเดียวกันที่ยังไม่ถูกลบ แล้วส่งซ้ำจริง ๆ ที่ชั้นเครือข่าย
let flushing = false;

/**
 * ส่งรายการที่ค้างในคิว
 * - ส่งซ้ำได้เสมอ เพราะเซิร์ฟเวอร์ทำ upsert ตาม clientUuid
 * - ล้มเหลวแล้วไม่ลบทิ้ง แต่เลื่อนเวลาส่งครั้งถัดไปแบบถอยห่างขึ้นเรื่อย ๆ
 * - บันทึกความคืบหน้าทีละรูป การส่งใหม่จึงทำต่อจากเดิม ไม่ใช่เริ่มอัปโหลดทั้งชุดซ้ำ
 */
export async function flush(db, sender, now = Date.now()) {
  if (flushing) return { sent: 0, failed: 0, skipped: 0, busy: true };
  flushing = true;
  try {
    const items = await getAll(db, "outbox");
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const item of items) {
      if (item.nextAttemptAt && item.nextAttemptAt > now) {
        skipped += 1;
        continue;
      }
      let progress = item;
      try {
        // ถ้าเคยส่งผลตรวจสำเร็จแล้วแต่มาตกตอนอัปโหลดรูป ไม่ต้องส่งผลตรวจซ้ำอีก
        const inspectionId =
          progress.inspectionId ?? (await sender.submit(progress.payload)).inspectionId;
        if (progress.inspectionId !== inspectionId) {
          progress = { ...progress, inspectionId };
          await put(db, "outbox", progress);
        }

        // เก็บความคืบหน้าหลังอัปโหลดสำเร็จทีละรูป
        // ไม่งั้นรูปที่ขึ้นไปแล้วจะถูกอัปโหลดซ้ำและเกิดหลักฐานซ้ำบนเซิร์ฟเวอร์
        while ((progress.photos ?? []).length > 0) {
          await sender.upload(inspectionId, progress.photos[0]);
          progress = { ...progress, photos: progress.photos.slice(1) };
          await put(db, "outbox", progress);
        }

        await del(db, "outbox", progress.clientUuid);
        sent += 1;
      } catch (err) {
        const attempts = (progress.attempts ?? 0) + 1;
        await put(db, "outbox", {
          ...progress,
          attempts,
          nextAttemptAt: now + backoffFor(attempts - 1),
          lastError: String(err?.message ?? err),
        });
        failed += 1;
      }
    }

    return { sent, failed, skipped };
  } finally {
    flushing = false;
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- tests/outbox.test.ts`
Expected: 7 tests PASS

- [ ] **Step 7: Commit**

```bash
git add public/js/offline package.json package-lock.json tests/outbox.test.ts
git commit -m "feat: add IndexedDB outbox with backoff and replay safety"
```

---

## Task 20: Client-side image resizing

**Files:**
- Create: `public/js/offline/imageResize.js`
- Create: `tests/imageResize.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  ```js
  export const MAX_EDGE = 1600;
  export const JPEG_QUALITY = 0.8;
  export function targetSize(width, height, maxEdge = MAX_EDGE): {width: number, height: number};
  export async function shrinkImage(file, maxEdge = MAX_EDGE, quality = JPEG_QUALITY): Promise<Blob>;
  ```

`targetSize` is separated out precisely so the arithmetic can be tested without a canvas; `shrinkImage` is the thin browser-only wrapper around it.

- [ ] **Step 1: Write the failing test `tests/imageResize.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { targetSize, MAX_EDGE } from "../public/js/offline/imageResize.js";

describe("targetSize", () => {
  it("leaves an already-small image untouched", () => {
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("scales a landscape image by its width", () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales a portrait image by its height", () => {
    expect(targetSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
  });

  it("returns whole pixels", () => {
    const { width, height } = targetSize(4032, 3024);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });

  it("never returns a zero dimension for extreme aspect ratios", () => {
    const { width, height } = targetSize(10000, 3);
    expect(width).toBe(MAX_EDGE);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/imageResize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `public/js/offline/imageResize.js`**

```js
export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.8;

export function targetSize(width, height, maxEdge = MAX_EDGE) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** ย่อรูปในเครื่องก่อนเข้าคิว เพื่อไม่ให้ IndexedDB บวมจนเบราว์เซอร์ล้างข้อมูลทิ้ง */
export async function shrinkImage(file, maxEdge = MAX_EDGE, quality = JPEG_QUALITY) {
  const bitmap = await createImageBitmap(file);
  const { width, height } = targetSize(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", quality));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/imageResize.test.ts`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add public/js/offline/imageResize.js tests/imageResize.test.ts
git commit -m "feat: shrink evidence photos before queueing"
```

---

## Task 21: Mobile capture app

**Files:**
- Create: `public/m.html`, `public/js/mobile/app.js`, `public/js/mobile/todayList.js`, `public/js/mobile/captureForm.js`, `public/js/mobile/sync.js`
- Create: `public/css/mobile.css`

**Interfaces:**
- Consumes: `api` (Task 13), `openDb`/`put`/`getAll` (Task 19), `enqueue`/`flush`/`pendingCount` (Task 19), `shrinkImage` (Task 20), `GET /api/v1/plans/today/mine`, `POST /api/v1/inspections`, `POST /api/v1/inspections/:id/evidence`
- Produces:
  ```js
  // public/js/mobile/sync.js
  export async function initSync(): Promise<IDBDatabase>;
  export function getDb(): IDBDatabase | null;
  export async function syncNow(): Promise<{sent,failed,skipped}>;
  export async function refreshBadge(): Promise<number>;
  export function onBadgeChange(cb): void;
  // public/js/mobile/todayList.js
  export async function renderTodayList(): Promise<void>;
  // public/js/mobile/captureForm.js
  export async function renderCaptureForm(pointId: string): Promise<void>;
  ```

- [ ] **Step 1: Create `public/css/mobile.css`**

```css
.m-body { max-width: 640px; margin: 0 auto; padding: 0 0 96px; }
.m-top {
  position: sticky; top: 0; z-index: 10; background: var(--sidebar); color: #fff;
  padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; gap: 10px;
}
.m-top b { font-size: 16px; }
.m-sync { font-size: 13px; display: flex; align-items: center; gap: 8px; }
.m-sync .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }
.m-sync.clear .dot { background: #3fbf8f; }
.m-sync button { background: rgba(255,255,255,.12); border: 0; color: #fff; border-radius: 8px; padding: 6px 10px; }

.m-list { padding: 14px 14px 0; display: grid; gap: 10px; }
.m-item {
  background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px;
  display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%; text-align: left;
}
.m-item b { font-size: 17px; }
.m-item .meta { color: var(--muted); font-size: 13px; margin-top: 2px; }

.m-form { padding: 14px; display: grid; gap: 14px; }
.m-field { display: grid; gap: 6px; }
.m-field label { font-weight: 600; }
.m-field .hint { color: var(--muted); font-size: 13px; }
.m-field input, .m-field textarea, .m-field select {
  width: 100%; border: 1px solid #cfd9d6; border-radius: 10px; padding: 13px; font-size: 16px; background: #fff;
}
.m-photos { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.m-photo {
  border: 1.5px dashed #c2cfcb; border-radius: 12px; padding: 12px; text-align: center;
  background: #fff; min-height: 116px; display: grid; place-items: center; gap: 6px; font-size: 13px;
}
.m-photo.filled { border-style: solid; border-color: var(--primary); }
.m-photo img { width: 100%; height: 64px; object-fit: cover; border-radius: 8px; }
.m-photo input { display: none; }

.m-submit {
  position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 14px;
  background: rgba(245,247,246,.96); border-top: 1px solid var(--line);
}
.m-submit button { width: 100%; padding: 16px; font-size: 17px; border-radius: 12px; border: 0; background: var(--primary); color: #fff; font-weight: 600; }
.m-msg { padding: 0 14px; color: var(--fail-ink); }
.m-done { color: var(--pass-ink); font-weight: 600; }
```

- [ ] **Step 2: Create `public/m.html`**

```html
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>บันทึกผลตรวจภาคสนาม · PSRU</title>
  <link rel="stylesheet" href="/css/tokens.css">
  <link rel="stylesheet" href="/css/app.css">
  <link rel="stylesheet" href="/css/mobile.css">
</head>
<body>
  <div id="mroot"></div>
  <script type="module" src="/js/mobile/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `public/js/mobile/sync.js`**

```js
import { api } from "../core/api.js";
import { openDb } from "../offline/idb.js";
import { flush, pendingCount } from "../offline/outbox.js";

let db = null;
const listeners = [];

const sender = {
  async submit(payload) {
    return api.post("/inspections", payload);
  },
  async upload(inspectionId, photo) {
    const form = new FormData();
    form.append("kind", photo.kind);
    form.append("capturedAt", photo.capturedAt);
    form.append("file", photo.blob, `${photo.kind.toLowerCase()}.jpg`);
    return api.postForm(`/inspections/${inspectionId}/evidence`, form);
  },
};

export async function initSync() {
  if (db) return db;
  db = await openDb();
  window.addEventListener("online", () => { syncNow(); });
  setInterval(() => { if (navigator.onLine) syncNow(); }, 60000);
  await refreshBadge();
  return db;
}

export function getDb() {
  return db;
}

export async function syncNow() {
  if (!db || !navigator.onLine) return { sent: 0, failed: 0, skipped: 0 };
  const result = await flush(db, sender);
  await refreshBadge();
  return result;
}

export async function refreshBadge() {
  const count = db ? await pendingCount(db) : 0;
  listeners.forEach((cb) => cb(count));
  return count;
}

export function onBadgeChange(cb) {
  listeners.push(cb);
}
```

- [ ] **Step 4: Create `public/js/mobile/captureForm.js`**

```js
import { api } from "../core/api.js";
import { h, qs } from "../core/dom.js";
import { EVIDENCE_ORDER, EVIDENCE_TH } from "../core/labels.js";
import { shrinkImage } from "../offline/imageResize.js";
import { enqueue } from "../offline/outbox.js";
import { getDb, refreshBadge, syncNow } from "./sync.js";

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
  );
}

function photoTile(kind, photos) {
  const input = h("input", { type: "file", accept: "image/*", capture: "environment" });
  const preview = h("div", {}, "แตะเพื่อถ่ายรูป");
  const tile = h("label", { class: "m-photo" }, h("b", {}, EVIDENCE_TH[kind]), preview, input);
  let previewUrl = null;

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    preview.textContent = "กำลังย่อรูป...";
    try {
      const blob = await shrinkImage(file);
      photos.set(kind, { kind, blob, capturedAt: new Date().toISOString() });
      // ถ่ายซ้ำช่องเดิมได้ ต้องคืน URL เดิมก่อน ไม่งั้นค้างสะสมทั้งกะการทำงาน
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      tile.classList.add("filled");
      preview.replaceChildren(h("img", { src: previewUrl, alt: EVIDENCE_TH[kind] }));
    } catch {
      preview.textContent = "ย่อรูปไม่สำเร็จ แตะเพื่อถ่ายใหม่";
    }
  });

  return tile;
}

export async function renderCaptureForm(pointId) {
  const root = qs("#mroot");
  const cached = JSON.parse(sessionStorage.getItem("psru_wifi_today") || "{}");
  const point = (cached.points || []).find((p) => p.id === pointId);
  if (!point) { location.hash = "#/today"; return; }

  const criteria = JSON.parse(localStorage.getItem("psru_wifi_criteria") || "[]");
  const photos = new Map();
  const fields = {};
  const msg = h("div", { class: "m-msg" });

  const measurementFields = criteria.map((c) => {
    const input = h("input", { type: "number", inputmode: "decimal", step: "any" });
    fields[c.key] = input;
    return h("div", { class: "m-field" },
      h("label", {}, c.label),
      h("div", { class: "hint" },
        `เกณฑ์ ${c.operator === "gte" ? "ไม่น้อยกว่า" : "ไม่เกิน"} ${c.threshold} ${c.unit} · ${c.torClause}`),
      input
    );
  });

  const serial = h("input", { value: point.serial || "", placeholder: "หมายเลขเครื่อง" });
  const mac = h("input", { value: point.mac || "", placeholder: "MAC Address" });
  const note = h("textarea", { rows: "3", placeholder: "บันทึกเพิ่มเติม (ไม่บังคับ)" });
  const defectTitle = h("input", { placeholder: "หัวข้อข้อบกพร่อง (เว้นว่างหากไม่พบ)" });
  const defectDetail = h("textarea", { rows: "2", placeholder: "รายละเอียดข้อบกพร่อง" });
  const defectSeverity = h("select", {},
    h("option", { value: "MINOR" }, "ทั่วไป"),
    h("option", { value: "MAJOR" }, "สำคัญ"),
    h("option", { value: "URGENT" }, "เร่งด่วน")
  );

  const saveBtn = h("button", {}, "บันทึกผลตรวจ");
  let saving = false;

  const submit = async () => {
    // กันการกดสองครั้งติดกันบนจอสัมผัส ไม่งั้นจะได้ผลตรวจสองรายการจากการลงพื้นที่ครั้งเดียว
    if (saving) return;
    msg.textContent = "";
    if (photos.size === 0) { msg.textContent = "ต้องถ่ายหลักฐานอย่างน้อย 1 รูปก่อนบันทึก"; return; }

    const measurements = {};
    for (const [key, input] of Object.entries(fields)) {
      if (input.value !== "") measurements[key] = Number(input.value);
    }

    const clientUuid = uuid();
    const payload = {
      clientUuid,
      pointCode: point.code,
      inspectedAt: new Date().toISOString(),
      measurements,
      note: note.value.trim() || undefined,
      serial: serial.value.trim() || undefined,
      mac: mac.value.trim() || undefined,
      planId: cached.plan?.id,
      ...(defectTitle.value.trim()
        ? {
            defect: {
              severity: defectSeverity.value,
              title: defectTitle.value.trim(),
              detail: defectDetail.value.trim() || defectTitle.value.trim(),
            },
          }
        : {}),
    };

    saving = true;
    saveBtn.disabled = true;
    try {
      // นี่คือจุดเดียวที่ต้องสำเร็จให้ได้ ถ้าเขียนลงเครื่องไม่ได้ (พื้นที่เต็ม โหมดส่วนตัว ฯลฯ)
      // ห้ามเงียบ เพราะช่างจะเดินจากจุดนั้นไปโดยเชื่อว่างานถูกบันทึกแล้ว
      await enqueue(getDb(), { clientUuid, payload, photos: [...photos.values()] });
    } catch (err) {
      msg.textContent = `บันทึกลงเครื่องไม่สำเร็จ ยังไม่ได้บันทึกผลตรวจนี้ กรุณาลองใหม่ (${err?.message ?? "ไม่ทราบสาเหตุ"})`;
      saving = false;
      saveBtn.disabled = false;
      return;
    }
    await refreshBadge();
    syncNow();
    location.hash = "#/today";
  };
  saveBtn.addEventListener("click", submit);

  root.replaceChildren(
    h("div", { class: "m-top" },
      h("div", {},
        h("b", {}, point.code),
        h("div", { style: "font-size:13px;opacity:.8" }, `${point.buildingName} · ${point.floor} · ${point.room}`)
      ),
      h("button", { onclick: () => { location.hash = "#/today"; } }, "ย้อนกลับ")
    ),
    h("div", { class: "m-body" },
      h("div", { class: "m-form" },
        h("div", { class: "m-field" }, h("label", {}, "Serial Number"), serial),
        h("div", { class: "m-field" }, h("label", {}, "MAC Address"), mac),
        measurementFields,
        h("div", { class: "m-field" },
          h("label", {}, "หลักฐาน"),
          h("div", { class: "hint" }, "ถ่ายให้ครบ 6 ประเภทเมื่อทำได้ ระบบบันทึกได้แม้ยังไม่ครบ"),
          h("div", { class: "m-photos" }, EVIDENCE_ORDER.map((kind) => photoTile(kind, photos)))
        ),
        h("div", { class: "m-field" }, h("label", {}, "หมายเหตุ"), note),
        h("div", { class: "m-field" },
          h("label", {}, "ข้อบกพร่องที่พบ"),
          defectTitle, defectDetail, defectSeverity
        )
      ),
      msg
    ),
    h("div", { class: "m-submit" }, saveBtn)
  );
}
```

The point list and criteria come from cached storage, not a fresh request — the form has to open with no signal.

- [ ] **Step 5: Create `public/js/mobile/todayList.js`**

```js
import { api } from "../core/api.js";
import { h, qs } from "../core/dom.js";
import { getDb, refreshBadge, syncNow, onBadgeChange } from "./sync.js";
import { listPending } from "../offline/outbox.js";

async function loadToday() {
  try {
    const data = await api.get("/plans/today/mine");
    sessionStorage.setItem("psru_wifi_today", JSON.stringify(data));
    const { criteria } = await api.get("/criteria");
    localStorage.setItem("psru_wifi_criteria", JSON.stringify(criteria));
    return data;
  } catch {
    return JSON.parse(sessionStorage.getItem("psru_wifi_today") || '{"plan":null,"points":[]}');
  }
}

function syncBar() {
  const dot = h("span", { class: "dot" });
  const text = h("span", {}, "กำลังตรวจสอบคิว...");
  const button = h("button", { onclick: async () => {
    text.textContent = "กำลังส่ง...";
    const r = await syncNow();
    text.textContent = r.sent ? `ส่งแล้ว ${r.sent} รายการ` : "ส่งไม่สำเร็จ ลองใหม่เมื่อมีสัญญาณ";
    await refreshBadge();
  } }, "ส่งเดี๋ยวนี้");

  const bar = h("div", { class: "m-sync" }, dot, text, button);
  onBadgeChange((count) => {
    bar.classList.toggle("clear", count === 0);
    text.textContent = count === 0 ? "ส่งครบแล้ว" : `ค้างส่ง ${count} รายการ`;
    button.style.display = count === 0 ? "none" : "";
  });
  return bar;
}

export async function renderTodayList() {
  const root = qs("#mroot");
  root.replaceChildren(h("div", { class: "m-body" }, h("div", { class: "empty" }, "กำลังโหลด...")));

  const data = await loadToday();
  const pending = new Set((await listPending(getDb())).map((i) => i.payload.pointCode));

  root.replaceChildren(
    h("div", { class: "m-top" },
      h("div", {},
        h("b", {}, "จุดตรวจวันนี้"),
        h("div", { style: "font-size:13px;opacity:.8" }, data.plan ? data.plan.team : "ยังไม่มีแผน")
      ),
      syncBar()
    ),
    h("div", { class: "m-body" },
      data.points.length === 0
        ? h("div", { class: "empty" }, "ยังไม่มีจุดที่ได้รับมอบหมายสำหรับวันนี้")
        : h("div", { class: "m-list" },
            data.points.map((p) =>
              h("button", { class: "m-item", onclick: () => { location.hash = `#/point/${p.id}`; } },
                h("div", {},
                  h("b", {}, p.code),
                  h("div", { class: "meta" }, `${p.buildingName} · ${p.floor} · ${p.room}`)
                ),
                pending.has(p.code)
                  ? h("span", { class: "chip warn" }, "ค้างส่ง")
                  : p.doneAt
                    ? h("span", { class: "chip pass" }, "ตรวจแล้ว")
                    : h("span", { class: "chip idle" }, "รอตรวจ")
              )
            )
          )
    )
  );

  await refreshBadge();
}
```

- [ ] **Step 6: Create `public/js/mobile/app.js`**

```js
import { api, SESSION_EXPIRED_EVENT } from "../core/api.js";
import { h, qs } from "../core/dom.js";
import { initSync, syncNow } from "./sync.js";
import { renderTodayList } from "./todayList.js";
import { renderCaptureForm } from "./captureForm.js";

function loginView() {
  const error = h("div", { class: "m-msg" });
  const username = h("input", { autocomplete: "username" });
  const password = h("input", { type: "password", autocomplete: "current-password" });

  qs("#mroot").replaceChildren(
    h("div", { class: "m-top" }, h("b", {}, "บันทึกผลตรวจภาคสนาม")),
    h("div", { class: "m-body" },
      h("form", { class: "m-form", onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api.login(username.value.trim(), password.value);
          await start();
        } catch (err) {
          error.textContent = err.message;
        }
      } },
        h("div", { class: "m-field" }, h("label", {}, "ชื่อผู้ใช้"), username),
        h("div", { class: "m-field" }, h("label", {}, "รหัสผ่าน"), password),
        error,
        h("button", { class: "btn", type: "submit", style: "padding:15px;font-size:16px" }, "เข้าสู่ระบบ")
      )
    )
  );
}

async function route() {
  const hash = location.hash || "#/today";
  if (hash.startsWith("#/point/")) return renderCaptureForm(hash.slice("#/point/".length));
  return renderTodayList();
}

let routing = false;

async function start() {
  await initSync();
  // เข้าสู่ระบบใหม่หลังเซสชันหมดอายุจะเรียก start() ซ้ำ ต้องไม่ผูก listener ซ้อน
  if (!routing) {
    window.addEventListener("hashchange", route);
    routing = true;
  }
  await route();
  syncNow();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

window.addEventListener(SESSION_EXPIRED_EVENT, () => loginView());

if (api.token()) start();
else loginView();
```

- [ ] **Step 7: Verify the online path in the browser**

Resize the preview to the mobile preset and open `/m.html`. Log in as `field1` / `psru1234`.
Expected: "ยังไม่มีจุดที่ได้รับมอบหมายสำหรับวันนี้" until a plan exists. Create one for `ทีม A` on the desktop `#/plans` page, reload `/m.html`, and the assigned points appear.

Open a point, enter RSSI `-52`, attach a photo to "ภาพตำแหน่งติดตั้ง", and save.
Expected: it returns to the list, the sync bar goes to "ส่งครบแล้ว", and the point shows "ตรวจแล้ว". On the desktop, `#/points` shows that point as รอตรวจสอบ with 1/6 evidence, and its drawer shows the measurement table with the photo.

Then submit one with a defect title filled in and confirm it appears on `#/defects`, that "ปิดข้อบกพร่อง" as `field1` is not offered, and that as `committee` the close flow rejects it until a second inspection with a photo exists.

- [ ] **Step 8: Commit**

```bash
git add public/m.html public/css/mobile.css public/js/mobile
git commit -m "feat: add mobile field capture app with offline queueing"
```

---

## Task 22: Service worker and verified offline round trip

**Files:**
- Create: `public/sw.js`
- Modify: `src/app.ts` (serve the mobile app at `/m` as well as `/m.html`)
- Create: `docs/RUNBOOK.md`

**Interfaces:**
- Consumes: nothing
- Produces: a cached app shell so the field app loads with no network, plus an operator runbook

- [ ] **Step 1: Serve the mobile app at `/m` in `src/app.ts`**

The spec calls the field route `/m`; add it just above the static middleware in `createApp()` so technicians can type a short URL:

```ts
  app.get("/m", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "m.html")));
```

- [ ] **Step 2: Create `public/sw.js`**

```js
const CACHE = "psru-wifi-shell-v1";

const SHELL = [
  "/m",
  "/m.html",
  "/css/tokens.css",
  "/css/app.css",
  "/css/mobile.css",
  "/js/mobile/app.js",
  "/js/mobile/sync.js",
  "/js/mobile/todayList.js",
  "/js/mobile/captureForm.js",
  "/js/core/api.js",
  "/js/core/dom.js",
  "/js/core/format.js",
  "/js/core/labels.js",
  "/js/offline/idb.js",
  "/js/offline/outbox.js",
  "/js/offline/imageResize.js",
  "/fonts/IBMPlexSansThai-Regular.ttf",
  "/fonts/IBMPlexSansThai-SemiBold.ttf",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // คำขอ API ต้องไม่ถูกแคช เพราะผลตรวจต้องไปถึงเซิร์ฟเวอร์จริงเท่านั้น
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((hit) =>
      hit ||
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match("/m.html"))
    )
  );
});
```

API requests are deliberately excluded: a cached success response for `POST /inspections` would tell a technician their work was saved when it never left the phone.

- [ ] **Step 3: Verify the offline round trip**

This is the test that the whole design exists to pass. In the browser preview at `/m`, logged in as `field1` with a plan assigned:

1. Load `/m` once while online so the service worker installs. Confirm registration in the console: `navigator.serviceWorker.controller` is non-null after one reload.
2. Go offline: run `javascript_tool` with

```js
window.dispatchEvent(new Event("offline"));
```

then set the browser to offline mode, or stop the dev server with `preview_stop`.
3. Reload `/m`. Expected: the app still renders from cache with the last-known point list.
4. Record two inspections with photos. Expected: the sync bar reads "ค้างส่ง 2 รายการ" and each point shows the amber "ค้างส่ง" chip.
5. Restart the server (`preview_start`) and press "ส่งเดี๋ยวนี้". Expected: the bar becomes "ส่งครบแล้ว".
6. Press "ส่งเดี๋ยวนี้" again and check the server: `SELECT count(*) FROM "Inspection";` must not have increased.

```bash
"/c/Program Files/PostgreSQL/17/bin/psql.exe" -U psru -d psru_wifi -c "SELECT count(*) FROM \"Inspection\";"
```

7. On the desktop, open `#/points` and confirm both points now show their evidence counts and measurements.

If step 6 shows duplicates, stop and fix `submitInspection` — the append-only guarantee is broken.

- [ ] **Step 4: Create `docs/RUNBOOK.md`**

```markdown
# คู่มือปฏิบัติการ — ระบบสนับสนุนการตรวจรับ Wi-Fi 1,000 จุด

## การติดตั้งครั้งแรก

1. ติดตั้ง PostgreSQL 17 และสร้างฐานข้อมูล:
   `CREATE DATABASE psru_wifi OWNER psru;`
2. คัดลอก `.env.example` เป็น `.env` แล้วแก้ `DATABASE_URL` และ `JWT_SECRET`
3. `npm install`
4. `npx prisma db push && npx prisma generate`
5. `npm run db:seed`
6. `npm run build && npm start`

## บัญชีเริ่มต้น

| ชื่อผู้ใช้ | บทบาท | ใช้ทำอะไร |
|---|---|---|
| `admin` | ผู้ดูแลระบบ | ทุกอย่าง |
| `committee` | กรรมการตรวจรับ | ดูผล ปิดข้อบกพร่อง สร้างแผน ออกรายงาน |
| `field1`, `field2` | ช่างภาคสนาม | บันทึกผลตรวจผ่าน `/m.html` |

รหัสผ่านเริ่มต้นทุกบัญชีคือ `psru1234` — **ต้องเปลี่ยนก่อนใช้งานจริง**

## หน้าจอ

- เดสก์ท็อป: `http://<host>:3200/`
- มือถือภาคสนาม: `http://<host>:3200/m.html`

## เกณฑ์ TOR

ค่าเกณฑ์อยู่ในตาราง `Criteria` ตั้งค่าเริ่มต้นผ่าน `prisma/seed.ts`
ค่าที่ให้มาเป็นค่าตัวอย่าง **ต้องแก้ให้ตรงกับ TOR/สัญญาจริงก่อนใช้ตรวจรับ**

## การสำรองข้อมูล

ต้องสำรองสองส่วนเสมอ ทั้งคู่ ไม่ใช่อย่างใดอย่างหนึ่ง:

```bash
pg_dump -U psru psru_wifi > backup_$(date +%F).sql
tar czf uploads_$(date +%F).tar.gz uploads/
```

ไฟล์หลักฐานอยู่ใน `uploads/` และไม่ได้อยู่ในฐานข้อมูล — ถ้าสำรองแต่ฐานข้อมูล หลักฐานภาพจะหายทั้งหมด

## ข้อควรระวัง

- สถานะในระบบไม่ใช่ผลการตรวจรับทางกฎหมาย การตรวจรับเป็นอำนาจของคณะกรรมการ
- ผลตรวจเป็นบันทึกแบบเพิ่มอย่างเดียว การแก้ไขทำโดยลงตรวจรอบใหม่ ไม่ใช่แก้ของเดิม
- การนำเข้าข้อมูลเดิมจากต้นแบบ: `npm run import:csv -- <ไฟล์.csv>` (นำเข้าเฉพาะทะเบียนจุด ไม่สร้างผลตรวจย้อนหลัง)
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: every suite passes — health, schema, criteria, pointStatus, labels, auth, points, inspections, evidence, defects, plans, reports, importCsv, outbox, imageResize.

- [ ] **Step 6: Commit**

```bash
git add public/sw.js src/app.ts docs/RUNBOOK.md
git commit -m "feat: add service worker shell caching and operator runbook"
```

---

## Verification Checklist

Run before declaring the system done. Every line needs an actual observed result, not an assumption.

- [ ] `npm test` — all suites pass, no skipped tests
- [ ] `npm run build` — compiles with no TypeScript errors
- [ ] Log in as each of the three roles and confirm the visible actions differ (field sees no export buttons, no defect close)
- [ ] `#/points` pager reaches page 20 of 1,000 points and the last page has 50 rows
- [ ] Submit an inspection from `/m.html` while offline, restore the network, sync, and confirm exactly one row lands
- [ ] Press sync a second time and confirm `SELECT count(*) FROM "Inspection"` is unchanged
- [ ] Open a defect from the field app, try to close it as `field1` (must be refused), then close it as `committee` only after a retest with a photo
- [ ] Export the CSV and open it in Excel — Thai text is not garbled
- [ ] Generate the committee PDF — Thai renders, the signature block is present, and the disclaimer appears in the footer
- [ ] Confirm the disclaimer text is visible on `#/overview` and `#/reports`

