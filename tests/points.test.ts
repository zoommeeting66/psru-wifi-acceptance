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
