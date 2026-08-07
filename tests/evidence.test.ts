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
