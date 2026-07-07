// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { createMerchantLedger } from "@/__tests__/fixtures/merchant-ledger";
import { POST as createRule } from "@/app/api/v1/rules/route";
import { GET as previewRule } from "@/app/api/v1/rules/preview/route";
import { closeFinanceDbForTests, replaceTellerLedgerInDb } from "@/lib/db/finance-db";

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

describe("rules preview API", () => {
  it("returns a 400 for a missing match value", async () => {
    useTempDb();
    const response = await previewRule(
      new NextRequest("http://localhost/api/v1/rules/preview?field=merchant_or_description&operator=contains")
    );
    expect(response.status).toBe(400);
  });

  it("returns a 400 for an invalid field or operator", async () => {
    useTempDb();
    const badField = await previewRule(
      new NextRequest("http://localhost/api/v1/rules/preview?field=amount&operator=contains&value=Starbucks")
    );
    expect(badField.status).toBe(400);

    const badOperator = await previewRule(
      new NextRequest("http://localhost/api/v1/rules/preview?field=merchant_or_description&operator=nope&value=Starbucks")
    );
    expect(badOperator.status).toBe(400);
  });

  it("matches the exact set the rules engine would touch (parity)", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createMerchantLedger());

    const response = await previewRule(
      new NextRequest(
        "http://localhost/api/v1/rules/preview?field=merchant_or_description&operator=contains&value=Starbucks"
      )
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ id: string }>; total_count: number };
    const previewIds = new Set(body.data.map((item) => item.id));

    expect(previewIds).toEqual(new Set(["txn_sb1", "txn_sb2", "txn_store"]));
    expect(body.total_count).toBe(3);

    // Create a real rule with the same spec targeting a category none of the
    // matched transactions currently have; the engine's apply count must equal
    // the preview match count, proving the preview reuses the engine matcher.
    const ruleResponse = await createRule(
      jsonRequest({
        category_id: "cat_food",
        match_field: "merchant_or_description",
        match_operator: "contains",
        name: "Starbucks rule",
        pattern: "Starbucks"
      })
    );
    expect(ruleResponse.status).toBe(200);
    const ruleBody = (await ruleResponse.json()) as { apply_result?: { transactionsUpdated?: number } };
    expect(ruleBody.apply_result?.transactionsUpdated).toBe(previewIds.size);
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/v1/rules", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
}

function useTempDb() {
  testDbPath = path.join(mkdtempSync(path.join(tmpdir(), "ai-finances-pglite-")), "db");
  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
  process.env.AI_FINANCES_PGLITE_DIR = testDbPath;
  process.env.AI_FINANCES_TELLER_BACKUP_PATH = path.join(path.dirname(testDbPath), "teller-ledger-backup.json");
}
