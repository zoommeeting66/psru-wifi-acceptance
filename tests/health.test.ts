import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { testPrisma, resetDb } from "./helpers/db";
import { makeUser, authHeader } from "./helpers/factory";

const app = createApp();

describe("health", () => {
  beforeEach(resetDb);
  afterAll(() => testPrisma.$disconnect());

  it("returns ok", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("returns 401 with Thai error for unauthenticated request to unknown api route", async () => {
    const res = await request(app).get("/api/v1/nope");
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 404 with Thai error for authenticated request to unknown api route", async () => {
    const user = await makeUser("FIELD");
    const res = await request(app).get("/api/v1/nope").set("authorization", authHeader(user));
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});
