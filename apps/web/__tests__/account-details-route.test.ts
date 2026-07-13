import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authHandler: vi.fn(),
  getSession: vi.fn(),
  getTellerAccountDetails: vi.fn(),
  storedState: undefined as string | undefined,
  syncQueue: Promise.resolve() as Promise<void>,
  withLockedSyncStateValue: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  betterAuthBasePath: "/api/better-auth",
  getBetterAuth: () => ({
    api: { getSession: mocks.getSession },
    handler: mocks.authHandler
  }),
  isHostedAuthMode: () => true
}));

vi.mock("@/lib/db/finance-db", () => ({
  withLockedSyncStateValue: mocks.withLockedSyncStateValue
}));

vi.mock("@/lib/demo-mode", () => ({
  isDemoModeEnabled: async () => false
}));

vi.mock("@/lib/finance-data", () => ({
  getFinanceData: async () => ({
    accounts: [{ id: "teller_account_1", providerConnectionId: "provider_1" }]
  })
}));

vi.mock("@/lib/teller-server", () => ({
  getTellerAccountDetails: mocks.getTellerAccountDetails,
  TellerSetupError: class TellerSetupError extends Error {}
}));

import { POST } from "@/app/api/v1/accounts/[accountId]/details/route";

const fixedNow = new Date("2026-07-12T12:00:00.000Z");
const originalBetterAuthSecret = process.env.BETTER_AUTH_SECRET;

function request(code = "123456") {
  return new Request("http://localhost/api/v1/accounts/teller_account_1/details", {
    body: JSON.stringify({ totp_code: code }),
    headers: {
      "content-type": "application/json",
      cookie: "better-auth.session_token=test-session"
    },
    method: "POST"
  });
}

function post(code?: string) {
  return POST(request(code), {
    params: Promise.resolve({ accountId: "teller_account_1" })
  });
}

describe("account details TOTP step-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    process.env.BETTER_AUTH_SECRET = "test-only-better-auth-secret";
    mocks.storedState = undefined;
    mocks.syncQueue = Promise.resolve();
    mocks.getSession.mockResolvedValue({ user: { id: "user_1" } });
    mocks.withLockedSyncStateValue.mockImplementation((
      _key: string,
      operation: (value: string | undefined) => Promise<{ result: unknown; value: string }>
    ) => {
      const run = mocks.syncQueue.then(async () => {
        const update = await operation(mocks.storedState);
        mocks.storedState = update.value;
        return update.result;
      });
      mocks.syncQueue = run.then(() => undefined, () => undefined);
      return run;
    });
    mocks.authHandler.mockImplementation(async () =>
      Response.json({ message: "Invalid two factor code" }, { status: 401 })
    );
    mocks.getTellerAccountDetails.mockResolvedValue({
      accountNumber: "account-number",
      routingNumbers: { ach: "routing-number" }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalBetterAuthSecret === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = originalBetterAuthSecret;
    }
  });

  it("locks the user for fifteen minutes on the fifth failed verification", async () => {
    const responses = [];

    for (let attempt = 0; attempt < 5; attempt += 1) {
      responses.push(await post(String(123_456 + attempt)));
    }

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 429]);
    expect(mocks.authHandler).toHaveBeenCalledTimes(5);
    expect(JSON.parse(mocks.storedState ?? "{}")).toMatchObject({
      failedAttempts: 5,
      lockedUntil: "2026-07-12T12:15:00.000Z"
    });
  });

  it("counts concurrent failures without losing updates", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, attempt) => post(String(222_220 + attempt)))
    );

    expect(responses.map((response) => response.status).sort()).toEqual([401, 401, 401, 401, 429]);
    expect(JSON.parse(mocks.storedState ?? "{}")).toMatchObject({
      failedAttempts: 5,
      lockedUntil: "2026-07-12T12:15:00.000Z"
    });
  });

  it("returns 429 without verifying a correct code while the user is locked", async () => {
    mocks.storedState = JSON.stringify({
      failedAttempts: 5,
      lockedUntil: "2026-07-12T12:15:00.000Z"
    });
    mocks.authHandler.mockResolvedValue(Response.json({ token: "verified" }));

    const response = await post();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(mocks.authHandler).not.toHaveBeenCalled();
    expect(mocks.getTellerAccountDetails).not.toHaveBeenCalled();
  });

  it("rejects reuse of an accepted code within the replay window", async () => {
    mocks.authHandler.mockImplementation(async () => Response.json({ token: "verified" }));

    const [firstResponse, replayResponse] = await Promise.all([
      post("654321"),
      post("654321")
    ]);

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(401);
    await expect(replayResponse.json()).resolves.toMatchObject({ error: "invalid_totp" });
    expect(mocks.authHandler).toHaveBeenCalledTimes(1);
    expect(mocks.getTellerAccountDetails).toHaveBeenCalledTimes(1);
  });

  it("resets failures and stores only a keyed hash after a successful verification", async () => {
    mocks.storedState = JSON.stringify({ failedAttempts: 4 });
    mocks.authHandler.mockResolvedValue(Response.json({ token: "verified" }));

    const response = await post("777777");
    const protectionState = JSON.parse(mocks.storedState ?? "{}");

    expect(response.status).toBe(200);
    expect(protectionState).toMatchObject({
      failedAttempts: 0,
      lastAcceptedAt: "2026-07-12T12:00:00.000Z"
    });
    expect(protectionState.lockedUntil).toBeUndefined();
    expect(protectionState.lastAcceptedCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(mocks.storedState).not.toContain("777777");
  });
});
