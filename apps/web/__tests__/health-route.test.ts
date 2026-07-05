// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

afterEach(() => {
  delete process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV;
  delete process.env.DATABASE_URL;
});

describe("health route", () => {
  it("reports pglite when DATABASE_URL is unset", async () => {
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
    delete process.env.DATABASE_URL;

    const response = GET();

    await expect(response.json()).resolves.toEqual({ ok: true, db: "pglite" });
  });

  it("reports postgres when DATABASE_URL is set", async () => {
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
    process.env.DATABASE_URL = "postgres://localhost/ai_finances_test";

    const response = GET();

    await expect(response.json()).resolves.toEqual({ ok: true, db: "postgres" });
  });
});
