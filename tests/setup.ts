// Runs before any test file's own imports are evaluated. Must set DATABASE_URL
// here (not just in tests/helpers/db.ts) because every integration test file
// imports "../src/app" before "./helpers/db", and src/lib/prisma.ts constructs
// its PrismaClient singleton (bound to whatever DATABASE_URL is at that instant)
// as a side effect of that first import. Without this, the app's prisma client
// silently binds to the dev database from .env instead of the test database.
// Sourced from the environment so no real credential lives in the repo.
// Put TEST_DATABASE_URL in your local .env (gitignored); see .env.example.
import dotenv from "dotenv";
dotenv.config();

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/psru_wifi_test";
