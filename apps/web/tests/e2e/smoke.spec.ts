import { expect, type Page, test } from "@playwright/test";

test("dashboard renders Plaid-backed cards", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("dashboard-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly spending" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top categories" })).toBeVisible();
  await expect(page.getByText("Transactions to review")).toBeVisible();
  await expect(page.locator('a[href="/transactions?review=actionable"]').first()).toBeVisible();
  await expect(page.getByTestId("net-worth-card")).toHaveAttribute("data-range", "1M");
  await page.getByLabel("Net worth range").getByRole("button", { name: "3M" }).click();
  await expect(page.getByTestId("net-worth-card")).toHaveAttribute("data-range", "3M");
  const sidebar = page.locator('[data-slot="sidebar"][data-state]').first();
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await page.screenshot({ fullPage: true, path: "test-results/dashboard-smoke.png" });
});

test("PWA installability assets are served", async ({ page }) => {
  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as {
    background_color?: string;
    display?: string;
    icons?: Array<{ purpose?: string; sizes?: string; src?: string; type?: string }>;
    name?: string;
    scope?: string;
    short_name?: string;
    start_url?: string;
    theme_color?: string;
  };

  expect(manifest).toMatchObject({
    background_color: "#07090b",
    display: "standalone",
    // e2e servers run without NEXT_PUBLIC_APP_ENV, which resolves to the local icon set.
    name: "Koban (local)",
    scope: "/",
    short_name: "Koban",
    start_url: "/",
    theme_color: "#07090b"
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", src: "/icons/koban-local-192.png", type: "image/png" }),
      expect.objectContaining({ sizes: "512x512", src: "/icons/koban-local-512.png", type: "image/png" }),
      expect.objectContaining({ purpose: "maskable", sizes: "192x192", src: "/icons/maskable-icon-192.png" }),
      expect.objectContaining({ purpose: "maskable", sizes: "512x512", src: "/icons/maskable-icon-512.png" })
    ])
  );

  const swResponse = await page.request.get("/sw.js");
  expect(swResponse.ok()).toBe(true);
  expect(swResponse.headers()["content-type"]).toMatch(/javascript|text\/plain/);
  expect(await swResponse.text()).toContain("ai-finances-static-v1");

  const appleIconResponse = await page.request.get("/icons/apple-touch-icon.png");
  expect(appleIconResponse.ok()).toBe(true);
  expect(appleIconResponse.headers()["content-type"]).toMatch(/image\/png/);
});

test("transactions fit at 390px without horizontal body scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/transactions");

  await expect(page.getByTestId("transactions-page")).toBeVisible();
  await expect(page.getByTestId("transaction-row").first()).toBeVisible();

  const scrollWidth = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth));
  expect(scrollWidth).toBeLessThanOrEqual(391);
});

test("investments holdings table fits at 390px without horizontal body scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/investments");

  await expect(page.getByTestId("investments-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Holdings" })).toBeVisible();

  const scrollWidth = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth));
  expect(scrollWidth).toBeLessThanOrEqual(391);
});

test("dashboard cards fit at 390px without horizontal body scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByTestId("dashboard-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly spending" })).toBeVisible();

  const scrollWidth = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth));
  expect(scrollWidth).toBeLessThanOrEqual(391);
});

test("transactions filter and inspector work", async ({ page }) => {
  await page.goto("/transactions");

  await expect(page.getByTestId("transactions-page")).toBeVisible();
  const rows = page.getByTestId("transaction-row");
  await expect(rows.first()).toBeVisible();
  const merchant = "E2E Grocer Market";

  await page.getByLabel("Search transactions").fill("Grocer");
  const seededRow = rows.filter({ hasText: merchant }).first();
  await expect(seededRow).toBeVisible();
  await seededRow.click();
  await expect(page.getByLabel("Selected transaction inspector").getByRole("heading", { name: merchant, exact: true })).toBeVisible();
  await expect(page.getByLabel("Context note")).toBeVisible();
  await expect(page.getByLabel("Transaction evidence")).toBeVisible();
  await expect(page.getByText("Link source item")).toBeVisible();
  await page.screenshot({ fullPage: true, path: "test-results/transactions-smoke.png" });

  // review=actionable deep links land on the Review tab now.
  await page.goto("/transactions?review=actionable");
  await expect(page.getByRole("tab", { name: /Review/ })).toHaveAttribute("aria-selected", "true");
});

