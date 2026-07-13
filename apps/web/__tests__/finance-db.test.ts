// @vitest-environment node

import type { Account, ProviderConnection, Transaction } from "@ai-finances/schema";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appSyncScheduleId,
  closeFinanceDbForTests,
  claimAppSyncSchedule,
  clearAppSyncScheduleClaim,
  applyCopilotHistoryImport,
  createFinancialGoal,
  createTransactionEvidenceLink,
  createTransactionContextNote,
  createTransactionVoiceNote,
  createTransactionRule,
  dismissEnrichmentSuggestion,
  ensureAppSyncSchedule,
  ensureExternalSourceCatalog,
  applyTransactionRules,
  applyEnrichmentSuggestion,
  getExternalSourceStates,
  getFinanceDbSummary,
  getFinanceDbWriteQueueForTests,
  getLatestAppSyncRun,
  getSemanticDocumentSummary,
  getSourceStoreSourceSummaries,
  getSourceStoreSummary,
  listCategories,
  listEvidenceLinks,
  listAppSyncRuns,
  listEnrichmentSuggestionItems,
  listEnrichmentSuggestions,
  listTransactionSemanticDocumentsForTests,
  listTagStyles,
  listTransactionRules,
  listTransactionEvidence,
  listSourceItems,
  readFinanceDbSnapshot,
  readSyncStateValue,
  recordAppSyncRun,
  recordAppSyncScheduleRun,
  refreshAppSyncScheduleClaim,
  recordSourceSyncRun,
  refreshSourceEvidenceMatches,
  replaceTellerLedgerInDb,
  resetLocalAppData,
  runInternalTransferPairMatching,
  semanticSearchFinanceResources,
  semanticSearchTransactions,
  setTransactionFinancialGoal,
  createCategory,
  deleteFinancialGoal,
  updateCategory,
  updateAppSyncSchedule,
  updateDbTransaction,
  updateTransactionEvidenceStatus,
  updateTransactionRule,
  upsertTagStyle,
  withLockedSyncStateValue
} from "@/lib/db/finance-db";
import { categoryColorPalette } from "@/lib/category-style";
import {
  generateEnrichmentSuggestions,
  getEffectiveLlmEnrichmentStatus,
  recordLlmProviderHealth
} from "@/lib/enrichment-runs";
import type { TellerLedger } from "@/lib/finance-data";
import { setEmbeddingFetchForTests } from "@/lib/embeddings";
import {
  exportTellerLedgerBackup,
  getFinanceData,
  getTellerLedgerBackupPath,
  importTellerLedgerBackup,
  writeTellerLedgerBackup
} from "@/lib/finance-data";
import { importSourceAdapterPayload } from "@/lib/source-adapters";

let testDbPath: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  if (testDbPath) {
    rmSync(testDbPath, { force: true, recursive: true });
    testDbPath = null;
  }
  delete process.env.AI_FINANCES_PGLITE_DIR;
  delete process.env.AI_FINANCES_TELLER_BACKUP_PATH;
  delete process.env.AI_FINANCES_LLM_BASE_URL;
  delete process.env.AI_FINANCES_LLM_MODEL;
  delete process.env.AI_FINANCES_LLM_PROVIDER;
  delete process.env.AI_FINANCES_LLM_REASONING_MODEL;
  delete process.env.AI_FINANCES_LLM_SIMPLE_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  delete process.env.VOYAGE_EMBEDDING_MODEL;
  setEmbeddingFetchForTests(undefined);
  vi.unstubAllGlobals();
});

