// @vitest-environment node

import type { Account, ProviderConnection, Transaction } from "@ai-finances/schema";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeFinanceDbForTests, readFinanceDbSnapshot, replaceTellerLedgerInDb } from "@/lib/db/finance-db";
import type { TellerLedger } from "@/lib/finance-data";
import { syncTellerData, testTellerAccounts, type StoredTellerEnrollment } from "@/lib/teller-server";

type HttpsRequestOptions = {
  cert?: Buffer;
  headers?: Record<string, string>;
  key?: Buffer;
  path?: string;
};

type TellerMockResponse = {
  body: unknown;
  statusCode?: number;
};

const httpsMock = vi.hoisted(() => ({
  respond: undefined as undefined | ((options: HttpsRequestOptions) => TellerMockResponse)
}));

vi.mock("node:https", () => ({
  request: (options: HttpsRequestOptions, callback: (response: MockHttpsResponse) => void) => {
    const requestListeners = new Map<string, Array<(error: Error) => void>>();
    const requestObject = {
      destroy: (error: Error) => {
        for (const listener of requestListeners.get("error") ?? []) {
          listener(error);
        }
      },
      end: () => {
        try {
          const response = httpsMock.respond?.(options) ?? { body: null };
          const responseListeners = new Map<string, Array<(chunk?: Buffer) => void>>();
          const responseObject = {
            statusCode: response.statusCode ?? 200,
            emitBody: () => {
              for (const listener of responseListeners.get("data") ?? []) {
                listener(Buffer.from(JSON.stringify(response.body)));
              }
              for (const listener of responseListeners.get("end") ?? []) {
                listener();
              }
            },
            on: (eventName: string, listener: (chunk?: Buffer) => void) => {
              responseListeners.set(eventName, [...(responseListeners.get(eventName) ?? []), listener]);
              return responseObject;
            }
          };
          callback(responseObject);
          responseObject.emitBody();
        } catch (error) {
          for (const listener of requestListeners.get("error") ?? []) {
            listener(error instanceof Error ? error : new Error("mock Teller request failed"));
          }
        }
      },
      on: (eventName: string, listener: (error: Error) => void) => {
        requestListeners.set(eventName, [...(requestListeners.get(eventName) ?? []), listener]);
        return requestObject;
      },
      setTimeout: () => requestObject
    };

    return requestObject;
  }
}));

interface MockHttpsResponse {
  statusCode: number;
  emitBody: () => void;
  on: (eventName: string, listener: (chunk?: Buffer) => void) => MockHttpsResponse;
}

let testRoot: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  if (testRoot) {
    rmSync(testRoot, { force: true, recursive: true });
    testRoot = null;
  }

  httpsMock.respond = undefined;
  delete process.env.AI_FINANCES_PGLITE_DIR;
  delete process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV;
  delete process.env.TELLER_API_VERSION;
  delete process.env.TELLER_ACCESS_TOKEN;
  delete process.env.TELLER_CERTIFICATE_B64;
  delete process.env.TELLER_CERTIFICATE_PATH;
  delete process.env.TELLER_ENROLLMENTS_B64;
  delete process.env.TELLER_PRIVATE_KEY_B64;
  delete process.env.TELLER_PRIVATE_KEY_PATH;
  delete process.env.TELLER_SYNC_START_DATE;
});

