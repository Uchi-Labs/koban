import assert from "node:assert/strict";
import test from "node:test";
import Ajv from "ajv";
import { operations } from "./catalog.js";

const expectedNames = [
  "koban_list_accounts",
  "koban_get_account",
  "koban_update_account",
  "koban_list_categories",
  "koban_create_category",
  "koban_update_category",
  "koban_list_transactions",
  "koban_get_transaction",
  "koban_update_transaction",
  "koban_modify_transaction_tags",
  "koban_bulk_categorize_transactions",
  "koban_get_source_diagnostics",
  "koban_import_source",
  "koban_sync_source",
  "koban_search_source",
  "koban_sync_sources",
  "koban_list_source_items",
  "koban_list_evidence",
  "koban_add_transaction_context_note",
  "koban_list_transaction_evidence",
  "koban_list_transaction_line_items",
  "koban_search_line_items",
  "koban_split_line_item",
  "koban_list_recurrings",
  "koban_attach_transaction_evidence",
  "koban_review_transaction_evidence",
  "koban_list_tags",
  "koban_upsert_tag",
  "koban_list_rules",
  "koban_create_rule",
  "koban_preview_rule",
  "koban_apply_rules",
  "koban_semantic_search",
  "koban_get_sync_status",
  "koban_run_sync"
];

test("exports a unique, closed-schema operation catalog", () => {
  assert.deepEqual(operations.map(({ name }) => name), expectedNames);
  assert.equal(new Set(expectedNames).size, expectedNames.length);

  for (const operation of operations) {
    assert.match(operation.name, /^koban_[a-z0-9_]+$/);
    assert.equal(typeof operation.description, "string");
    assert.ok(operation.description.length > 0);
    assert.equal(typeof operation.readOnly, "boolean");
    assert.equal(operation.inputSchema.type, "object");
    assert.equal(operation.inputSchema.additionalProperties, false);
    assert.equal(typeof operation.request, "function");
  }

  const tagPatch = operations.find(({ name }) => name === "koban_modify_transaction_tags");
  assert.equal(tagPatch.inputSchema.properties.add.maxItems, 100);
  assert.equal(tagPatch.inputSchema.properties.add.minItems, 1);
  assert.equal(tagPatch.inputSchema.properties.add.items.minLength, 1);
  assert.equal(tagPatch.inputSchema.properties.add.items.maxLength, 100);
  const validateTagPatch = new Ajv({ strict: false }).compile(tagPatch.inputSchema);
  assert.equal(validateTagPatch({ add: [], transaction_id: "txn_1" }), false);
  assert.equal(validateTagPatch({ add: ["work"], transaction_id: "txn_1" }), true);
});