describe("finance db", () => {
  it("lets only one runner claim a due sync schedule", async () => {
    useTempDb();
    await updateAppSyncSchedule({
      enabled: true,
      nextRunAt: "2026-05-31T01:00:00.000Z"
    });

    await expect(
      claimAppSyncSchedule(appSyncScheduleId, "runner_a", "2026-05-31T02:00:00.000Z")
    ).resolves.toBe(true);
    await expect(
      claimAppSyncSchedule(appSyncScheduleId, "runner_b", "2026-05-31T02:00:01.000Z")
    ).resolves.toBe(false);
  });

  it("lets a runner steal a sync schedule claim after fifteen minutes", async () => {
    useTempDb();
    await updateAppSyncSchedule({
      enabled: true,
      nextRunAt: "2026-05-31T01:00:00.000Z"
    });

    await expect(
      claimAppSyncSchedule(appSyncScheduleId, "runner_a", "2026-05-31T02:00:00.000Z")
    ).resolves.toBe(true);
    await expect(
      claimAppSyncSchedule(appSyncScheduleId, "runner_b", "2026-05-31T02:16:00.000Z")
    ).resolves.toBe(true);
  });

  it("clears a failed runner's sync schedule claim", async () => {
    useTempDb();
    await updateAppSyncSchedule({
      enabled: true,
      nextRunAt: "2026-05-31T01:00:00.000Z"
    });
    await claimAppSyncSchedule(appSyncScheduleId, "runner_a", "2026-05-31T02:00:00.000Z");

    await clearAppSyncScheduleClaim(appSyncScheduleId, "runner_a", "2026-05-31T02:01:00.000Z");

    await expect(
      claimAppSyncSchedule(appSyncScheduleId, "runner_b", "2026-05-31T02:01:01.000Z")
    ).resolves.toBe(true);
  });

  it("keeps a live sync schedule claim fresh while its runner is active", async () => {
    useTempDb();
    await updateAppSyncSchedule({
      enabled: true,
      nextRunAt: "2026-05-31T01:00:00.000Z"
    });
    await claimAppSyncSchedule(appSyncScheduleId, "runner_a", "2026-05-31T02:00:00.000Z");

    await expect(
      refreshAppSyncScheduleClaim(appSyncScheduleId, "runner_a", "2026-05-31T02:10:00.000Z")
    ).resolves.toBe(true);
    await expect(
      claimAppSyncSchedule(appSyncScheduleId, "runner_b", "2026-05-31T02:20:00.000Z")
    ).resolves.toBe(false);
    await expect(
      claimAppSyncSchedule(appSyncScheduleId, "runner_b", "2026-05-31T02:26:00.000Z")
    ).resolves.toBe(true);
  });

  it("serializes concurrent sync-state read-modify-write operations", async () => {
    useTempDb();

    const counts = await Promise.all(Array.from({ length: 5 }, () =>
      withLockedSyncStateValue("test_atomic_counter", async (storedValue) => {
        const count = Number.parseInt(storedValue ?? "0", 10) + 1;
        return { result: count, value: String(count) };
      })
    ));

    expect(counts).toEqual([1, 2, 3, 4, 5]);
    await expect(readSyncStateValue("test_atomic_counter")).resolves.toBe("5");
  });

  it("recovers when a previous local PGlite process left a stale postmaster pid file", async () => {
    useTempDb();
    rmSync(testDbPath!, { force: true, recursive: true });
    mkdirForTestDb();
    writeFileSync(path.join(testDbPath!, "postmaster.pid"), "-42\n/pglite/data\n1780246785\n5432\n\n\n");

    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));

    const snapshot = await readFinanceDbSnapshot();
    expect(snapshot?.transactions).toHaveLength(1);
  }, 15_000);

  it("stores Teller snapshots and preserves user transaction overlays across resync", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));

    const updated = await updateDbTransaction("txn_1", {
      categoryId: "cat_travel",
      notes: "Dinner on the Denver trip.",
      reviewed: true,
      tags: ["trip", "trip", " dinner "]
    });

    expect(updated).toMatchObject({
      categoryId: "cat_travel",
      notes: "Dinner on the Denver trip.",
      reviewed: true,
      tags: ["trip", "dinner"]
    });

    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -18.5, providerCategoryId: "cat_food" }));

    const searchResults = await semanticSearchTransactions("Denver dinner trip", 5);
    const snapshot = await readFinanceDbSnapshot();
    const semanticSummary = await getSemanticDocumentSummary();
    const transaction = snapshot?.transactions.find((candidate) => candidate.id === "txn_1");

    expect(snapshot?.accounts).toHaveLength(1);
    expect(snapshot?.providerConnections).toHaveLength(1);
    expect(semanticSummary).toMatchObject({
      transactionEmbeddingCount: 1,
      staleDocumentCount: 0,
      transactionDocumentCount: 1
    });
    expect(searchResults[0]).toMatchObject({
      resourceId: "txn_1",
      resourceType: "transaction",
      transaction: {
        id: "txn_1"
      }
    });
    expect(transaction).toMatchObject({
      amount: -18.5,
      categoryId: "cat_travel",
      notes: "Dinner on the Denver trip.",
      reviewed: true,
      tags: ["trip", "dinner"]
    });
  }, 15_000);

  it("clears transaction goal assignments when deleting a financial goal", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));

    const goal = await createFinancialGoal({ name: "Emergency fund", targetAmountMinor: 500_00 });
    await setTransactionFinancialGoal("txn_1", goal.id);

    const assignedSnapshot = await readFinanceDbSnapshot();
    expect(assignedSnapshot?.transactions.find((transaction) => transaction.id === "txn_1")).toMatchObject({
      financialGoalId: goal.id
    });

    await deleteFinancialGoal(goal.id);

    const clearedSnapshot = await readFinanceDbSnapshot();
    expect(clearedSnapshot?.transactions).toHaveLength(1);
    expect(clearedSnapshot?.transactions.find((transaction) => transaction.id === "txn_1")?.financialGoalId).toBeUndefined();
  }, 15_000);

  it("clears paired transaction links when a ledger replace prunes the counterpart", async () => {
    useTempDb();
    const ledger = createTransferPairLedgerForPruneTest();
    await replaceTellerLedgerInDb(ledger);

    const pairSummary = await runInternalTransferPairMatching();
    const pairedSnapshot = await readFinanceDbSnapshot();
    const pairedById = new Map((pairedSnapshot?.transactions ?? []).map((transaction) => [transaction.id, transaction]));

    expect(pairSummary.linkedPairs).toBeGreaterThanOrEqual(1);
    expect(pairedById.get("txn_checking_payment")).toMatchObject({
      pairedTransactionId: "txn_card_payment"
    });
    expect(pairedById.get("txn_card_payment")).toMatchObject({
      pairedTransactionId: "txn_checking_payment"
    });

    await replaceTellerLedgerInDb({
      ...ledger,
      transactions: ledger.transactions.filter((transaction) => transaction.id !== "txn_card_payment"),
      syncSummary: {
        ...ledger.syncSummary,
        transactionCount: ledger.transactions.length - 1
      }
    });

    const prunedSnapshot = await readFinanceDbSnapshot();
    const prunedById = new Map((prunedSnapshot?.transactions ?? []).map((transaction) => [transaction.id, transaction]));

    expect(prunedById.has("txn_card_payment")).toBe(false);
    expect(prunedById.get("txn_checking_payment")?.pairedTransactionId).toBeUndefined();
  }, 15_000);

  it("renames categories without changing stable category ids", async () => {
    useTempDb();
    const food = (await listCategories()).find((category) => category.id === "cat_food");

    expect(food).toBeDefined();

    const renamed = await updateCategory("cat_food", { name: "Groceries & Dining" });
    const categories = await listCategories();

    expect(renamed).toMatchObject({
      id: "cat_food",
      name: "Groceries & Dining"
    });
    expect(categories.find((category) => category.id === "cat_food")).toMatchObject({
      id: "cat_food",
      name: "Groceries & Dining"
    });
  });

  it("round-trips tag registry colors without migrating transaction tag arrays", async () => {
    useTempDb();
    const color = categoryColorPalette[3];

    await upsertTagStyle("trip", color);
    await upsertTagStyle("uncategorized", null);

    expect(await listTagStyles()).toEqual([
      expect.objectContaining({
        color,
        kind: "user",
        name: "trip"
      }),
      expect.objectContaining({
        color: undefined,
        kind: "user",
        name: "uncategorized"
      })
    ]);
  });

  it("classifies tag registry entries as 'source' for provider-shaped names and 'user' otherwise", async () => {
    useTempDb();

    const bareAdapterNames = await Promise.all(
      ["simplefin", "plaid", "teller", "snaptrade", "financekit"].map((name) => upsertTagStyle(name))
    );
    const namespaced = await upsertTagStyle("teller:card_payment");
    const copilotTags = await Promise.all(
      ["copilot:cat:Restaurants", "copilot:tag:Sapiex", "copilot:amazon"].map((name) => upsertTagStyle(name))
    );
    const humanTags = await Promise.all(["Boston Trip", "Sapiex", "uncategorized"].map((name) => upsertTagStyle(name)));

    for (const style of bareAdapterNames) {
      expect(style).toMatchObject({ kind: "source" });
    }
    expect(namespaced).toMatchObject({ kind: "source", name: "teller:card_payment" });
    for (const style of copilotTags) {
      expect(style).toMatchObject({ kind: "source" });
    }
    for (const style of humanTags) {
      expect(style).toMatchObject({ kind: "user" });
    }
  });

  it("auto-registers sync-written provider tags as kind 'source' without an explicit tag-color call", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));

    const styles = await listTagStyles();
    const tellerStyle = styles.find((style) => style.name === "teller");

    expect(tellerStyle).toMatchObject({ kind: "source", name: "teller" });
  });

  it("applies Copilot history through the DB queue and preserves overlays on rerun", async () => {
    useTempDb();
    const providerConnection = {
      configured: true,
      displayName: "Copilot Money Import",
      id: "provider_copilot_import",
      lastSyncedAt: "2026-07-11T18:00:00.000Z",
      provider: "copilot",
      status: "connected"
    } satisfies ProviderConnection;
    const account = {
      currency: "USD",
      currentBalance: -50,
      groupId: "group_credit",
      id: "copilot_acct_old",
      includedInNetWorth: false,
      institutionName: "Old Bank",
      lastUpdatedAt: "2026-07-10T00:00:00.000Z",
      mask: "1234",
      name: "Old Card",
      providerConnectionId: providerConnection.id,
      type: "credit_card"
    } satisfies Account;
    const transaction = {
      accountId: account.id,
      amount: -25,
      categoryId: "cat_other",
      currency: "USD",
      date: "2026-07-10",
      description: "DINNER",
      id: "copilot_txn_old",
      merchantName: "Dinner",
      notes: "Copilot note",
      postedDate: "2026-07-10",
      providerConnectionId: providerConnection.id,
      reviewed: false,
      status: "posted",
      tags: ["copilot:cat:Restaurants"]
    } satisfies Transaction;
    const input = {
      accounts: [account],
      balanceSnapshots: [
        {
          accountId: account.id,
          asOfDate: "2026-07-10",
          capturedAt: "2026-07-10T00:00:00.000Z",
          currency: "USD",
          id: "copilot_bal_old_2026-07-10",
          ledgerBalance: -50,
          source: "copilot"
        }
      ],
      providerConnection,
      transactions: [transaction]
    };

    await applyCopilotHistoryImport(input);
    await updateDbTransaction(transaction.id, {
      categoryId: "cat_food",
      notes: "Koban edit",
      reviewed: true,
      tags: ["favorite"]
    });
    await applyCopilotHistoryImport(input);

    const snapshot = await readFinanceDbSnapshot();
    expect(snapshot?.accounts.find((candidate) => candidate.id === account.id)).toMatchObject({
      currentBalance: -50,
      includedInNetWorth: false
    });
    expect(snapshot?.transactions.find((candidate) => candidate.id === transaction.id)).toMatchObject({
      categoryId: "cat_food",
      notes: "Koban edit",
      reviewed: true,
      tags: ["favorite"]
    });
    expect((await listTagStyles()).find((style) => style.name === "copilot:cat:Restaurants")).toMatchObject({
      kind: "source"
    });
  });

  it("auto-registers user-edited transaction tags as kind 'user'", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));

    await updateDbTransaction("txn_1", { tags: ["Boston Trip"] });

    const styles = await listTagStyles();
    const tripStyle = styles.find((style) => style.name === "Boston Trip");
    // The overwritten "teller" tag no longer sits on the transaction, but its
    // registry row (registered as 'source' the moment the sync wrote it) is
    // untouched — registry rows are never deleted when a tag falls off a row.
    const tellerStyle = styles.find((style) => style.name === "teller");

    expect(tripStyle).toMatchObject({ kind: "user", name: "Boston Trip" });
    expect(tellerStyle).toMatchObject({ kind: "source", name: "teller" });
  });

  it("registers rule-applied tags as kind 'user' (rules express user intent)", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -24.2, providerCategoryId: "cat_other" }));

    await createTransactionRule({
      categoryId: "cat_food",
      markReviewed: true,
      matchField: "merchant_or_description",
      matchOperator: "contains",
      name: "Dinner place food",
      pattern: "Dinner Place",
      tags: ["roadtrip"]
    });

    const styles = await listTagStyles();
    const ruleTagStyle = styles.find((style) => style.name === "roadtrip");

    expect(ruleTagStyle).toMatchObject({ kind: "user", name: "roadtrip" });
  });

  // Regression coverage for the category-color trust boundary: `normalizeRegistryColor`
  // used to accept ONLY the 12 categoryColorPalette tokens (any other value, including
  // everything the BloomColorPicker produces, was silently dropped and the previous
  // color kept). It now validates against `isValidCssColor` — a structural allowlist for
  // hex/rgb/hsl/oklch/oklab shapes — so custom picker colors persist exactly, while
  // hostile/malformed strings are explicitly rejected instead of silently discarded.
  it("persists a custom hex color exactly on category create and update", async () => {
    useTempDb();

    const created = await createCategory({ color: "#8B5CF6", name: "Hobbies" });
    expect(created.color).toBe("#8B5CF6");

    const categories = await listCategories();
    expect(categories.find((category) => category.id === created.id)).toMatchObject({ color: "#8B5CF6" });

    const updated = await updateCategory(created.id, { color: "#10b981" });
    expect(updated?.color).toBe("#10b981");
    expect((await listCategories()).find((category) => category.id === created.id)).toMatchObject({
      color: "#10b981"
    });
  });

  it("persists a custom oklch() color exactly on category create", async () => {
    useTempDb();

    const created = await createCategory({ color: "oklch(0.6 0.2 45)", name: "Travel Fund" });
    expect(created.color).toBe("oklch(0.6 0.2 45)");
    expect((await listCategories()).find((category) => category.id === created.id)).toMatchObject({
      color: "oklch(0.6 0.2 45)"
    });
  });

  it("still accepts categoryColorPalette tokens on category create", async () => {
    useTempDb();

    const paletteColor = categoryColorPalette[5];
    const created = await createCategory({ color: paletteColor, name: "Subscriptions" });
    expect(created.color).toBe(paletteColor);
  });

  it("rejects a hostile color value on category create and update instead of silently discarding it", async () => {
    useTempDb();

    await expect(createCategory({ color: "red;background:url(x)", name: "Bad Color" })).rejects.toThrow(
      /invalid category color/i
    );

    const existing = await createCategory({ color: "#123456", name: "Good Category" });
    await expect(updateCategory(existing.id, { color: "var(--foreground)" })).rejects.toThrow(
      /invalid category color/i
    );

    // Rejection must not have mutated the stored color.
    expect((await listCategories()).find((category) => category.id === existing.id)).toMatchObject({
      color: "#123456"
    });
  });

  it("round-trips a custom hex color on the tag registry too", async () => {
    useTempDb();

    await upsertTagStyle("groceries", "#8B5CF6");
    expect(await listTagStyles()).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: "#8B5CF6", name: "groceries" })])
    );

    // Tag registry writes intentionally were NOT switched to the throwing
    // `assertValidRegistryColorInput` (out of scope for this fix — see
    // normalizeRegistryColor in lib/db/finance-db.ts), so they keep the
    // pre-existing silent-drop behavior for invalid values: the shared
    // `isValidCssColor` allowlist still rejects the shape, it's just discarded
    // instead of throwing here.
    const afterHostileWrite = await upsertTagStyle("groceries", "javascript:alert(1)");
    expect(afterHostileWrite.color).toBeUndefined();
  });

  it("rebuilds semantic embeddings when the active embedding model changes", async () => {
    useTempDb();
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
    process.env.VOYAGE_API_KEY = "test-voyage-key";
    const voyageCalls: Array<{ input: string[]; inputType?: string; model?: string }> = [];

    setEmbeddingFetchForTests(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input?: string[];
        input_type?: string;
        model?: string;
      };
      const input = body.input ?? [];
      voyageCalls.push({
        input,
        inputType: body.input_type,
        model: body.model
      });

      return new Response(
        JSON.stringify({
          data: input.map((_value, index) => ({
            embedding: Array.from({ length: 1024 }, (_unused, dimension) => (dimension === index % 1024 ? 1 : 0))
          })),
          usage: { total_tokens: input.length }
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200
        }
      );
    });

    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));

    const voyageResults = await semanticSearchTransactions("Denver dinner trip", 5);
    const voyageSummary = await getSemanticDocumentSummary();

    expect(voyageResults[0]).toMatchObject({
      resourceId: "txn_1",
      resourceType: "transaction"
    });
    expect(voyageSummary.transactionEmbeddingCount).toBe(1);
    expect(voyageCalls.map((call) => call.inputType)).toEqual(["document", "query"]);
    expect(voyageCalls.every((call) => call.model === "voyage-4-large")).toBe(true);

    delete process.env.VOYAGE_API_KEY;
    voyageCalls.length = 0;

    const localResults = await semanticSearchTransactions("Denver dinner trip", 5);
    const localSummary = await getSemanticDocumentSummary();

    expect(localResults[0]).toMatchObject({
      resourceId: "txn_1",
      resourceType: "transaction"
    });
    expect(localSummary).toMatchObject({
      staleDocumentCount: 0,
      transactionDocumentCount: 1,
      transactionEmbeddingCount: 1
    });
    expect(voyageCalls).toHaveLength(0);
  }, 15_000);

  it("rewrites only changed transaction semantic documents during teller resync", async () => {
    useTempDb();
    const ledger = createRepeatedMerchantLedger();

    await replaceTellerLedgerInDb(ledger);
    const firstDocuments = await listTransactionSemanticDocumentsForTests();

    expect(firstDocuments).toHaveLength(3);

    await waitForClockTick();
    await replaceTellerLedgerInDb(ledger);
    const secondDocuments = await listTransactionSemanticDocumentsForTests();

    expect(documentsByResourceId(secondDocuments)).toEqual(documentsByResourceId(firstDocuments));

    const changedLedger = {
      ...ledger,
      transactions: ledger.transactions.map((transaction) =>
        transaction.id === "txn_2"
          ? {
              ...transaction,
              description: "ADVISOR COFFEE",
              merchantName: "Advisor Coffee"
            }
          : transaction
      )
    } satisfies TellerLedger;

    await waitForClockTick();
    await replaceTellerLedgerInDb(changedLedger);
    const changedDocuments = documentsByResourceId(await listTransactionSemanticDocumentsForTests());
    const firstDocumentsById = documentsByResourceId(firstDocuments);

    expect(changedDocuments.get("txn_1")).toEqual(firstDocumentsById.get("txn_1"));
    expect(changedDocuments.get("txn_3")).toEqual(firstDocumentsById.get("txn_3"));
    expect(changedDocuments.get("txn_2")?.bodyHash).not.toBe(firstDocumentsById.get("txn_2")?.bodyHash);
    expect(changedDocuments.get("txn_2")?.updatedAt).not.toBe(firstDocumentsById.get("txn_2")?.updatedAt);

    const searchResults = await semanticSearchTransactions("advisor coffee", 5);
    expect(searchResults[0]).toMatchObject({
      resourceId: "txn_2",
      resourceType: "transaction"
    });
  }, 15_000);

  it("prunes transaction semantic documents for removed and empty teller ledgers", async () => {
    useTempDb();
    const ledger = createRepeatedMerchantLedger();

    await replaceTellerLedgerInDb(ledger);
    expect(await listTransactionSemanticDocumentsForTests()).toHaveLength(3);

    await replaceTellerLedgerInDb({
      ...ledger,
      transactions: [ledger.transactions[0]],
      syncSummary: {
        ...ledger.syncSummary,
        transactionCount: 1
      }
    });
    expect((await listTransactionSemanticDocumentsForTests()).map((document) => document.resourceId)).toEqual([
      "txn_1"
    ]);

    await replaceTellerLedgerInDb({
      ...ledger,
      transactions: [],
      syncSummary: {
        ...ledger.syncSummary,
        transactionCount: 0
      }
    });
    expect(await listTransactionSemanticDocumentsForTests()).toEqual([]);
  }, 15_000);

  it("lets provider-inferred transfer categories repair untouched Other overlays on resync", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({
      description: "AMERICAN EXPRESS ACH PMT A8676 WEB ID: 9493560001",
      merchantName: "AMERICAN EXPRESS",
      providerCategoryId: "cat_other",
      transactionAmount: -3781.31
    }));

    await replaceTellerLedgerInDb(createLedger({
      description: "AMERICAN EXPRESS ACH PMT A8676 WEB ID: 9493560001",
      merchantName: "AMERICAN EXPRESS",
      providerCategoryId: "cat_transfer",
      transactionAmount: -3781.31
    }));

    const snapshot = await readFinanceDbSnapshot();
    expect(snapshot?.transactions[0]).toMatchObject({
      categoryId: "cat_transfer",
      reviewed: false
    });
  }, 15_000);

  it("lets grocery merchant repair untouched provider category noise on resync", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({
      description: "IC* INSTACART 888-246-7822",
      merchantName: "INSTACART",
      providerCategoryId: "cat_software",
      transactionAmount: -59.49
    }));

    await replaceTellerLedgerInDb(createLedger({
      description: "IC* INSTACART 888-246-7822",
      merchantName: "INSTACART",
      providerCategoryId: "cat_food",
      transactionAmount: -59.49
    }));

    const snapshot = await readFinanceDbSnapshot();
    expect(snapshot?.transactions[0]).toMatchObject({
      categoryId: "cat_food",
      reviewed: false
    });
  }, 15_000);

  it("lets transfer patterns repair untouched non-transfer provider category noise on resync", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({
      description: "REAL TIME PAYMENT CREDIT RECD FROM ABA/CONTR BNK FROM: XOOM, A PAYPAL SERVICE",
      merchantName: "XOOM",
      providerCategoryId: "cat_software",
      transactionAmount: 0.01
    }));

    await replaceTellerLedgerInDb(createLedger({
      description: "REAL TIME PAYMENT CREDIT RECD FROM ABA/CONTR BNK FROM: XOOM, A PAYPAL SERVICE",
      merchantName: "XOOM",
      providerCategoryId: "cat_transfer",
      transactionAmount: 0.01
    }));

    const snapshot = await readFinanceDbSnapshot();
    expect(snapshot?.transactions[0]).toMatchObject({
      categoryId: "cat_transfer",
      reviewed: false
    });
  }, 15_000);

  it("normalizes Teller amount signs when replacing the stored ledger", async () => {
    useTempDb();
    const ledger = createLedger({ transactionAmount: 42.12, providerCategoryId: "cat_other" });
    const creditCardLedger = {
      ...ledger,
      accounts: [
        {
          ...ledger.accounts[0],
          groupId: "group_credit",
          type: "credit_card"
        } satisfies Account
      ]
    };

    await replaceTellerLedgerInDb(creditCardLedger);

    const snapshot = await readFinanceDbSnapshot();
    const semanticSummary = await getSemanticDocumentSummary();

    expect(snapshot?.normalization).toEqual({ amountSignConvention: "internal_v1" });
    expect(snapshot?.transactions[0]).toMatchObject({
      amount: -42.12,
      id: "txn_1"
    });
    expect(semanticSummary).toMatchObject({
      staleDocumentCount: 0,
      transactionDocumentCount: 1
    });
  }, 15_000);

  it("reads finance data without enqueueing write-side upkeep", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -24.2, providerCategoryId: "cat_other" }));

    const writeQueueBeforeRead = getFinanceDbWriteQueueForTests();
    const data = await getFinanceData();

    expect(data).toMatchObject({
      source: "teller",
      transactions: [{ id: "txn_1" }]
    });
    expect(getFinanceDbWriteQueueForTests()).toBe(writeQueueBeforeRead);
  }, 15_000);

  it("summarizes finance database status from counts without materializing a snapshot", async () => {
    useTempDb();

    await expect(getFinanceDbSummary()).resolves.toEqual({
      lastSyncedAt: undefined,
      storedAccountCount: 0,
      storedTransactionCount: 0
    });

    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -24.2, providerCategoryId: "cat_food" }));

    await expect(getFinanceDbSummary()).resolves.toEqual({
      lastSyncedAt: "2026-05-31T00:00:00.000Z",
      storedAccountCount: 1,
      storedTransactionCount: 1
    });
  }, 15_000);

  it("records external source sync runs and source items", async () => {
    useTempDb();
    await ensureExternalSourceCatalog([
      {
        command: "instacart-pp-cli",
        displayName: "Instacart groceries",
        id: "source_instacart",
        kind: "instacart",
        status: "stale"
      }
    ]);

    const run = await recordSourceSyncRun({
      finishedAt: "2026-05-31T01:00:01.000Z",
      items: [
        {
          currency: "USD",
          externalId: "item_1",
          id: "src_item_1",
          kind: "grocery_order",
          merchantName: "costco",
          occurredAt: "2026-05-01T12:00:00.000Z",
          sourceId: "source_instacart",
          summary: "Retailer: costco.",
          title: "Organic Bananas"
        }
      ],
      runStatus: "succeeded",
      sourceId: "source_instacart",
      sourceStatus: "connected",
      startedAt: "2026-05-31T01:00:00.000Z"
    });
    const summary = await getSourceStoreSummary();
    const sourceSummaries = await getSourceStoreSourceSummaries();
    const state = (await getExternalSourceStates()).get("source_instacart");
    const sourceItems = await listSourceItems({ sourceId: "source_instacart" });
    const filteredSourceItems = await listSourceItems({ query: "bananas", sourceId: "source_instacart" });
    const searchResults = await semanticSearchFinanceResources("organic bananas costco", 5);
    const semanticSummary = await getSemanticDocumentSummary();

    expect(run).toMatchObject({
      itemsSeen: 1,
      itemsWritten: 1,
      runStatus: "succeeded",
      sourceStatus: "connected"
    });
    expect(summary).toMatchObject({
      externalSourceCount: 1,
      sourceItemCount: 1
    });
    expect(sourceSummaries.get("source_instacart")).toMatchObject({
      evidenceLinkCount: 0,
      sourceItemCount: 1
    });
    expect(sourceItems[0]).toMatchObject({
      externalId: "item_1",
      kind: "grocery_order",
      merchantName: "costco",
      title: "Organic Bananas"
    });
    expect(filteredSourceItems).toHaveLength(1);
    expect(searchResults[0]).toMatchObject({
      resourceId: "src_item_1",
      resourceType: "source_item",
      sourceItem: {
        kind: "grocery_order",
        title: "Organic Bananas"
      }
    });
    expect(semanticSummary).toMatchObject({
      sourceItemDocumentCount: 1,
      sourceItemEmbeddingCount: 1
    });
    expect(state).toMatchObject({
      lastSyncedAt: "2026-05-31T01:00:01.000Z",
      status: "connected"
    });
  });

  it("drops invalid source item currencies before storage", async () => {
    useTempDb();
    await ensureExternalSourceCatalog([
      {
        command: "amazon-orders",
        displayName: "Amazon orders",
        id: "source_amazon_orders",
        kind: "amazon_orders",
        status: "stale"
      }
    ]);

    await recordSourceSyncRun({
      finishedAt: "2026-05-31T01:00:01.000Z",
      items: [
        {
          amount: 19.99,
          currency: "$undefined",
          externalId: "order_invalid_currency",
          id: "src_item_invalid_currency",
          kind: "order",
          merchantName: "Amazon",
          occurredAt: "2026-05-01T12:00:00.000Z",
          sourceId: "source_amazon_orders",
          summary: "Order total with an invalid exported currency value.",
          title: "USB-C cable"
        }
      ],
      runStatus: "succeeded",
      sourceId: "source_amazon_orders",
      sourceStatus: "connected",
      startedAt: "2026-05-31T01:00:00.000Z"
    });

    const sourceItems = await listSourceItems({ sourceId: "source_amazon_orders" });

    expect(sourceItems[0]).toMatchObject({
      amount: 19.99,
      externalId: "order_invalid_currency",
      title: "USB-C cable"
    });
    expect(sourceItems[0]?.currency).toBeUndefined();
  });

  it("persists whole-app sync run history", async () => {
    useTempDb();

    const run = await recordAppSyncRun({
      enrichmentStatus: "succeeded",
      enrichmentSummary: {
        pendingSuggestions: 3,
        semanticIndex: {
          sourceItemDocuments: 1,
          sourceItemEmbeddings: 1,
          staleDocuments: 0,
          transactionDocuments: 1372,
          transactionEmbeddings: 1372
        },
        suggestionsCreated: 2,
        suggestionsSeen: 7
      },
      finishedAt: "2026-05-31T02:00:05.000Z",
      sourcesStatus: "partial",
      sourcesSummary: {
        failedSources: [
          {
            displayName: "Outlook email",
            errorMessage: "Outlook email is not authenticated.",
            sourceId: "source_outlook_email"
          }
        ],
        summary: {
          evidenceLinksSuggested: 0,
          itemsWritten: 0,
          sourcesAttempted: 5,
          sourcesErrored: 1
        }
      },
      startedAt: "2026-05-31T02:00:00.000Z",
      status: "partial",
      tellerStatus: "succeeded",
      tellerSummary: {
        accountCount: 4,
        enrollmentCount: 1,
        transactionCount: 1372
      }
    });
    const latest = await getLatestAppSyncRun();
    const recentRuns = await listAppSyncRuns();

    expect(run.id).toMatch(/^app_sync_/);
    expect(latest).toMatchObject({
      enrichmentStatus: "succeeded",
      enrichmentSummary: {
        pendingSuggestions: 3,
        semanticIndex: {
          transactionEmbeddings: 1372
        }
      },
      id: run.id,
      sourcesStatus: "partial",
      status: "partial",
      tellerSummary: {
        transactionCount: 1372
      }
    });
    expect(recentRuns[0]).toMatchObject({
      id: run.id,
      status: "partial"
    });
  });

  it("recovers effective LLM provider status from persisted health and sync runs", async () => {
    useTempDb();
    const env = {
      AI_FINANCES_LLM_BASE_URL: "https://api.openai.com/v1",
      AI_FINANCES_LLM_MODEL: "gpt-5.2",
      AI_FINANCES_LLM_PROVIDER: "openai_compatible",
      OPENAI_API_KEY: "test_key"
    };

    expect(await getEffectiveLlmEnrichmentStatus(env)).toMatchObject({
      configured: true,
      provider: "openai_compatible",
      status: "stale"
    });

    await recordLlmProviderHealth(
      {
        baseUrl: "https://api.openai.com/v1",
        configured: true,
        model: "gpt-5.2",
        provider: "openai_compatible",
        status: "connected",
        timeoutMs: 20_000
      },
      "2026-05-31T03:00:00.000Z"
    );
    await closeFinanceDbForTests();

    expect(await getEffectiveLlmEnrichmentStatus(env)).toMatchObject({
      configured: true,
      provider: "openai_compatible",
      status: "connected"
    });

    expect(await getEffectiveLlmEnrichmentStatus({
      ...env,
      AI_FINANCES_LLM_MODEL: "gpt-4.1"
    })).toMatchObject({
      configured: true,
      provider: "openai_compatible",
      status: "stale"
    });

    await recordAppSyncRun({
      enrichmentStatus: "succeeded",
      enrichmentSummary: {
        provider: {
          completed: true,
          provider: {
            baseUrl: "https://api.openai.com/v1",
            configured: true,
            model: "gpt-5.2",
            provider: "openai_compatible",
            status: "error",
            timeoutMs: 20_000,
            errorMessage: "Provider rejected the request."
          },
          suggestionsAccepted: 0,
          suggestionsRejected: 0,
          suggestionsSeen: 0
        }
      },
      finishedAt: "2026-05-31T03:10:00.000Z",
      sourcesStatus: "succeeded",
      sourcesSummary: {},
      startedAt: "2026-05-31T03:09:00.000Z",
      status: "partial",
      tellerStatus: "succeeded",
      tellerSummary: {}
    });
    await closeFinanceDbForTests();

    expect(await getEffectiveLlmEnrichmentStatus(env)).toMatchObject({
      errorMessage: "Provider rejected the request.",
      provider: "openai_compatible",
      status: "error"
    });
  });

  it("persists the whole-app sync schedule and advances it after a run", async () => {
    useTempDb();

    const defaultSchedule = await ensureAppSyncSchedule();
    const enabledSchedule = await updateAppSyncSchedule({
      enabled: true,
      intervalMinutes: 60,
      nextRunAt: "2026-05-31T02:00:00.000Z"
    });
    const run = await recordAppSyncRun({
      enrichmentStatus: "succeeded",
      enrichmentSummary: {
        pendingSuggestions: 1,
        semanticIndex: {
          sourceItemEmbeddings: 0,
          staleDocuments: 0,
          transactionEmbeddings: 1372
        }
      },
      finishedAt: "2026-05-31T02:30:00.000Z",
      sourcesStatus: "succeeded",
      sourcesSummary: {
        summary: {
          evidenceLinksSuggested: 0,
          itemsWritten: 0,
          sourcesAttempted: 5,
          sourcesErrored: 0
        }
      },
      startedAt: "2026-05-31T02:29:00.000Z",
      status: "succeeded",
      tellerStatus: "succeeded",
      tellerSummary: {
        accountCount: 4,
        transactionCount: 1372
      }
    });
    await expect(
      claimAppSyncSchedule(appSyncScheduleId, "schedule_runner", "2026-05-31T02:05:00.000Z")
    ).resolves.toBe(true);
    await expect(
      recordAppSyncScheduleRun(run, appSyncScheduleId, "different_runner")
    ).rejects.toThrow("claim is no longer owned");
    await expect(ensureAppSyncSchedule()).resolves.toMatchObject({
      claimedBy: "schedule_runner",
      lastRunId: undefined
    });
    const advancedSchedule = await recordAppSyncScheduleRun(run, appSyncScheduleId, "schedule_runner");

    expect(defaultSchedule).toMatchObject({
      enabled: false,
      intervalMinutes: 240
    });
    expect(enabledSchedule).toMatchObject({
      enabled: true,
      intervalMinutes: 60,
      nextRunAt: "2026-05-31T02:00:00.000Z"
    });
    expect(advancedSchedule).toMatchObject({
      enabled: true,
      lastRunId: run.id,
      lastStatus: "succeeded",
      nextRunAt: "2026-05-31T03:30:00.000Z"
    });
    expect(advancedSchedule.claimedAt).toBeUndefined();
    expect(advancedSchedule.claimedBy).toBeUndefined();
  });

  it("suggests synced receipt evidence for matching Teller transactions", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -64.2, providerCategoryId: "cat_food" }));
    await ensureExternalSourceCatalog([
      {
        command: "outlook-email-pp-cli",
        displayName: "Outlook email",
        id: "source_outlook_email",
        kind: "outlook_email",
        status: "stale"
      }
    ]);

    const run = await recordSourceSyncRun({
      finishedAt: "2026-05-31T01:00:01.000Z",
      items: [
        {
          amount: 64.2,
          currency: "USD",
          externalId: "message_1",
          id: "src_message_1",
          kind: "email",
          merchantName: "Dinner Place",
          occurredAt: "2026-05-30T13:00:00.000Z",
          sourceId: "source_outlook_email",
          summary: "From: Dinner Place. Receipt for business dinner.",
          title: "Receipt from Dinner Place"
        }
      ],
      runStatus: "succeeded",
      sourceId: "source_outlook_email",
      sourceStatus: "connected",
      startedAt: "2026-05-31T01:00:00.000Z"
    });
    const evidence = await listTransactionEvidence({ transactionId: "txn_1" });
    const reviewQueue = await listEvidenceLinks({ status: "suggested" });
    const searchResults = await semanticSearchTransactions("business dinner receipt", 5);

    expect(run).toMatchObject({
      evidenceLinksSuggested: 1,
      itemsWritten: 1
    });
    expect(evidence[0]).toMatchObject({
      relationship: "receipt",
      sourceItem: {
        id: "src_message_1",
        title: "Receipt from Dinner Place"
      },
      status: "suggested",
      transactionId: "txn_1"
    });
    expect(evidence[0]?.confidence).toBeGreaterThan(0.7);
    expect(reviewQueue[0]).toMatchObject({
      sourceItem: {
        id: "src_message_1"
      },
      status: "suggested",
      transaction: {
        id: "txn_1",
        merchantName: "Dinner Place"
      }
    });
    expect(searchResults[0]).toMatchObject({
      resourceId: "txn_1"
    });

    const accepted = await updateTransactionEvidenceStatus({
      relationship: "receipt",
      sourceItemId: "src_message_1",
      status: "accepted",
      transactionId: "txn_1"
    });
    const refresh = await refreshSourceEvidenceMatches();
    const afterRefresh = await listTransactionEvidence({ transactionId: "txn_1" });
    const suggestedAfterRefresh = await listEvidenceLinks({ status: "suggested" });

    expect(accepted).toMatchObject({
      status: "accepted"
    });
    expect(refresh).toMatchObject({
      evidenceLinksSuggested: 0,
      sourceItemCount: 1
    });
    expect(afterRefresh[0]).toMatchObject({
      status: "accepted"
    });
    expect(suggestedAfterRefresh).toHaveLength(0);
  }, 15_000);

  it("imports JSONL source records through adapters and suggests matching evidence", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -64.2, providerCategoryId: "cat_food" }));

    const run = await importSourceAdapterPayload("source_outlook_email", {
      content: JSON.stringify({
        amount: "$64.20",
        bodyPreview: "Receipt for business dinner.",
        from: {
          emailAddress: {
            name: "Dinner Place"
          }
        },
        id: "message_import_1",
        receivedDateTime: "2026-05-30T13:00:00.000Z",
        subject: "Receipt from Dinner Place"
      }),
      filename: "outlook-receipts.jsonl"
    });
    const sourceItems = await listSourceItems({ sourceId: "source_outlook_email" });
    const evidence = await listTransactionEvidence({ transactionId: "txn_1" });

    expect(run).toMatchObject({
      evidenceLinksSuggested: 1,
      itemsWritten: 1,
      runStatus: "succeeded",
      sourceStatus: "connected"
    });
    expect(sourceItems[0]).toMatchObject({
      amount: 64.2,
      externalId: "message_import_1",
      title: "Receipt from Dinner Place"
    });
    expect(evidence[0]).toMatchObject({
      relationship: "receipt",
      sourceItem: {
        externalId: "message_import_1"
      },
      status: "suggested"
    });
  }, 15_000);

  it("imports Amazon order records and matches Amazon Teller charges", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({
      description: "AMZN MKTP US",
      merchantName: "AMAZON",
      providerCategoryId: "cat_shopping",
      transactionAmount: -42.1
    }));

    const run = await importSourceAdapterPayload("source_amazon_orders", {
      content: JSON.stringify([
        {
          items: [{ title: "Replacement filters" }],
          orderId: "111-2222222-3333333",
          placedDate: "2026-05-30",
          status: "Delivered",
          total: "$42.10"
        }
      ]),
      filename: "amazon-orders.json"
    });
    const evidence = await listTransactionEvidence({ transactionId: "txn_1" });

    expect(run).toMatchObject({
      evidenceLinksSuggested: 1,
      itemsWritten: 1,
      sourceStatus: "connected"
    });
    expect(evidence[0]).toMatchObject({
      relationship: "order",
      sourceItem: {
        externalId: "111-2222222-3333333",
        merchantName: "Amazon"
      },
      status: "suggested"
    });
  }, 15_000);

  it("manually links source evidence to a Teller transaction", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -31.2, providerCategoryId: "cat_other" }));
    await ensureExternalSourceCatalog([
      {
        command: "outlook-email-pp-cli",
        displayName: "Outlook email",
        id: "source_outlook_email",
        kind: "outlook_email",
        status: "stale"
      }
    ]);
    await recordSourceSyncRun({
      finishedAt: "2026-05-31T01:00:01.000Z",
      items: [
        {
          amount: 31.2,
          currency: "USD",
          externalId: "message_manual_1",
          id: "src_message_manual_1",
          kind: "email",
          merchantName: "Coffee Shop",
          occurredAt: "2026-05-28T13:00:00.000Z",
          sourceId: "source_outlook_email",
          summary: "From: Coffee Shop. Receipt for advisor coffee.",
          title: "Coffee receipt"
        }
      ],
      runStatus: "succeeded",
      sourceId: "source_outlook_email",
      sourceStatus: "connected",
      startedAt: "2026-05-31T01:00:00.000Z"
    });

    const linked = await createTransactionEvidenceLink({
      sourceItemId: "src_message_manual_1",
      transactionId: "txn_1"
    });
    const evidence = await listTransactionEvidence({ transactionId: "txn_1" });
    const searchResults = await semanticSearchTransactions("advisor coffee receipt", 5);

    expect(linked).toMatchObject({
      relationship: "receipt",
      sourceItem: {
        id: "src_message_manual_1"
      },
      status: "accepted",
      transactionId: "txn_1"
    });
    expect(evidence[0]).toMatchObject({
      relationship: "receipt",
      status: "accepted"
    });
    expect(searchResults[0]).toMatchObject({
      resourceId: "txn_1"
    });
  }, 15_000);

  it("creates transaction rules and applies category and tag actions to Teller transactions", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -24.2, providerCategoryId: "cat_other" }));

    const created = await createTransactionRule({
      categoryId: "cat_food",
      markReviewed: true,
      matchField: "merchant_or_description",
      matchOperator: "contains",
      name: "Dinner place food",
      pattern: "Dinner Place",
      tags: ["food", "rule:food"]
    });
    const snapshot = await readFinanceDbSnapshot();
    const transaction = snapshot?.transactions.find((candidate) => candidate.id === "txn_1");
    const rules = await listTransactionRules();
    const reapplied = await applyTransactionRules();
    const searchResults = await semanticSearchTransactions("rule food dinner", 5);

    expect(created.applyResult).toMatchObject({
      rulesApplied: 1,
      transactionsUpdated: 1
    });
    expect(rules[0]).toMatchObject({
      lastAppliedCount: 1,
      name: "Dinner place food"
    });
    expect(transaction).toMatchObject({
      categoryId: "cat_food",
      reviewed: true,
      tags: ["teller", "food", "rule:food"]
    });
    expect(reapplied).toMatchObject({
      rulesApplied: 1,
      transactionsUpdated: 0
    });
    expect(searchResults[0]).toMatchObject({
      resourceId: "txn_1",
      transaction: {
        categoryId: "cat_food",
        reviewed: true
      }
    });
  }, 15_000);

  it("applies regex transaction rules only to matching merchant or description rows", async () => {
    useTempDb();
    const ledger = createLedger({
      description: "AMAZON MARKETPLACE ORDER",
      merchantName: "AMZN MKTP",
      providerCategoryId: "cat_other",
      transactionAmount: -42.18
    });
    const baseTransaction = ledger.transactions[0];
    await replaceTellerLedgerInDb({
      ...ledger,
      transactions: [
        baseTransaction,
        {
          ...baseTransaction,
          amount: -24.2,
          description: "DINNER PLACE",
          id: "txn_2",
          merchantName: "Dinner Place"
        }
      ],
      syncSummary: {
        accountCount: 1,
        transactionCount: 2,
        errors: []
      }
    });

    const created = await createTransactionRule({
      categoryId: "cat_software",
      matchField: "merchant_or_description",
      matchOperator: "regex",
      name: "Amazon regex",
      pattern: "^AMZN|AMAZON",
      tags: ["regex-hit"]
    });
    const snapshot = await readFinanceDbSnapshot();
    const matchedTransaction = snapshot?.transactions.find((candidate) => candidate.id === "txn_1");
    const unmatchedTransaction = snapshot?.transactions.find((candidate) => candidate.id === "txn_2");

    expect(created.applyResult).toMatchObject({
      rulesApplied: 1,
      transactionsUpdated: 1
    });
    expect(matchedTransaction).toMatchObject({
      categoryId: "cat_software",
      tags: ["teller", "regex-hit"]
    });
    expect(unmatchedTransaction).toMatchObject({
      categoryId: "cat_other",
      tags: ["teller"]
    });
  }, 15_000);

  it("rejects overbroad local transaction rules at the repository boundary", async () => {
    useTempDb();

    await expect(
      createTransactionRule({
        categoryId: "cat_food",
        matchField: "merchant_or_description",
        matchOperator: "contains",
        name: "Payment cleanup",
        pattern: "payment"
      })
    ).rejects.toThrow("Contains rule pattern is too broad for automatic transaction updates.");
  }, 15_000);

  it("validates transaction rule updates against the existing rule pattern and operator", async () => {
    useTempDb();
    const created = await createTransactionRule({
      enabled: false,
      matchField: "merchant_or_description",
      matchOperator: "equals",
      name: "Exact one letter",
      pattern: "a"
    });

    await expect(updateTransactionRule(created.rule.id, { pattern: "b" })).resolves.toMatchObject({
      rule: {
        matchOperator: "equals",
        pattern: "b"
      }
    });

    const paymentRule = await createTransactionRule({
      enabled: false,
      matchField: "merchant_or_description",
      matchOperator: "equals",
      name: "Exact payment",
      pattern: "payment"
    });

    await expect(updateTransactionRule(paymentRule.rule.id, { matchOperator: "contains" })).rejects.toThrow(
      "Contains rule pattern is too broad for automatic transaction updates."
    );
  }, 15_000);

  it("clears transaction rule categories only when explicitly requested", async () => {
    useTempDb();
    const created = await createTransactionRule({
      categoryId: "cat_food",
      enabled: false,
      matchField: "merchant_or_description",
      matchOperator: "contains",
      name: "Dinner clear category",
      pattern: "Dinner Place",
      tags: ["food", "rule:food"]
    });

    await expect(updateTransactionRule(created.rule.id, { name: "Dinner category unchanged" })).resolves.toMatchObject({
      rule: {
        categoryId: "cat_food",
        tags: ["food", "rule:food"]
      }
    });
    await expect(updateTransactionRule(created.rule.id, { categoryId: null, tags: [] })).resolves.toMatchObject({
      rule: {
        categoryId: undefined,
        tags: []
      }
    });
    await expect(updateTransactionRule(created.rule.id, { categoryId: "cat_travel" })).resolves.toMatchObject({
      rule: {
        categoryId: "cat_travel"
      }
    });
    await expect(updateTransactionRule(created.rule.id, { categoryId: "cat_missing" })).rejects.toThrow(
      "Unknown category."
    );
  }, 15_000);

  it("links typed transaction context notes as evidence and search context", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -64.2, providerCategoryId: "cat_other" }));

    const note = await createTransactionContextNote({
      body: "This was the conference parking reimbursement in Denver.",
      transactionId: "txn_1"
    });
    const sourceItems = await listSourceItems({ sourceId: "source_user_note" });
    const searchResults = await semanticSearchTransactions("conference parking reimbursement Denver", 5);
    const semanticSummary = await getSemanticDocumentSummary();

    expect(note?.sourceItem).toMatchObject({
      kind: "context_note",
      sourceId: "source_user_note",
      summary: "This was the conference parking reimbursement in Denver."
    });
    expect(sourceItems).toHaveLength(1);
    expect(semanticSummary.transactionEmbeddingCount).toBe(1);
    expect(semanticSummary.sourceItemEmbeddingCount).toBe(1);
    expect(searchResults[0]).toMatchObject({
      resourceId: "txn_1",
      transaction: {
        id: "txn_1"
      }
    });
  }, 15_000);

  it("links voice note transcripts as evidence and source-item search context", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -18.75, providerCategoryId: "cat_other" }));

    const voiceNote = await createTransactionVoiceNote({
      transcript: "This was coffee with the product advisor before the investor meeting.",
      transactionId: "txn_1"
    });
    const evidence = await listTransactionEvidence({ transactionId: "txn_1" });
    const resourceResults = await semanticSearchFinanceResources("product advisor investor meeting", 5);
    const transactionResults = await semanticSearchTransactions("product advisor investor meeting", 5);
    const semanticSummary = await getSemanticDocumentSummary();

    expect(voiceNote?.sourceItem).toMatchObject({
      kind: "voice_transcript",
      sourceId: "source_voice_note",
      summary: "This was coffee with the product advisor before the investor meeting."
    });
    expect(evidence[0]).toMatchObject({
      relationship: "user_context",
      sourceItem: {
        kind: "voice_transcript"
      },
      status: "accepted",
      transactionId: "txn_1"
    });
    expect(resourceResults).toContainEqual(
      expect.objectContaining({
        resourceType: "source_item",
        sourceItem: expect.objectContaining({
          kind: "voice_transcript"
        })
      })
    );
    expect(transactionResults[0]).toMatchObject({
      resourceId: "txn_1"
    });
    expect(semanticSummary).toMatchObject({
      sourceItemDocumentCount: 1,
      sourceItemEmbeddingCount: 1,
      transactionDocumentCount: 1,
      transactionEmbeddingCount: 1
    });
  }, 15_000);

  it("keeps Teller JSON as explicit backup only, not an automatic runtime source", async () => {
    useTempDb();
    const backupLedger = createLedger({ merchantName: "Backup Only", providerCategoryId: "cat_other", transactionAmount: -10 });
    writeTellerLedgerBackup(backupLedger);

    const emptyData = await getFinanceData();

    expect(emptyData).toMatchObject({
      source: "empty",
      accounts: [],
      transactions: []
    });

    const imported = await importTellerLedgerBackup(backupLedger);
    const dataAfterImport = await getFinanceData();
    const exported = await exportTellerLedgerBackup();

    expect(imported).toMatchObject({
      accounts: [{ id: "acct_1" }],
      transactions: [{ merchantName: "Backup Only" }]
    });
    expect(dataAfterImport).toMatchObject({
      source: "teller",
      transactions: [{ merchantName: "Backup Only" }]
    });
    expect(exported).toMatchObject({
      transactions: [{ merchantName: "Backup Only" }]
    });
    expect(existsSync(getTellerLedgerBackupPath())).toBe(true);
  }, 15_000);

  it("clears local runtime data without deleting explicit backup files", async () => {
    useTempDb();
    const ledger = createLedger({ transactionAmount: -64.2, providerCategoryId: "cat_food" });
    writeTellerLedgerBackup(ledger);
    await replaceTellerLedgerInDb(ledger);
    await importSourceAdapterPayload("source_outlook_email", {
      content: JSON.stringify({
        amount: "$64.20",
        bodyPreview: "Receipt for business dinner.",
        from: "Dinner Place <receipts@example.com>",
        id: "reset_message_1",
        receivedDateTime: "2026-05-30T13:00:00.000Z",
        subject: "Receipt from Dinner Place"
      }),
      filename: "outlook-receipts.json"
    });
    await createTransactionRule({
      matchField: "merchant_or_description",
      matchOperator: "equals",
      name: "Dinner exact",
      pattern: "Dinner Place"
    });
    await ensureAppSyncSchedule();

    const summary = await resetLocalAppData();
    const snapshot = await readFinanceDbSnapshot();
    const sourceStore = await getSourceStoreSummary();
    const sourceItems = await listSourceItems({});
    const evidenceLinks = await listEvidenceLinks({ status: "suggested" });
    const rules = await listTransactionRules();
    const appSyncRuns = await listAppSyncRuns();
    const semanticSummary = await getSemanticDocumentSummary();

    expect(summary).toMatchObject({
      accountCount: 1,
      evidenceLinkCount: 1,
      ruleCount: 1,
      scheduleCount: 1,
      sourceItemCount: 1,
      transactionCount: 1
    });
    expect(summary.sourceCount).toBeGreaterThan(0);
    expect(summary.semanticDocumentCount).toBeGreaterThan(0);
    expect(snapshot).toBeNull();
    expect(sourceStore).toMatchObject({
      evidenceLinkCount: 0,
      externalSourceCount: 0,
      sourceItemCount: 0
    });
    expect(sourceItems).toEqual([]);
    expect(evidenceLinks).toEqual([]);
    expect(rules).toEqual([]);
    expect(appSyncRuns).toEqual([]);
    expect(semanticSummary).toMatchObject({
      sourceItemDocumentCount: 0,
      sourceItemEmbeddingCount: 0,
      staleDocumentCount: 0,
      transactionDocumentCount: 0,
      transactionEmbeddingCount: 0
    });
    expect(existsSync(getTellerLedgerBackupPath())).toBe(true);
  }, 15_000);

  it("generates reviewable enrichment suggestions and applies or dismisses them", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createRepeatedMerchantLedger());

    const run = await generateEnrichmentSuggestions(20);
    const suggestions = await listEnrichmentSuggestions();
    const suggestionItems = await listEnrichmentSuggestionItems();
    const categorySuggestion = suggestions.find(
      (suggestion) => suggestion.action === "set_category" && suggestion.categoryId === "cat_software"
    );
    const ruleSuggestion = suggestions.find((suggestion) => suggestion.action === "create_rule");
    const tagSuggestion = suggestions.find((suggestion) => suggestion.action === "add_tags");

    expect(run.pendingSuggestions).toBeGreaterThan(0);
    expect(categorySuggestion).toMatchObject({
      action: "set_category",
      categoryId: "cat_software",
      status: "pending"
    });
    expect(ruleSuggestion).toMatchObject({
      action: "create_rule",
      categoryId: "cat_software",
      rulePattern: "OPENAI OPENAI"
    });
    expect(tagSuggestion).toMatchObject({
      action: "add_tags",
      tags: ["recurring"]
    });
    expect(suggestionItems.find((item) => item.suggestion.id === categorySuggestion?.id)?.transaction).toMatchObject({
      id: categorySuggestion?.transactionId,
      merchantName: expect.stringContaining("OPENAI")
    });

    const applied = await applyEnrichmentSuggestion(categorySuggestion!.id);
    const dismissed = await dismissEnrichmentSuggestion(tagSuggestion!.id);
    const snapshot = await readFinanceDbSnapshot();
    const transaction = snapshot?.transactions.find((candidate) => candidate.id === categorySuggestion?.transactionId);
    const remainingSuggestions = await listEnrichmentSuggestions();

    expect(applied?.suggestion).toMatchObject({
      status: "applied"
    });
    expect(applied?.transaction).toMatchObject({
      categoryId: "cat_software"
    });
    expect(transaction).toMatchObject({
      categoryId: "cat_software"
    });
    expect(dismissed).toMatchObject({
      status: "dismissed"
    });
    expect(remainingSuggestions.some((suggestion) => suggestion.id === categorySuggestion?.id)).toBe(false);
    expect(remainingSuggestions.some((suggestion) => suggestion.id === tagSuggestion?.id)).toBe(false);
  }, 15_000);

  it("does not create enrichment suggestions for already-classified income and transfers", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createNonActionableLedger());

    const run = await generateEnrichmentSuggestions(20);
    const suggestions = await listEnrichmentSuggestions();

    expect(run.pendingSuggestions).toBe(0);
    expect(suggestions).toHaveLength(0);
  }, 15_000);

  it("suggests Instacart card charges as food instead of software", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(
      createLedger({
        description: "IC* INSTACART 888-246-7822",
        merchantName: "INSTACART",
        providerCategoryId: "cat_other",
        transactionAmount: -59.49
      })
    );

    await generateEnrichmentSuggestions(20);
    const suggestions = await listEnrichmentSuggestions();

    expect(suggestions).toContainEqual(
      expect.objectContaining({
        action: "set_category",
        categoryId: "cat_food"
      })
    );
    expect(suggestions).not.toContainEqual(
      expect.objectContaining({
        action: "set_category",
        categoryId: "cat_software"
      })
    );
  }, 15_000);

  it("deduplicates local suggestions when hosted LLM suggestions cover the same review target", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createRepeatedMerchantLedger());

    await generateEnrichmentSuggestions(20);
    expect(
      (await listEnrichmentSuggestions()).some(
        (suggestion) =>
          suggestion.source === "local_enrichment_v1" &&
          suggestion.action === "set_category" &&
          suggestion.transactionId === "txn_1" &&
          suggestion.categoryId === "cat_software"
      )
    ).toBe(true);

    process.env.AI_FINANCES_LLM_PROVIDER = "openai_compatible";
    process.env.AI_FINANCES_LLM_MODEL = "gpt-4.1-mini";
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    suggestions: [
                      {
                        action: "set_category",
                        category_id: "cat_software",
                        confidence: 0.91,
                        mark_reviewed: false,
                        reason: "The merchant and description indicate a software subscription.",
                        rule_match_field: "",
                        rule_match_operator: "",
                        rule_name: "",
                        rule_pattern: "",
                        tags: [],
                        transaction_id: "txn_1"
                      }
                    ]
                  })
                }
              }
            ]
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200
          }
        )
    );

    await generateEnrichmentSuggestions(20);

    const suggestions = await listEnrichmentSuggestions({ status: "pending" });
    const duplicateTargetSuggestions = suggestions.filter(
      (suggestion) =>
        suggestion.action === "set_category" &&
        suggestion.transactionId === "txn_1" &&
        suggestion.categoryId === "cat_software"
    );

    expect(duplicateTargetSuggestions).toHaveLength(1);
    expect(duplicateTargetSuggestions[0]).toMatchObject({
      confidence: 0.91
    });
    expect(duplicateTargetSuggestions[0].source).toMatch(/^llm:openai_compatible:/);
  }, 15_000);
});

