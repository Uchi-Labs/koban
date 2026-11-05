// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lineSplit } from "@/components/itemized-lines";
import { appCategories } from "@/lib/categories";
import {
  closeFinanceDbForTests,
  ensureExternalSourceCatalog,
  listCategories,
  listSourceItems,
  recordSourceSyncRun,
  setSourceItemLineCategory,
  type SourceItemInput
} from "@/lib/db/finance-db";
import { createDemoReceipts } from "@/lib/demo-receipts";
import { lineSplitToApi } from "@/lib/line-items-api";

let testDir: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  if (testDir) {
    rmSync(testDir, { force: true, recursive: true });
    testDir = null;
  }
  delete process.env.AI_FINANCES_PGLITE_DIR;
});

function useTempDb() {
  testDir = mkdtempSync(path.join(tmpdir(), "koban-split-"));
  process.env.AI_FINANCES_PGLITE_DIR = path.join(testDir, "db");
}

const costcoReceipt: SourceItemInput = {
  amount: 61.97,
  currency: "USD",
  externalId: "costco_1",
  id: "src_costco_1",
  kind: "receipt",
  lines: [
    { amount: 23.99, name: "Paper towels, 12 rolls", quantity: 1, unitPrice: 23.99 },
    { amount: 16.99, name: "Dog treats", quantity: 1, unitPrice: 16.99 },
    { amount: 20.99, name: "Rotisserie chicken", quantity: 1, unitPrice: 20.99 }
  ],
  merchantName: "Costco",
  occurredAt: "2026-10-12T19:30:00.000Z",
  sourceId: "source_gmail",
  summary: "From: Costco Wholesale. Your warehouse receipt.",
  title: "Costco warehouse receipt"
};

async function importReceipt(item: SourceItemInput) {
  await recordSourceSyncRun({
    finishedAt: "2026-10-13T00:00:01.000Z",
    items: [item],
    runStatus: "succeeded",
    sourceId: "source_gmail",
    sourceStatus: "connected",
    startedAt: "2026-10-13T00:00:00.000Z"
  });
}

describe("Groceries and Household", () => {
  it("are default categories split out of Food & Dining", async () => {
    expect(appCategories.find((category) => category.id === "cat_groceries")).toMatchObject({ emoji: "🛒", name: "Groceries" });
    expect(appCategories.find((category) => category.id === "cat_household")).toMatchObject({ emoji: "🧺", name: "Household" });
    expect(appCategories.find((category) => category.id === "cat_food")?.name).toBe("Food & Dining");

    useTempDb();
    const names = (await listCategories()).map((category) => category.name);
    expect(names).toEqual(expect.arrayContaining(["Food & Dining", "Groceries", "Household"]));
  });
});

describe("splitting a receipt's lines across categories", () => {
  it("files lines under categories and keeps the split through a re-import", async () => {
    useTempDb();
    await listCategories();
    await ensureExternalSourceCatalog([{ command: "gog", displayName: "Gmail receipts", id: "source_gmail", kind: "gmail", status: "connected" }]);
    await importReceipt(costcoReceipt);

    await setSourceItemLineCategory("src_costco_1", 0, "cat_household");
    await setSourceItemLineCategory("src_costco_1", 2, "cat_groceries");
    const lines = await setSourceItemLineCategory("src_costco_1", 1, "cat_groceries");
    expect(lines.map((line) => line.categoryId)).toEqual(["cat_household", "cat_groceries", "cat_groceries"]);

    await expect(setSourceItemLineCategory("src_costco_1", 9, "cat_groceries")).rejects.toThrow("No line 9");
    await expect(setSourceItemLineCategory("src_costco_1", 1, "cat_missing")).rejects.toThrow("No category");

    // A provider re-import replaces the lines; the user's split stays.
    await importReceipt(costcoReceipt);
    const [item] = await listSourceItems({ sourceId: "source_gmail" });
    expect(item.lines?.map((line) => line.categoryId)).toEqual(["cat_household", "cat_groceries", "cat_groceries"]);
    expect(lineSplitToApi(item.lines!)).toEqual([
      { amount: 37.98, category_id: "cat_groceries" },
      { amount: 23.99, category_id: "cat_household" }
    ]);

    // A changed line at that position does not inherit the old line's category.
    await importReceipt({ ...costcoReceipt, lines: [{ amount: 61.97, name: "Kirkland restock", quantity: 1 }] });
    const [changed] = await listSourceItems({ sourceId: "source_gmail" });
    expect(changed.lines?.[0].categoryId).toBeUndefined();
  });

  it("splits every demo Costco receipt across Groceries, Household and Pets", () => {
    const transactions = ["2026-09-06", "2026-10-04", "2026-11-01"].map((date, index) => ({
      accountId: "credit_visa",
      amount: -[212.4, 238.15, 189.77][index],
      categoryId: "cat_groceries",
      currency: "USD" as const,
      date,
      description: "Bulk groceries and household",
      id: `demo_txn_costco_${index}`,
      merchantName: "Costco",
      providerConnectionId: "p",
      reviewed: true,
      status: "posted" as const,
      tags: []
    }));
    const receipts = createDemoReceipts(transactions);
    const gmail = receipts.sources.find((source) => source.id === "source_gmail")!;
    const categoriesSeen = new Set<string>();

    for (const item of gmail.items) {
      const lines = item.lines!.map((line, position) => ({
        ...line,
        categoryId: receipts.lineCategories.find((split) => split.sourceItemId === item.id && split.position === position)?.categoryId
      }));
      expect(lines.every((line) => line.categoryId)).toBe(true);
      const split = lineSplit(lines);
      expect(split.reduce((total, part) => total + part.amount, 0)).toBeCloseTo(item.amount!, 2);
      for (const part of split) categoriesSeen.add(part.categoryId);
    }

    expect([...categoriesSeen].sort()).toEqual(["cat_custom_pets", "cat_groceries", "cat_household"]);
  });
});
