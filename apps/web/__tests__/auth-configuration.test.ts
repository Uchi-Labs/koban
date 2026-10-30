// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn(() => ({
    api: { getSession: vi.fn() },
    handler: vi.fn()
  }))
}));

vi.mock("better-auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("better-auth")>();
  return { ...original, betterAuth: mocks.betterAuth };
});

vi.mock("pg", () => ({
  Pool: class TestPool {}
}));

import { getBetterAuth, setBetterAuthForTests } from "@/lib/auth";

afterEach(() => {
  setBetterAuthForTests(null);
  vi.clearAllMocks();
});

describe("Better Auth configuration", () => {
  it("passes an explicitly supplied workspace secret to Better Auth", () => {
    getBetterAuth({
      BETTER_AUTH_SECRET: "workspace-auth-secret",
      DATABASE_URL: "postgres://workspace-database"
    });

    expect(mocks.betterAuth).toHaveBeenCalledWith(expect.objectContaining({
      secret: "workspace-auth-secret"
    }));
  });
});