function useTempDb() {
  testDbPath = path.join(mkdtempSync(path.join(tmpdir(), "ai-finances-pglite-")), "db");
  process.env.AI_FINANCES_PGLITE_DIR = testDbPath;
  process.env.AI_FINANCES_TELLER_BACKUP_PATH = path.join(path.dirname(testDbPath), "teller-ledger-backup.json");
}

function mkdirForTestDb() {
  if (!testDbPath) {
    throw new Error("Test database path has not been initialized.");
  }

  mkdirSync(testDbPath, { recursive: true });
}

function documentsByResourceId(
  documents: Array<{ bodyHash: string; resourceId: string; updatedAt: string }>
): Map<string, { bodyHash: string; updatedAt: string }> {
  return new Map(
    documents.map((document) => [
      document.resourceId,
      { bodyHash: document.bodyHash, updatedAt: document.updatedAt }
    ])
  );
}

async function waitForClockTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

function createLedger({
  description = "DINNER PLACE",
  merchantName = "Dinner Place",
  providerCategoryId,
  transactionAmount
}: {
  description?: string;
  merchantName?: string;
  providerCategoryId: string;
  transactionAmount: number;
}): TellerLedger {
  const providerConnection = {
    id: "provider_teller_test",
    provider: "teller",
    displayName: "Teller - Test Bank",
    status: "connected",
    configured: true,
    lastSyncedAt: "2026-05-31T00:00:00.000Z"
  } satisfies ProviderConnection;
  const account = {
    id: "acct_1",
    providerConnectionId: providerConnection.id,
    groupId: "group_cash",
    name: "Checking",
    institutionName: "Test Bank",
    type: "checking",
    currency: "USD",
    currentBalance: 1000.25,
    availableBalance: 900.25,
    includedInNetWorth: true,
    lastUpdatedAt: "2026-05-31T00:00:00.000Z"
  } satisfies Account;
  const transaction = {
    id: "txn_1",
    accountId: account.id,
    providerConnectionId: providerConnection.id,
    date: "2026-05-30",
    postedDate: "2026-05-30",
    merchantName,
    description,
    amount: transactionAmount,
    currency: "USD",
    categoryId: providerCategoryId,
    status: "posted",
    reviewed: false,
    tags: ["teller"]
  } satisfies Transaction;

  return {
    source: "teller",
    version: 1,
    lastSyncedAt: "2026-05-31T00:00:00.000Z",
    syncStartDate: "2026-01-01",
    enrollmentCount: 1,
    accounts: [account],
    providerConnections: [providerConnection],
    transactions: [transaction],
    syncSummary: {
      accountCount: 1,
      transactionCount: 1,
      errors: []
    }
  };
}

