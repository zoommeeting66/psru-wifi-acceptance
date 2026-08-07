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