describe("syncTellerData", () => {
  it("replaces the local Teller ledger when every enrollment syncs", async () => {
    setupTellerTestEnv([createEnrollment("enroll_a", "Bank A"), createEnrollment("enroll_b", "Bank B")]);
    httpsMock.respond = createTellerResponder(new Map([
      ["token_enroll_a", createInstitutionFixture("a", "Bank A", "Checking A", "321.00")],
      ["token_enroll_b", createInstitutionFixture("b", "Bank B", "Checking B", "654.00")]
    ]));
    await replaceTellerLedgerInDb(createPriorLedger());

    const result = await syncTellerData();
    const snapshot = await readFinanceDbSnapshot();

    expect(result).toMatchObject({
      ok: true,
      accountCount: 2,
      transactionCount: 2,
      errors: []
    });
    expect(snapshot?.providerConnections).toEqual([
      expect.objectContaining({ id: "provider_teller_enroll_a", status: "connected" }),
      expect.objectContaining({ id: "provider_teller_enroll_b", status: "connected" })
    ]);
    expect(snapshot?.transactions.map((transaction) => transaction.id).sort()).toEqual(["teller_txn_a_new", "teller_txn_b_new"]);
    expect(snapshot?.transactions.some((transaction) => transaction.id === "teller_txn_b_prior")).toBe(false);
  }, 15_000);

  it("preserves prior rows for a failed enrollment while refreshing successful enrollments", async () => {
    setupTellerTestEnv([createEnrollment("enroll_a", "Bank A"), createEnrollment("enroll_b", "Bank B")]);
    httpsMock.respond = createTellerResponder(new Map([
      ["token_enroll_a", createInstitutionFixture("a", "Bank A", "Checking A", "321.00")]
    ]));
    await replaceTellerLedgerInDb(createPriorLedger());

    const result = await syncTellerData();
    const snapshot = await readFinanceDbSnapshot();
    const bankBConnection = snapshot?.providerConnections.find((connection) => connection.id === "provider_teller_enroll_b");
    const bankBBalanceSnapshot = snapshot?.balanceSnapshots?.find((balanceSnapshot) => balanceSnapshot.accountId === "teller_acct_b");

    expect(result).toMatchObject({
      ok: false,
      accountCount: 2,
      transactionCount: 2,
      errors: ["Bank B: mock missing fixture for token_enroll_b"]
    });
    expect(snapshot?.accounts.map((account) => account.id).sort()).toEqual(["teller_acct_a", "teller_acct_b"]);
    expect(snapshot?.accounts.find((account) => account.id === "teller_acct_a")).toMatchObject({
      currentBalance: 321,
      providerConnectionId: "provider_teller_enroll_a"
    });
    expect(snapshot?.accounts.find((account) => account.id === "teller_acct_b")).toMatchObject({
      currentBalance: 222,
      providerConnectionId: "provider_teller_enroll_b"
    });
    expect(snapshot?.transactions.map((transaction) => transaction.id).sort()).toEqual(["teller_txn_a_new", "teller_txn_b_prior"]);
    expect(bankBConnection).toMatchObject({
      status: "error",
      errorMessage: "Bank B: mock missing fixture for token_enroll_b"
    });
    expect(bankBBalanceSnapshot).toMatchObject({
      capturedAt: "2026-01-01T00:00:00.000Z",
      ledgerBalance: 222
    });
  }, 15_000);

  it("leaves the local Teller ledger untouched when every enrollment fails", async () => {
    setupTellerTestEnv([createEnrollment("enroll_a", "Bank A"), createEnrollment("enroll_b", "Bank B")]);
    httpsMock.respond = createTellerResponder(new Map());
    await replaceTellerLedgerInDb(createPriorLedger());
    const before = await readFinanceDbSnapshot();

    const result = await syncTellerData();
    const after = await readFinanceDbSnapshot();

    expect(result).toMatchObject({
      ok: false,
      accountCount: 2,
      transactionCount: 2,
      errors: [
        "Bank A: mock missing fixture for token_enroll_a",
        "Bank B: mock missing fixture for token_enroll_b"
      ]
    });
    expect(after).toEqual(before);
  }, 15_000);

  it("uses base64 Teller mTLS credentials without certificate files", async () => {
    const certSource = "test certificate";
    const keySource = "test private key";
    let seenOptions: HttpsRequestOptions | undefined;

    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
    process.env.TELLER_ACCESS_TOKEN = "token_for_test";
    process.env.TELLER_CERTIFICATE_B64 = Buffer.from(certSource, "utf8").toString("base64url");
    process.env.TELLER_PRIVATE_KEY_B64 = Buffer.from(keySource, "utf8").toString("base64url");
    process.env.TELLER_API_VERSION = "2020-10-12";
    httpsMock.respond = (options) => {
      seenOptions = options;
      return { body: [] };
    };

    await expect(testTellerAccounts()).resolves.toEqual({ ok: true, accountCount: 0 });
    expect(seenOptions?.cert?.toString("utf8")).toBe(certSource);
    expect(seenOptions?.key?.toString("utf8")).toBe(keySource);
  });
});

function setupTellerTestEnv(enrollments: StoredTellerEnrollment[]) {
  testRoot = mkdtempSync(path.join(tmpdir(), "ai-finances-teller-"));
  const certPath = path.join(testRoot, "teller-cert.pem");
  const keyPath = path.join(testRoot, "teller-key.pem");

  writeFileSync(certPath, "test certificate");
  writeFileSync(keyPath, "test private key");
  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
  process.env.AI_FINANCES_PGLITE_DIR = path.join(testRoot, "db");
  process.env.TELLER_CERTIFICATE_PATH = certPath;
  process.env.TELLER_PRIVATE_KEY_PATH = keyPath;
  process.env.TELLER_API_VERSION = "2020-10-12";
  process.env.TELLER_SYNC_START_DATE = "2026-01-01";
  process.env.TELLER_ENROLLMENTS_B64 = Buffer.from(JSON.stringify(enrollments), "utf8").toString("base64url");
}