function createRepeatedMerchantLedger(): TellerLedger {
  const ledger = createLedger({
    description: "OPENAI SUBSCRIPTION",
    merchantName: "OPENAI OPENAI",
    providerCategoryId: "cat_other",
    transactionAmount: -20
  });
  const baseTransaction = ledger.transactions[0];

  return {
    ...ledger,
    transactions: [
      baseTransaction,
      {
        ...baseTransaction,
        id: "txn_2",
        date: "2026-05-29",
        postedDate: "2026-05-29",
        amount: -21
      },
      {
        ...baseTransaction,
        id: "txn_3",
        date: "2026-05-28",
        postedDate: "2026-05-28",
        amount: -22
      }
    ],
    syncSummary: {
      accountCount: 1,
      transactionCount: 3,
      errors: []
    }
  };
}

function createNonActionableLedger(): TellerLedger {
  const ledger = createLedger({
    description: "BNYMELLON PAYROLL",
    merchantName: "BNYMELLON",
    providerCategoryId: "cat_income",
    transactionAmount: 5000
  });
  const baseTransaction = ledger.transactions[0];
  const transferTransaction = {
    ...baseTransaction,
    amount: -1200,
    categoryId: "cat_transfer",
    description: "AMERICAN EXPRESS ACH PMT WEB ID: 9493560001",
    id: "txn_transfer_1",
    merchantName: "AMERICAN EXPRESS"
  } satisfies Transaction;

  return {
    ...ledger,
    transactions: [
      baseTransaction,
      {
        ...baseTransaction,
        id: "txn_income_2",
        date: "2026-05-29",
        postedDate: "2026-05-29",
        amount: 5100
      },
      {
        ...baseTransaction,
        id: "txn_income_3",
        date: "2026-05-28",
        postedDate: "2026-05-28",
        amount: 5200
      },
      transferTransaction,
      {
        ...transferTransaction,
        id: "txn_transfer_2",
        date: "2026-05-29",
        postedDate: "2026-05-29"
      },
      {
        ...transferTransaction,
        id: "txn_transfer_3",
        date: "2026-05-28",
        postedDate: "2026-05-28"
      }
    ],
    syncSummary: {
      accountCount: 1,
      transactionCount: 6,
      errors: []
    }
  };
}

