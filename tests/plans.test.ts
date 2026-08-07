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
