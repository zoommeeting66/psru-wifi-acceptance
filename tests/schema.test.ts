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
