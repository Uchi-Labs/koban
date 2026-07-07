// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { POST as bulkCategorize } from "@/app/api/v1/transactions/bulk-categorize/route";
import { closeFinanceDbForTests, readFinanceDbSnapshot, replaceTellerLedgerInDb } from "@/lib/db/finance-db";
import { createMerchantLedger } from "@/__tests__/fixtures/merchant-ledger";

let testDbPath: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  if (testDbPath) {
    rmSync(testDbPath, { force: true, recursive: true });
    testDbPath = null;
  }
  delete process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV;
  delete process.env.AI_FINANCES_PGLITE_DIR;
  delete process.env.AI_FINANCES_TELLER_BACKUP_PATH;
});

describe("transactions bulk-categorize API", () => {
  it("rejects malformed bodies with a 400", async () => {
    useTempDb();

    expect((await bulkCategorize(rawRequest(""))).status).toBe(400);
    expect(
      (await bulkCategorize(jsonRequest({ field: "amount", match: "Starbucks", operator: "contains", category_id: "cat_food" })))
        .status
    ).toBe(400);
    expect(
      (await bulkCategorize(jsonRequest({ field: "merchant_or_description", match: "", operator: "contains", category_id: "cat_food" })))
        .status
    ).toBe(400);
  });

  it("rejects a missing or unknown category with a 400", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createMerchantLedger());

    expect(
      (await bulkCategorize(jsonRequest({ field: "merchant_or_description", match: "Starbucks", operator: "contains" }))).status
    ).toBe(400);
    expect(
      (
        await bulkCategorize(
          jsonRequest({
            category_id: "cat_does_not_exist",
            field: "merchant_or_description",
            match: "Starbucks",
            operator: "contains"
          })
        )
      ).status
    ).toBe(400);
  });

  it("recategorizes every matching transaction and leaves non-matches untouched", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createMerchantLedger());

    const response = await bulkCategorize(
      jsonRequest({
        category_id: "cat_shopping",
        field: "merchant_or_description",
        match: "Starbucks",
        operator: "contains"
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { transactions_updated: number; updated_transaction_ids: string[] };

    expect(new Set(body.updated_transaction_ids)).toEqual(new Set(["txn_sb1", "txn_sb2", "txn_store"]));
    expect(body.transactions_updated).toBe(3);

    const snapshot = await readFinanceDbSnapshot();
    const byId = new Map((snapshot?.transactions ?? []).map((transaction) => [transaction.id, transaction]));
    expect(byId.get("txn_sb1")?.categoryId).toBe("cat_shopping");
    expect(byId.get("txn_sb2")?.categoryId).toBe("cat_shopping");
    expect(byId.get("txn_store")?.categoryId).toBe("cat_shopping");
    expect(byId.get("txn_shell")?.categoryId).toBe("cat_other");
  });
});

function rawRequest(body: string): Request {
  return new Request("http://localhost/api/v1/transactions/bulk-categorize", {
    body,
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
}

function jsonRequest(body: Record<string, unknown>): Request {
  return rawRequest(JSON.stringify(body));
}

function useTempDb() {
  testDbPath = path.join(mkdtempSync(path.join(tmpdir(), "ai-finances-pglite-")), "db");
  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
  process.env.AI_FINANCES_PGLITE_DIR = testDbPath;
  process.env.AI_FINANCES_TELLER_BACKUP_PATH = path.join(path.dirname(testDbPath), "teller-ledger-backup.json");
}
