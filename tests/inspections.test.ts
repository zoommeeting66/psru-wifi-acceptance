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