test("settings shows provider setup without crashing", async ({ page }) => {
  await page.goto("/settings");

  // Connections tab is the default hero surface.
  await expect(page.getByRole("tab", { name: "Connections" })).toBeVisible();
  await expect(page.getByTestId("connections-settings-panel")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bank accounts" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Connect bank account|Add another bank account/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Context sources" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source setup checklist" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Imported evidence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Suggested evidence matches" })).toBeVisible();
  await expect(page.getByLabel("Filter source items")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gmail receipts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Amazon orders" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Instacart groceries" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Airbnb travel context" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Outlook email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync installed sources" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync source" }).first()).toBeVisible();
  await expect(page.getByText("Import JSON/JSONL/CSV/EML/MBOX/ICS/ZIP").first()).toBeVisible();
  await expect(page.getByText("Validate import file").first()).toBeVisible();
  await expect(page.getByText("Up to 50 MB").first()).toBeVisible();
  await expect(page.getByText("Paste JSON/JSONL/CSV/EML/MBOX/ICS").first()).toBeVisible();
  await page.getByText("Paste JSON/JSONL/CSV/EML/MBOX/ICS").first().click();
  await expect(page.getByLabel("Gmail receipts JSON, JSONL, CSV, EML, MBOX, or ICS")).toBeVisible();
  await expect(page.getByRole("button", { name: "Validate pasted records" }).first()).toBeVisible();
  await expect(page.getByText("Local cache:").first()).toBeVisible();
  await expect(page.getByText("Stored evidence:").first()).toBeVisible();

  // Sync tab: whole-app sync, readiness, schedule, recent runs.
  await page.getByRole("tab", { name: "Sync" }).click();
  await expect(page.getByRole("heading", { name: "Sync everything" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync everything" })).toBeVisible();
  await expect(page.getByLabel("Periodic sync")).toBeVisible();
  await expect(page.getByLabel("Sync interval")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent sync runs" })).toBeVisible();

  // AI tab: provider status and health check.
  await page.getByRole("tab", { name: "AI" }).click();
  await expect(page.getByRole("heading", { name: "AI enrichment provider" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check provider" })).toBeVisible();

  // Data tab: backup/restore and the guarded local-data reset.
  await page.getByRole("tab", { name: "Data" }).click();
  await expect(page.getByRole("button", { name: "Export backup" })).toBeVisible();
  await expect(page.getByLabel("Local data reset section")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear local runtime data" })).toBeDisabled();

  const response = await page.request.get("/api/v1/sources");
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as {
    data?: Array<{
      cache?: { record_count?: number; status?: string };
      setup?: { commands?: unknown[]; missing?: string[]; next_action?: string; ready?: boolean };
      storage?: { evidence_link_count?: number; source_item_count?: number };
    }>;
  };
  expect(payload.data?.length).toBe(5);
  expect(payload.data?.some((adapter) => adapter.cache?.status === "empty" && adapter.cache.record_count === 0)).toBe(true);
  expect(payload.data?.every((adapter) => typeof adapter.setup?.ready === "boolean")).toBe(true);
  expect(payload.data?.some((adapter) => adapter.setup?.ready === false && adapter.setup.next_action)).toBe(true);
  expect(payload.data?.every((adapter) => typeof adapter.storage?.source_item_count === "number")).toBe(true);
  expect(payload.data?.every((adapter) => typeof adapter.storage?.evidence_link_count === "number")).toBe(true);

  const sourceItemsResponse = await page.request.get("/api/v1/source-items?limit=5");
  expect(sourceItemsResponse.ok()).toBe(true);

  const evidenceResponse = await page.request.get("/api/v1/evidence?status=suggested&limit=5");
  expect(evidenceResponse.ok()).toBe(true);
  const evidencePayload = (await evidenceResponse.json()) as { data?: unknown[]; object?: string };
  expect(evidencePayload.object).toBe("list");
  expect(Array.isArray(evidencePayload.data)).toBe(true);

  const syncStatusResponse = await page.request.get("/api/v1/sync-runs");
  expect(syncStatusResponse.ok()).toBe(true);
  const syncStatus = (await syncStatusResponse.json()) as {
    enrichment?: {
      llm_provider?: {
        configured?: boolean;
        error_message?: string;
        status?: string;
      };
    };
    last_run?: unknown;
    object?: string;
    ready?: {
      enrichment?: boolean;
      sources?: boolean;
    };
    recent_runs?: unknown[];
    sources?: {
      blocked_count?: number;
      external_source_count?: number;
      ready_count?: number;
    };
    plaid?: {
      stored_account_count?: number;
      stored_transaction_count?: number;
    };
  };
  expect(syncStatus.object).toBe("app_sync_status");
  expect(syncStatus).toHaveProperty("last_run");
  expect(Array.isArray(syncStatus.recent_runs)).toBe(true);
  expect(syncStatus.ready?.enrichment).toBe(
    !syncStatus.enrichment?.llm_provider?.configured || syncStatus.enrichment.llm_provider.status === "connected"
  );
  if (syncStatus.enrichment?.llm_provider?.status === "error") {
    expect(typeof syncStatus.enrichment.llm_provider.error_message).toBe("string");
  }
  expect(typeof syncStatus.sources?.ready_count).toBe("number");
  expect(typeof syncStatus.sources?.blocked_count).toBe("number");
  expect(syncStatus.ready?.sources).toBe(
    (syncStatus.sources?.external_source_count ?? 0) > 0 && syncStatus.sources?.blocked_count === 0
  );

  const scheduleResponse = await page.request.get("/api/v1/sync-schedule");
  expect(scheduleResponse.ok()).toBe(true);
  const schedulePayload = (await scheduleResponse.json()) as { object?: string };
  expect(schedulePayload.object).toBe("sync_schedule");

  const rejectedResetResponse = await page.request.post("/api/v1/local-data/reset", {
    data: {
      confirmation: "no"
    }
  });
  expect(rejectedResetResponse.status()).toBe(400);
  expect(await rejectedResetResponse.json()).toMatchObject({
    error: "Type DELETE LOCAL DATA to clear local app data."
  });
});

test("core v1 finance API exposes Plaid-backed resources", async ({ page }) => {
  const accountsResponse = await page.request.get("/api/v1/accounts?limit=2");
  expect(accountsResponse.ok()).toBe(true);
  const accountsPayload = (await accountsResponse.json()) as {
    data?: Array<{ id?: string; name?: string; object?: string }>;
    object?: string;
  };
  expect(accountsPayload.object).toBe("list");
  expect(accountsPayload.data?.[0]?.object).toBe("account");
  expect(accountsPayload.data?.some((account) => account.name === "E2E Checking")).toBe(true);

  const transactionsResponse = await page.request.get("/api/v1/transactions?limit=3");
  expect(transactionsResponse.ok()).toBe(true);
  const transactionsPayload = (await transactionsResponse.json()) as {
    data?: Array<{ category?: unknown; id?: string; merchant_name?: string; needs_review?: boolean; object?: string }>;
    object?: string;
  };
  expect(transactionsPayload.object).toBe("list");
  expect(transactionsPayload.data?.[0]?.object).toBe("transaction");
  expect(transactionsPayload.data?.[0]?.merchant_name).toBe("E2E Grocer Market");
  expect(transactionsPayload.data?.[0]?.category).toBeTruthy();
  expect(typeof transactionsPayload.data?.[0]?.needs_review).toBe("boolean");

  const reviewTransactionsResponse = await page.request.get("/api/v1/transactions?review=actionable&limit=8");
  expect(reviewTransactionsResponse.ok()).toBe(true);
  const reviewTransactionsPayload = (await reviewTransactionsResponse.json()) as {
    data?: Array<{ category_id?: string; needs_review?: boolean; reviewed?: boolean }>;
    object?: string;
  };
  expect(reviewTransactionsPayload.object).toBe("list");
  expect(reviewTransactionsPayload.data?.length).toBeGreaterThan(0);
  expect(reviewTransactionsPayload.data?.every((transaction) => transaction.needs_review === true)).toBe(true);
  expect(reviewTransactionsPayload.data?.every((transaction) => transaction.reviewed === false)).toBe(true);
  expect(reviewTransactionsPayload.data?.some((transaction) => transaction.category_id === "cat_income" || transaction.category_id === "cat_transfer")).toBe(false);

  const transactionId = transactionsPayload.data?.[0]?.id;
  expect(transactionId).toBeTruthy();
  const transactionResponse = await page.request.get(`/api/v1/transactions/${encodeURIComponent(transactionId!)}`);
  expect(transactionResponse.ok()).toBe(true);
  const transactionPayload = (await transactionResponse.json()) as { id?: string; object?: string };
  expect(transactionPayload).toMatchObject({ id: transactionId, object: "transaction" });

  const categoriesResponse = await page.request.get("/api/v1/categories?include_empty=true");
  expect(categoriesResponse.ok()).toBe(true);
  const categoriesPayload = (await categoriesResponse.json()) as { data?: Array<{ object?: string }>; object?: string };
  expect(categoriesPayload.object).toBe("list");
  expect(categoriesPayload.data?.[0]?.object).toBe("category");

  const recurringsResponse = await page.request.get("/api/v1/recurrings?limit=5");
  expect(recurringsResponse.ok()).toBe(true);
  const recurringsPayload = (await recurringsResponse.json()) as { object?: string };
  expect(recurringsPayload.object).toBe("list");

  const dashboardResponse = await page.request.get("/api/v1/dashboard-summary");
  expect(dashboardResponse.ok()).toBe(true);
  const dashboardPayload = (await dashboardResponse.json()) as { net_worth?: number; object?: string; source?: string };
  expect(dashboardPayload.object).toBe("dashboard_summary");
  expect(dashboardPayload.source).toBe("koban");
  expect(typeof dashboardPayload.net_worth).toBe("number");

  const invalidSourceLimitResponse = await page.request.get("/api/v1/source-items?limit=abc");
  expect(invalidSourceLimitResponse.ok()).toBe(true);
  const invalidSourceLimitPayload = (await invalidSourceLimitResponse.json()) as { data?: unknown[]; object?: string };
  expect(invalidSourceLimitPayload.object).toBe("list");
  expect(Array.isArray(invalidSourceLimitPayload.data)).toBe(true);

  const invalidSearchLimitResponse = await page.request.get("/api/v1/search?q=e2e&limit=abc");
  expect(invalidSearchLimitResponse.ok()).toBe(true);
  const invalidSearchLimitPayload = (await invalidSearchLimitResponse.json()) as { data?: unknown[]; object?: string };
  expect(invalidSearchLimitPayload.object).toBe("list");
  expect(Array.isArray(invalidSearchLimitPayload.data)).toBe(true);
});

test("mutating APIs reject malformed JSON with deliberate 400 errors", async ({ page }) => {
  const malformedAssistant = await postMalformedJson(page, "/api/v1/assistant");
  expect(malformedAssistant.status()).toBe(400);
  expect(await malformedAssistant.json()).toMatchObject({ error: "Request body must be valid JSON." });

  const malformedSync = await postMalformedJson(page, "/api/v1/sync-runs");
  expect(malformedSync.status()).toBe(400);
  expect(await malformedSync.json()).toMatchObject({ error: "Request body must be valid JSON." });

  const malformedSourceSync = await postMalformedJson(page, "/api/v1/sources/sync-runs");
  expect(malformedSourceSync.status()).toBe(400);
  expect(await malformedSourceSync.json()).toMatchObject({ error: "Request body must be valid JSON." });

  const transactionsResponse = await page.request.get("/api/v1/transactions?limit=1");
  const transactionsPayload = (await transactionsResponse.json()) as { data?: Array<{ id?: string }> };
  const transactionId = transactionsPayload.data?.[0]?.id;
  expect(transactionId).toBeTruthy();

  const malformedTransaction = await page.request.fetch(`/api/v1/transactions/${encodeURIComponent(transactionId!)}`, {
    data: Buffer.from("{"),
    headers: {
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });
  expect(malformedTransaction.status()).toBe(400);
  expect(await malformedTransaction.json()).toMatchObject({ error: "Request body must be valid JSON." });

  const nonObjectImport = await page.request.fetch("/api/v1/sources/source_instacart/imports", {
    data: Buffer.from("[]"),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  expect(nonObjectImport.status()).toBe(400);
  expect(await nonObjectImport.json()).toMatchObject({ error: "Request body must be a JSON object." });

  const sourcesBeforeDryRun = (await (await page.request.get("/api/v1/sources")).json()) as {
    data?: Array<{ id?: string; storage?: { source_item_count?: number } }>;
  };
  const airbnbCountBeforeDryRun =
    sourcesBeforeDryRun.data?.find((source) => source.id === "source_airbnb")?.storage?.source_item_count ?? 0;
  const multipartImport = await page.request.post("/api/v1/sources/source_airbnb/imports", {
    multipart: {
      dry_run: "true",
      file: {
        buffer: Buffer.from(
          [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "BEGIN:VEVENT",
            "UID:e2e-import-route",
            "DTSTART;VALUE=DATE:20260610",
            "SUMMARY:Airbnb reservation import route check",
            "DESCRIPTION:Confirmation code: HMROUTE1\\nTrip receipt total $10.00",
            "END:VEVENT",
            "END:VCALENDAR"
          ].join("\n")
        ),
        mimeType: "text/calendar",
        name: "route-check.ics"
      }
    }
  });
  expect(multipartImport.status()).toBe(200);
  expect(await multipartImport.json()).toMatchObject({
    item_count: 1,
    object: "source_import_preview",
    source_id: "source_airbnb"
  });
  const sourcesAfterDryRun = (await (await page.request.get("/api/v1/sources")).json()) as {
    data?: Array<{ id?: string; storage?: { source_item_count?: number } }>;
  };
  const airbnbCountAfterDryRun =
    sourcesAfterDryRun.data?.find((source) => source.id === "source_airbnb")?.storage?.source_item_count ?? 0;
  expect(airbnbCountAfterDryRun).toBe(airbnbCountBeforeDryRun);

  const multipartQueryDryRun = await page.request.post("/api/v1/sources/source_airbnb/imports?dry_run=true", {
    multipart: {
      file: {
        buffer: Buffer.from(
          [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "BEGIN:VEVENT",
            "UID:e2e-import-query-route",
            "DTSTART;VALUE=DATE:20260611",
            "SUMMARY:Airbnb reservation import query route check",
            "DESCRIPTION:Confirmation code: HMQUERY1\\nTrip receipt total $11.00",
            "END:VEVENT",
            "END:VCALENDAR"
          ].join("\n")
        ),
        mimeType: "text/calendar",
        name: "query-route-check.ics"
      }
    }
  });
  expect(multipartQueryDryRun.status()).toBe(200);
  expect(await multipartQueryDryRun.json()).toMatchObject({
    item_count: 1,
    object: "source_import_preview",
    source_id: "source_airbnb"
  });
  const sourcesAfterQueryDryRun = (await (await page.request.get("/api/v1/sources")).json()) as {
    data?: Array<{ id?: string; storage?: { source_item_count?: number } }>;
  };
  const airbnbCountAfterQueryDryRun =
    sourcesAfterQueryDryRun.data?.find((source) => source.id === "source_airbnb")?.storage?.source_item_count ?? 0;
  expect(airbnbCountAfterQueryDryRun).toBe(airbnbCountBeforeDryRun);

  const invalidSourceIds = await page.request.post("/api/v1/sync-runs", {
    data: {
      source_ids: ["source_missing"]
    }
  });
  expect(invalidSourceIds.status()).toBe(400);
  expect(await invalidSourceIds.json()).toMatchObject({ error: "Unknown source adapter: source_missing." });
});

test("left-nav finance pages render real ledger views", async ({ page }) => {
  await page.goto("/accounts");
  await expect(page.getByTestId("accounts-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Balance by account" })).toBeVisible();
  await expect(page.getByLabel("Account totals")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent account activity" })).toBeVisible();
  await page.getByLabel(/^View transactions for /).first().click();
  await expect(page).toHaveURL(/\/transactions\?account_id=/);
  await expect(page.getByLabel("Active transaction filters")).toContainText("Account:");

  await page.goto("/categories");
  await expect(page.getByTestId("categories-page")).toBeVisible();
  // "Category rollups" / "Spending by category" headings no longer exist after the Copilot-style
  // two-pane rebuild; assert the workbench's real regions instead: a "Regular Categories" tree
  // (left) and a "Category detail" pane (right).
  await expect(page.getByRole("heading", { name: "Regular Categories", exact: true })).toBeVisible();
  await expect(page.getByLabel("Category totals")).toBeVisible();
  await expect(page.getByLabel("Category detail")).toBeVisible();
  const categoryTree = page.getByLabel("Regular categories");
  // Real ledger-backed spend, not stub data: at least one category row shows a nonzero dollar figure.
  await expect(categoryTree.getByText(/\$[1-9][\d,]*/).first()).toBeVisible();
  const categoryRow = page.getByLabel(/^View /).first();
  const categoryName = (await categoryRow.getAttribute("aria-label"))?.replace(/^View /, "") ?? "";
  expect(categoryName).not.toBe("");
  // The rebuilt categories page has no /transactions?category_id= link -- that click-through was
  // replaced by an inline detail pane. Equivalent-strength interaction assertion: selecting a
  // category row swaps the detail pane's heading to that category's name.
  await categoryRow.click();
  await expect(page.getByRole("heading", { name: categoryName, exact: true })).toBeVisible();

  await page.goto("/investments");
  await expect(page.getByTestId("investments-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Investment accounts", exact: true })).toBeVisible();
  await expect(page.getByLabel("Investment totals")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Synced investment accounts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Net worth mix" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/placeholder portfolio|not fabricated/i);
  const investmentAccountLinks = page.locator('a[href^="/transactions?account_id="]');
  if ((await investmentAccountLinks.count()) > 0) {
    await investmentAccountLinks.first().click();
    await expect(page).toHaveURL(/\/transactions\?account_id=/);
    await expect(page.getByLabel("Active transaction filters")).toContainText("Account:");
    await page.goto("/investments");
  }

  await page.goto("/recurrings");
  await expect(page.getByTestId("recurrings-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recurring candidates" })).toBeVisible();
  await expect(page.getByLabel("Recurring totals")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Detected recurring charges" })).toBeVisible();
  const recurringLinks = page.locator('a[href^="/transactions?category_id="]');
  if ((await recurringLinks.count()) > 0) {
    await recurringLinks.first().click();
    await expect(page).toHaveURL(/\/transactions\?/);
    await expect(page.getByLabel("Active transaction filters")).toBeVisible();
  }
});

function postMalformedJson(page: Page, url: string) {
  return page.request.fetch(url, {
    data: Buffer.from("{"),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

test("rules page lists local transaction rules surface", async ({ page }) => {
  await page.goto("/rules");

  await expect(page.getByRole("heading", { name: "AI enrichment suggestions" })).toBeVisible();
  await expect(page.getByText("LLM provider", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Transaction rules" })).toBeVisible();
  await expect(page.getByLabel("Primary").getByRole("link", { name: "Rules" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate suggestions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check provider" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create rule" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply enabled" })).toBeVisible();

  const response = await page.request.get("/api/v1/rules");
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { data?: unknown[] };
  expect(Array.isArray(payload.data)).toBe(true);

  const suggestionsResponse = await page.request.get("/api/v1/enrichment/suggestions");
  expect(suggestionsResponse.ok()).toBe(true);
  const suggestionsPayload = (await suggestionsResponse.json()) as {
    data?: Array<{
      transaction?: {
        amount?: number;
        date?: string;
        description?: string;
        id?: string;
      };
      transaction_id?: string;
    }>;
  };
  const suggestionWithTransaction = suggestionsPayload.data?.find((suggestion) => suggestion.transaction_id);
  if (suggestionWithTransaction) {
    expect(suggestionWithTransaction.transaction).toMatchObject({
      id: suggestionWithTransaction.transaction_id
    });
    expect(typeof suggestionWithTransaction.transaction?.amount).toBe("number");
    expect(typeof suggestionWithTransaction.transaction?.date).toBe("string");
  }

  const providerResponse = await page.request.get("/api/v1/enrichment/provider");
  expect(providerResponse.ok()).toBe(true);
  const providerPayload = (await providerResponse.json()) as { object?: string };
  expect(providerPayload.object).toBe("enrichment_provider");

  const generateResponse = await page.request.post("/api/v1/enrichment/runs", {
    data: {
      limit: 20
    }
  });
  expect(generateResponse.ok()).toBe(true);
  const pendingSuggestionsResponse = await page.request.get("/api/v1/enrichment/suggestions?limit=20");
  expect(pendingSuggestionsResponse.ok()).toBe(true);
  const pendingSuggestionsPayload = (await pendingSuggestionsResponse.json()) as {
    data?: Array<{ id?: string }>;
  };
  const batchSuggestion = pendingSuggestionsPayload.data?.find((suggestion) => suggestion.id);
  expect(batchSuggestion?.id).toBeTruthy();

  const batchAcceptResponse = await page.request.post("/api/v1/enrichment/suggestions/batch", {
    data: {
      action: "accept",
      suggestion_ids: [batchSuggestion!.id]
    }
  });
  expect(batchAcceptResponse.ok()).toBe(true);
  const batchAcceptPayload = (await batchAcceptResponse.json()) as {
    applied?: Array<{ id?: string }>;
    failed?: unknown[];
    object?: string;
  };
  expect(batchAcceptPayload).toMatchObject({
    object: "list",
    failed: []
  });
  expect(batchAcceptPayload.applied?.[0]).toMatchObject({
    id: batchSuggestion!.id
  });

  const broadRuleResponse = await page.request.post("/api/v1/rules", {
    data: {
      match_field: "merchant_or_description",
      match_operator: "contains",
      name: "Too broad",
      pattern: "payment"
    }
  });
  expect(broadRuleResponse.status()).toBe(400);
  expect(await broadRuleResponse.json()).toMatchObject({
    error: "Contains rule pattern is too broad for automatic transaction updates."
  });

  const exactRuleResponse = await page.request.post("/api/v1/rules", {
    data: {
      enabled: false,
      match_field: "merchant_or_description",
      match_operator: "equals",
      name: `Exact payment smoke ${Date.now()}`,
      pattern: "payment"
    }
  });
  expect(exactRuleResponse.ok()).toBe(true);
  const exactRulePayload = (await exactRuleResponse.json()) as { rule?: { id?: string } };
  const exactRuleId = exactRulePayload.rule?.id;
  expect(exactRuleId).toBeTruthy();

  const unsafePatchResponse = await page.request.patch(`/api/v1/rules/${encodeURIComponent(exactRuleId!)}`, {
    data: {
      match_operator: "contains"
    }
  });
  expect(unsafePatchResponse.status()).toBe(400);
  expect(await unsafePatchResponse.json()).toMatchObject({
    error: "Contains rule pattern is too broad for automatic transaction updates."
  });

  const regexRuleResponse = await page.request.post("/api/v1/rules", {
    data: {
      category_id: "cat_software",
      match_field: "merchant_or_description",
      match_operator: "regex",
      name: `Regex smoke ${Date.now()}`,
      pattern: "^E2E (Cloud|Design)",
      tags: ["regex-smoke"]
    }
  });
  expect(regexRuleResponse.ok()).toBe(true);
  const regexRulePayload = (await regexRuleResponse.json()) as {
    apply_result?: { rulesApplied?: number; transactionsUpdated?: number };
    rule?: { id?: string; last_applied_count?: number; match_operator?: string };
  };
  const regexRuleId = regexRulePayload.rule?.id;
  expect(regexRulePayload.apply_result).toMatchObject({
    rulesApplied: 1,
    transactionsUpdated: 7
  });
  expect(regexRulePayload.rule).toMatchObject({
    last_applied_count: 7,
    match_operator: "regex"
  });
  expect(regexRuleId).toBeTruthy();
  await page.request.delete(`/api/v1/rules/${encodeURIComponent(regexRuleId!)}`);
  await page.request.delete(`/api/v1/rules/${encodeURIComponent(exactRuleId!)}`);
});

test("semantic search returns local finance results", async ({ page }) => {
  await page.goto("/search?q=E2E%20Grocer");

  await expect(page.getByTestId("semantic-search-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Semantic finance search" })).toBeVisible();
  await expect(page.getByTestId("semantic-search-result").first()).toBeVisible();

  const response = await page.request.get("/api/v1/search?q=E2E%20Grocer&limit=3");
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { data?: Array<{ title?: string }> };
  expect(payload.data?.length).toBeGreaterThan(0);
  expect(payload.data?.some((result) => result.title === "E2E Grocer Market")).toBe(true);
  await page.screenshot({ fullPage: true, path: "test-results/search-smoke.png" });
});

test("Dollarwise-inspired review, insights, and category management flows render in both themes", async ({ page }) => {
  await page.goto("/review");
  await expect(page.getByTestId("review-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review Transactions" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Accept/ })).toBeEnabled();
  await setTheme(page, "light");
  await page.screenshot({ fullPage: true, path: "test-results/review-light.png" });
  await setTheme(page, "dark");
  await page.screenshot({ fullPage: true, path: "test-results/review-dark.png" });

  await page.getByRole("button", { name: /Accept/ }).click();
  await expect(page.getByRole("heading", { name: "E2E Cloud Tools" })).toBeVisible();
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(page.getByRole("heading", { name: "E2E Grocer Market" })).toBeVisible();

  await page.goto("/insights");
  await expect(page.getByTestId("insights-page")).toBeVisible();
  await setTheme(page, "light");
  await page.screenshot({ fullPage: true, path: "test-results/insights-light.png" });
  await setTheme(page, "dark");
  await page.screenshot({ fullPage: true, path: "test-results/insights-dark.png" });

  await page.goto("/categories");
  await expect(page.getByTestId("categories-page")).toBeVisible();
  await expect(page.getByLabel("System category").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Show archived" })).toBeVisible();
  await setTheme(page, "light");
  await page.screenshot({ fullPage: true, path: "test-results/categories-management-light.png" });
  await setTheme(page, "dark");
  await page.screenshot({ fullPage: true, path: "test-results/categories-management-dark.png" });
});

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((nextTheme) => {
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    document.documentElement.style.colorScheme = nextTheme;
  }, theme);
}

test("finance agent answers with local ledger evidence and a chart", async ({ page }) => {
  const question = "Where did my money go this month?";

  await page.goto(`/?ask=${encodeURIComponent(question)}`);

  const panel = page.getByTestId("agent-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Finance question")).toHaveValue(question);
  await expect(panel.getByTestId("agent-answer-text")).toContainText(/spending/i, { timeout: 15_000 });
  await expect(panel.getByLabel("Answer metrics")).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByTestId("agent-answer-metric").first()).toBeVisible();
  await expect(panel.getByTestId("agent-chart")).toBeVisible();

  const response = await page.request.post("/api/v1/assistant", {
    data: {
      local_only: true,
      question: "What transactions need review first?"
    }
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { chart?: unknown; evidence?: unknown[]; object?: string };
  expect(payload.object).toBe("finance_assistant_response");
  expect(payload.chart).toBeTruthy();
  expect(payload.evidence?.length).toBeGreaterThan(0);

  const sourceStatusResponse = await page.request.post("/api/v1/assistant", {
    data: {
      local_only: true,
      message: "Which sources are connected?"
    }
  });
  expect(sourceStatusResponse.ok()).toBe(true);
  const sourceStatusPayload = (await sourceStatusResponse.json()) as {
    answer?: string;
    evidence?: unknown[];
    metrics?: Array<{ label?: string }>;
    object?: string;
  };
  expect(sourceStatusPayload.object).toBe("finance_assistant_response");
  expect(sourceStatusPayload.answer).toContain("no Gmail, Amazon, Instacart, Airbnb, or Outlook records have been imported yet");
  expect(sourceStatusPayload.metrics?.some((metric) => metric.label === "Source items")).toBe(true);
  expect(sourceStatusPayload.evidence).toEqual([]);

  await page.screenshot({ fullPage: true, path: "test-results/agent-panel-smoke.png" });
});