function createEnrollment(enrollmentId: string, institutionName: string): StoredTellerEnrollment {
  return {
    accessToken: `token_${enrollmentId}`,
    enrollmentId,
    userId: `user_${enrollmentId}`,
    institutionName,
    environment: "development",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUpdatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function createTellerResponder(fixturesByToken: Map<string, InstitutionFixture>) {
  return (options: HttpsRequestOptions): TellerMockResponse => {
    const token = decodeToken(options.headers?.Authorization);
    const fixture = fixturesByToken.get(token);

    if (!fixture) {
      throw new Error(`mock missing fixture for ${token}`);
    }

    switch (options.path) {
      case "/accounts":
        return { body: [fixture.account] };
      case `/accounts/${fixture.account.id}/balances`:
        return { body: fixture.balance };
      case `/accounts/${fixture.account.id}/transactions?start_date=2026-01-01`:
        return { body: [fixture.transaction] };
      default:
        throw new Error(`mock missing path for ${options.path ?? "unknown path"}`);
    }
  };
}

interface InstitutionFixture {
  account: {
    id: string;
    enrollment_id: string;
    currency: string;
    institution: {
      id: string;
      name: string;
    };
    last_four: string;
    links: {
      balances: string;
      transactions: string;
    };
    name: string;
    status: "open";
    subtype: "checking";
    type: "depository";
  };
  balance: {
    account_id: string;
    available: string;
    ledger: string;
  };
  transaction: {
    account_id: string;
    amount: string;
    date: string;
    description: string;
    details: {
      category: string;
      counterparty: {
        name: string;
      };
      processing_status: string;
    };
    id: string;
    status: "posted";
    type: string;
  };
}

function createInstitutionFixture(
  suffix: string,
  institutionName: string,
  accountName: string,
  ledgerBalance: string
): InstitutionFixture {
  return {
    account: {
      id: `acct_${suffix}`,
      enrollment_id: `enroll_${suffix}`,
      currency: "usd",
      institution: {
        id: `inst_${suffix}`,
        name: institutionName
      },
      last_four: `000${suffix}`,
      links: {
        balances: `/accounts/acct_${suffix}/balances`,
        transactions: `/accounts/acct_${suffix}/transactions`
      },
      name: accountName,
      status: "open",
      subtype: "checking",
      type: "depository"
    },
    balance: {
      account_id: `acct_${suffix}`,
      available: ledgerBalance,
      ledger: ledgerBalance
    },
    transaction: {
      account_id: `acct_${suffix}`,
      amount: "-12.34",
      date: "2026-02-01",
      description: `CARD PURCHASE ${suffix.toUpperCase()}`,
      details: {
        category: "shopping",
        counterparty: {
          name: `Merchant ${suffix.toUpperCase()}`
        },
        processing_status: "complete"
      },
      id: `txn_${suffix}_new`,
      status: "posted",
      type: "card_payment"
    }
  };
}

function decodeToken(authorization: string | undefined) {
  if (!authorization?.startsWith("Basic ")) {
    return "";
  }

  return Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8").replace(/:$/, "");
}

function createPriorLedger(): TellerLedger {
  const providerConnections: ProviderConnection[] = [
    createProviderConnection("enroll_a", "Bank A"),
    createProviderConnection("enroll_b", "Bank B")
  ];
  const accounts: Account[] = [
    createAccount({
      balance: 111,
      id: "teller_acct_a",
      name: "Prior A",
      providerConnectionId: providerConnections[0].id
    }),
    createAccount({
      balance: 222,
      id: "teller_acct_b",
      name: "Prior B",
      providerConnectionId: providerConnections[1].id
    })
  ];
  const transactions: Transaction[] = [
    createTransaction({
      accountId: accounts[0].id,
      id: "teller_txn_a_prior",
      merchantName: "Prior Merchant A",
      providerConnectionId: providerConnections[0].id
    }),
    createTransaction({
      accountId: accounts[1].id,
      id: "teller_txn_b_prior",
      merchantName: "Prior Merchant B",
      providerConnectionId: providerConnections[1].id
    })
  ];

  return {
    source: "teller",
    version: 1,
    lastSyncedAt: "2026-01-01T00:00:00.000Z",
    syncStartDate: "2026-01-01",
    enrollmentCount: 2,
    accounts,
    transactions,
    providerConnections,
    syncSummary: {
      accountCount: accounts.length,
      transactionCount: transactions.length,
      errors: []
    }
  };
}

function createProviderConnection(enrollmentId: string, institutionName: string): ProviderConnection {
  return {
    id: `provider_teller_${enrollmentId}`,
    provider: "teller",
    displayName: `Teller - ${institutionName}`,
    status: "connected",
    configured: true,
    lastSyncedAt: "2026-01-01T00:00:00.000Z"
  };
}

function createAccount({
  balance,
  id,
  name,
  providerConnectionId
}: {
  balance: number;
  id: string;
  name: string;
  providerConnectionId: string;
}): Account {
  return {
    id,
    providerConnectionId,
    groupId: "group_cash",
    name,
    institutionName: "Prior Bank",
    type: "checking",
    currency: "USD",
    currentBalance: balance,
    availableBalance: balance,
    includedInNetWorth: true,
    lastUpdatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function createTransaction({
  accountId,
  id,
  merchantName,
  providerConnectionId
}: {
  accountId: string;
  id: string;
  merchantName: string;
  providerConnectionId: string;
}): Transaction {
  return {
    id,
    accountId,
    providerConnectionId,
    date: "2026-01-01",
    postedDate: "2026-01-01",
    merchantName,
    description: merchantName,
    amount: -10,
    currency: "USD",
    categoryId: "cat_other",
    status: "posted",
    reviewed: false,
    tags: ["teller"]
  };
}
