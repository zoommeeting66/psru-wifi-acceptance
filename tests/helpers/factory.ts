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
