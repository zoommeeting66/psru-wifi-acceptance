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