test("maps operation arguments to authoritative backend request shapes", () => {
  const cases = [
    ["koban_list_accounts", { institution: "Bank", limit: 20, starting_after: "acct 1", type: "checking" }, { method: "GET", path: "/api/v1/accounts", query: { institution: "Bank", limit: 20, starting_after: "acct 1", type: "checking" } }],
    ["koban_get_account", { account_id: "acct/a" }, { method: "GET", path: "/api/v1/accounts/acct%2Fa" }],
    ["koban_update_account", { account_id: "acct/a", included_in_net_worth: false, name: null }, { method: "PATCH", path: "/api/v1/accounts/acct%2Fa", body: { included_in_net_worth: false, name: null } }],
    ["koban_list_categories", { include_archived: true, include_empty: false, limit: 25 }, { method: "GET", path: "/api/v1/categories", query: { include_archived: "true", include_empty: "false", limit: 25 } }],
    ["koban_create_category", { budget_amount: 200, color: "#fff", emoji: "🍜", name: "Dining" }, { method: "POST", path: "/api/v1/categories", body: { budget_amount: 200, color: "#fff", emoji: "🍜", name: "Dining" } }],
    ["koban_update_category", { archived: true, budget_amount: null, category_id: "cat/a", sort_order: 4 }, { method: "PATCH", path: "/api/v1/categories/cat%2Fa", body: { archived: true, budget_amount: null, sort_order: 4 } }],
    ["koban_list_transactions", { account_id: "acct_1", limit: 10, max_amount: 50, min_amount: 5, q: "coffee", review: "actionable", reviewed: false, starting_after: "txn_0", status: "posted" }, { method: "GET", path: "/api/v1/transactions", query: { account_id: "acct_1", limit: 10, max_amount: 50, min_amount: 5, q: "coffee", review: "actionable", reviewed: "false", starting_after: "txn_0", status: "posted" } }],
    ["koban_get_transaction", { transaction_id: "txn/a" }, { method: "GET", path: "/api/v1/transactions/txn%2Fa" }],
    ["koban_update_transaction", { category_id: "cat_food", notes: "Client dinner", reviewed: true, tags: ["work"], transaction_id: "txn/a" }, { method: "PATCH", path: "/api/v1/transactions/txn%2Fa", body: { category_id: "cat_food", notes: "Client dinner", reviewed: true, tags: ["work"] } }],
    ["koban_modify_transaction_tags", { add: ["work"], remove: ["personal"], transaction_id: "txn/a" }, { method: "PATCH", path: "/api/v1/transactions/txn%2Fa/tags", body: { add: ["work"], remove: ["personal"] } }],
    ["koban_bulk_categorize_transactions", { category_id: "cat_food", field: "merchant_name", match: "Cafe", operator: "contains" }, { method: "POST", path: "/api/v1/transactions/bulk-categorize", body: { category_id: "cat_food", field: "merchant_name", match: "Cafe", operator: "contains" } }],
    ["koban_get_source_diagnostics", {}, { method: "GET", path: "/api/v1/sources" }],
    ["koban_import_source", { content: "[]", content_encoding: "text", dry_run: true, filename: "orders.json", source_id: "amazon/orders" }, { method: "POST", path: "/api/v1/sources/amazon%2Forders/imports", body: { content: "[]", content_encoding: "text", dry_run: true, filename: "orders.json" } }],
    ["koban_sync_source", { source_id: "gmail/main" }, { method: "POST", path: "/api/v1/sources/gmail%2Fmain/sync-runs" }],
    ["koban_search_source", { from: "2026-09-06", q: "honda", source_id: "source_gmail__personal", to: "2026-09-11" }, { method: "POST", path: "/api/v1/sources/source_gmail__personal/search", body: { from: "2026-09-06", q: "honda", to: "2026-09-11" } }],
    ["koban_sync_sources", { source_ids: ["gmail", "amazon"] }, { method: "POST", path: "/api/v1/sources/sync-runs", body: { source_ids: ["gmail", "amazon"] } }],
    ["koban_list_source_items", { limit: 40, q: "receipt", source_id: "gmail" }, { method: "GET", path: "/api/v1/source-items", query: { limit: 40, q: "receipt", source_id: "gmail" } }],
    ["koban_list_source_items", { amount: 564.6, from: "2026-09-01", kind: "email", q: "honda invoice", source_id: "source_gmail", to: "2026-09-10" }, { method: "GET", path: "/api/v1/source-items", query: { amount: 564.6, from: "2026-09-01", kind: "email", q: "honda invoice", source_id: "source_gmail", to: "2026-09-10" } }],
    ["koban_list_evidence", { limit: 30, status: "suggested" }, { method: "GET", path: "/api/v1/evidence", query: { limit: 30, status: "suggested" } }],
    ["koban_add_transaction_context_note", { body: "Annual membership", transaction_id: "txn/a" }, { method: "POST", path: "/api/v1/transactions/txn%2Fa/context-notes", body: { body: "Annual membership", preserve_notes: true } }],
    ["koban_list_transaction_evidence", { transaction_id: "txn/a" }, { method: "GET", path: "/api/v1/transactions/txn%2Fa/evidence" }],
    ["koban_list_transaction_line_items", { transaction_id: "txn/a" }, { method: "GET", path: "/api/v1/transactions/txn%2Fa/line-items" }],
    ["koban_search_line_items", { from: "2026-01-01", q: "oat milk", to: "2026-11-02" }, { method: "GET", path: "/api/v1/line-items", query: { from: "2026-01-01", q: "oat milk", to: "2026-11-02" } }],
    ["koban_split_line_item", { category_id: "cat_household", position: 2, source_item_id: "src/a" }, { method: "PATCH", path: "/api/v1/source-items/src%2Fa/lines/2", body: { category_id: "cat_household" } }],
    ["koban_attach_transaction_evidence", { confidence: 0.9, relationship: "receipt", source_item_id: "src_1", status: "accepted", transaction_id: "txn/a" }, { method: "POST", path: "/api/v1/transactions/txn%2Fa/evidence", body: { confidence: 0.9, relationship: "receipt", source_item_id: "src_1", status: "accepted" } }],
    ["koban_review_transaction_evidence", { relationship: "receipt", source_item_id: "src/a", status: "dismissed", transaction_id: "txn/a" }, { method: "PATCH", path: "/api/v1/transactions/txn%2Fa/evidence/src%2Fa", body: { relationship: "receipt", status: "dismissed" } }],
    ["koban_list_recurrings", { limit: 20 }, { method: "GET", path: "/api/v1/recurrings", query: { limit: 20 } }],
    ["koban_list_tags", {}, { method: "GET", path: "/api/v1/tag-colors" }],
    ["koban_upsert_tag", { color: null, name: "Travel" }, { method: "POST", path: "/api/v1/tag-colors", body: { color: null, name: "Travel" } }],
    ["koban_list_rules", {}, { method: "GET", path: "/api/v1/rules" }],
    ["koban_create_rule", { category_id: "cat_food", enabled: true, mark_reviewed: false, match_field: "merchant_name", match_operator: "contains", name: "Coffee", pattern: "Cafe", tags: ["coffee"] }, { method: "POST", path: "/api/v1/rules", body: { category_id: "cat_food", enabled: true, mark_reviewed: false, match_field: "merchant_name", match_operator: "contains", name: "Coffee", pattern: "Cafe", tags: ["coffee"] } }],
    ["koban_preview_rule", { field: "description", operator: "regex", value: "coffee.*shop" }, { method: "GET", path: "/api/v1/rules/preview", query: { field: "description", operator: "regex", value: "coffee.*shop" } }],
    ["koban_apply_rules", {}, { method: "POST", path: "/api/v1/rules/apply" }],
    ["koban_semantic_search", { limit: 8, query: "hotel near conference" }, { method: "POST", path: "/api/v1/search", body: { limit: 8, query: "hotel near conference" } }],
    ["koban_get_sync_status", {}, { method: "GET", path: "/api/v1/sync-runs" }],
    ["koban_run_sync", { enrichment_limit: 25, source_ids: ["gmail"] }, { method: "POST", path: "/api/v1/sync-runs", body: { enrichment_limit: 25, source_ids: ["gmail"] } }]
  ];

  for (const [name, args, expected] of cases) {
    const operation = operations.find((candidate) => candidate.name === name);
    assert.ok(operation, `missing operation ${name}`);
    assert.deepEqual(operation.request(args), expected, name);
  }
});

test("omits optional query and body values instead of sending undefined", () => {
  assert.deepEqual(get("koban_list_transactions").request({}), {
    method: "GET",
    path: "/api/v1/transactions"
  });
  assert.deepEqual(get("koban_run_sync").request({}), {
    method: "POST",
    path: "/api/v1/sync-runs"
  });
});

function get(name) {
  const operation = operations.find((candidate) => candidate.name === name);
  assert.ok(operation, `missing operation ${name}`);
  return operation;
}
