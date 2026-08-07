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
    expect(res.text.startsWith("﻿")).toBe(true);
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