function createTransferPairLedgerForPruneTest(): TellerLedger {
  const providerConnection = {
    configured: true,
    displayName: "Teller - Test Bank",
    id: "provider_teller_test",
    lastSyncedAt: "2026-05-31T00:00:00.000Z",
    provider: "teller",
    status: "connected"
  } satisfies ProviderConnection;
  const checking = createTestAccount({
    groupId: "group_cash",
    id: "acct_checking",
    name: "Checking",
    providerConnectionId: providerConnection.id,
    type: "checking"
  });
  const card = createTestAccount({
    groupId: "group_credit",
    id: "acct_card",
    name: "Card",
    providerConnectionId: providerConnection.id,
    type: "credit_card"
  });
  const transactions = [
    createTestTransaction({
      accountId: checking.id,
      amount: -1000,
      categoryId: "cat_transfer",
      description: "Payment to Card ending in 1234",
      id: "txn_checking_payment",
      merchantName: "CARD PAYMENT"
    }),
    createTestTransaction({
      accountId: card.id,
      amount: -1000,
      description: "Payment Thank You-Mobile",
      id: "txn_card_payment",
      merchantName: "CARD"
    }),
    createTestTransaction({
      accountId: checking.id,
      amount: 1200,
      categoryId: "cat_income",
      description: "BNYMELLON PAYROLL",
      id: "txn_payroll",
      merchantName: "BNYMELLON"
    }),
    createTestTransaction({
      accountId: checking.id,
      amount: -40,
      categoryId: "cat_food",
      description: "GROCER",
      id: "txn_food",
      merchantName: "GROCER"
    })
  ];

  return {
    accounts: [checking, card],
    enrollmentCount: 1,
    lastSyncedAt: "2026-05-31T00:00:00.000Z",
    providerConnections: [providerConnection],
    source: "teller",
    syncStartDate: "2026-01-01",
    syncSummary: {
      accountCount: 2,
      errors: [],
      transactionCount: transactions.length
    },
    transactions,
    version: 1
  };
}

function createTestAccount(input: Partial<Account>): Account {
  return {
    availableBalance: 900,
    currency: "USD",
    currentBalance: 1000,
    groupId: "group_cash",
    id: "acct",
    includedInNetWorth: true,
    institutionName: "Test Bank",
    lastUpdatedAt: "2026-05-31T00:00:00.000Z",
    mask: "1234",
    name: "Account",
    providerConnectionId: "provider_teller_test",
    type: "checking",
    ...input
  };
}

function createTestTransaction(input: Partial<Transaction>): Transaction {
  return {
    accountId: "acct_checking",
    amount: -100,
    categoryId: "cat_other",
    currency: "USD",
    date: "2026-05-30",
    description: "Transaction",
    id: "txn",
    merchantName: "Merchant",
    postedDate: "2026-05-30",
    providerConnectionId: "provider_teller_test",
    reviewed: false,
    status: "posted",
    tags: ["teller"],
    ...input
  };
}
