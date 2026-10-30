import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "@playwright/test";

const fixtureBaseUrl = `http://127.0.0.1:${process.env.KOBAN_E2E_PORT ?? 3008}`;
const agentPackageJson = path.resolve(process.cwd(), "../../packages/agent-interface/package.json");
const agentRequire = createRequire(agentPackageJson);
const { Client } = agentRequire("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = agentRequire("@modelcontextprotocol/sdk/client/stdio.js");
const mcpEntry = path.resolve(process.cwd(), "../../packages/agent-interface/src/mcp.js");

test("MCP agent can enrich a transaction through the isolated backend", async () => {
  test.setTimeout(60_000);
  const client = new Client({ name: "koban-e2e", version: "0.1.0" });
  const transport = new StdioClientTransport({
    args: [mcpEntry],
    command: process.execPath,
    env: {
      KOBAN_API_TOKEN: "",
      KOBAN_BASE_URL: fixtureBaseUrl,
      KOBAN_CONFIG: "none",
      NODE_ENV: "test",
      PATH: process.env.PATH ?? ""
    },
    stderr: "pipe"
  });

  try {
    await client.connect(transport);
    const listedTools = await client.listTools();
    expect(listedTools.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining([
        "koban_get_source_diagnostics",
        "koban_import_source",
        "koban_list_transactions",
        "koban_modify_transaction_tags",
        "koban_add_transaction_context_note",
        "koban_attach_transaction_evidence"
      ])
    );

    const sourceDiagnostics = await callTool(client, "koban_get_source_diagnostics", {});
    expect(sourceDiagnostics).toMatchObject({ object: "list" });
    expect(sourceDiagnostics.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "source_gmail", object: "source_adapter" })])
    );
    expect(sourceDiagnostics.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "source_shop_orders", object: "source_adapter" })])
    );
    const syncStatus = await callTool(client, "koban_get_sync_status", {});
    expect(syncStatus).toMatchObject({ object: "app_sync_status" });
    expect(syncStatus).toHaveProperty("plaid.ready_for_sync");
    expect(syncStatus).toHaveProperty("snaptrade.ready_for_sync");

    const receiptExternalId = "agent-interface-e2e-receipt";
    const receiptTitle = "Receipt from E2E Grocer Market for agent interface";
    const imported = await callTool(client, "koban_import_source", {
      content: JSON.stringify({
        messages: [
          {
            id: receiptExternalId,
            internalDate: String(Date.parse("2026-06-28T12:00:00.000Z")),
            payload: {
              headers: [
                { name: "Subject", value: receiptTitle },
                { name: "From", value: "E2E Grocer Market <receipts@example.test>" }
              ]
            },
            snippet: "Receipt total: $96.42 USD"
          }
        ]
      }),
      content_encoding: "text",
      filename: "agent-interface-e2e-gmail.json",
      source_id: "source_gmail"
    });
    expect(imported).toMatchObject({ itemsWritten: 1, sourceId: "source_gmail" });

    const shopOrder = {
      __typename: "Order", uuid: "shop-e2e-order", id: "shop-e2e-order-id",
      createdAt: "2026-06-28T12:00:00.000Z", displayStatus: "DELIVERED", totalItemCount: 2,
      effectiveTotalPrice: { amount: "96.42", currencyCode: "USD" },
      shop: { name: "E2E Grocer Market" },
      lineItems: { nodes: [{ productTitle: "Fixture groceries", quantity: 2 }] }
    };
    const shopImport = await callTool(client, "koban_import_source", {
      source_id: "source_shop_orders", filename: "shop.json",
      content: JSON.stringify({ data: { deliveriesOrdersList: {
        nodes: [shopOrder, { __typename: "Delivery", order: shopOrder }],
        pageInfo: { hasNextPage: false, endCursor: null }
      } } })
    });
    expect(shopImport).toMatchObject({ itemsWritten: 1, sourceId: "source_shop_orders" });
    const shopItems = await callTool(client, "koban_list_source_items", { source_id: "source_shop_orders", q: "shop-e2e-order", limit: 5 });
    expect(shopItems.data).toHaveLength(1);
    expect(shopItems.data[0]).toMatchObject({ kind: "order", merchant_name: "E2E Grocer Market" });
    expect(shopItems.data[0].summary).toContain("Fixture groceries");

    const sourceItems = await callTool(client, "koban_list_source_items", {
      limit: 5,
      q: receiptExternalId,
      source_id: "source_gmail"
    });
    const receipt = sourceItems.data.find((item: { external_id?: string }) => item.external_id === receiptExternalId);
    expect(receipt).toMatchObject({ object: "source_item", title: receiptTitle });

    const transactionList = await callTool(client, "koban_list_transactions", {
      limit: 5,
      q: "E2E Grocer Market"
    });
    const transaction = transactionList.data.find((item: { id?: string }) => item.id === "txn_e2e_040");
    expect(transaction).toMatchObject({
      category_id: "cat_food",
      id: "txn_e2e_040",
      tags: expect.arrayContaining(["synthetic-e2e"])
    });

    const initialEvidence = await callTool(client, "koban_list_transaction_evidence", {
      transaction_id: transaction.id
    });
    expect(initialEvidence).toMatchObject({ object: "list" });
    expect(initialEvidence.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ relationship: "order", status: "suggested", source_item: expect.objectContaining({ id: shopItems.data[0].id }) })
    ]));

    const category = await callTool(client, "koban_create_category", {
      color: "#7c6f64",
      emoji: "🧾",
      name: "Agent Interface E2E"
    });
    expect(category).toMatchObject({ name: "Agent Interface E2E", object: "category" });

    const existingNote = "Existing note that context evidence must not replace.";
    const categorized = await callTool(client, "koban_update_transaction", {
      category_id: category.id,
      notes: existingNote,
      transaction_id: transaction.id
    });
    expect(categorized).toMatchObject({
      category_id: category.id,
      notes: existingNote,
      tags: expect.arrayContaining(["synthetic-e2e"])
    });

    await Promise.all([
      callTool(client, "koban_modify_transaction_tags", {
        add: ["agent-interface-one"],
        transaction_id: transaction.id
      }),
      callTool(client, "koban_modify_transaction_tags", {
        add: ["agent-interface-two"],
        transaction_id: transaction.id
      })
    ]);
    const afterRemoval = await callTool(client, "koban_modify_transaction_tags", {
      remove: ["agent-interface-one"],
      transaction_id: transaction.id
    });
    expect(afterRemoval.tags).toEqual(expect.arrayContaining(["synthetic-e2e", "agent-interface-two"]));
    expect(afterRemoval.tags).not.toContain("agent-interface-one");

    const emptyTagResult = await client.callTool({
      arguments: { add: [], remove: [], transaction_id: transaction.id },
      name: "koban_modify_transaction_tags"
    });
    expect(emptyTagResult).toMatchObject({ isError: true });
    expect(toolText(emptyTagResult)).toContain("INVALID_ARGUMENTS");
    const unknownFieldResult = await client.callTool({
      arguments: { add: ["ignored"], extra: true, transaction_id: transaction.id },
      name: "koban_modify_transaction_tags"
    });
    expect(unknownFieldResult).toMatchObject({ isError: true });
    expect(toolText(unknownFieldResult)).toContain("INVALID_ARGUMENTS");

    const contextBody = "This grocery purchase was for the isolated MCP acceptance workflow.";
    const contextNote = await callTool(client, "koban_add_transaction_context_note", {
      body: contextBody,
      transaction_id: transaction.id
    });
    expect(contextNote).toMatchObject({
      object: "context_note",
      source_item: { kind: "context_note", summary: contextBody }
    });

    const attached = await callTool(client, "koban_attach_transaction_evidence", {
      confidence: 1,
      relationship: "receipt",
      source_item_id: receipt.id,
      status: "accepted",
      transaction_id: transaction.id
    });
    expect(attached).toMatchObject({
      object: "transaction_evidence",
      relationship: "receipt",
      source_item: { id: receipt.id },
      status: "accepted",
      transaction_id: transaction.id
    });

    const readback = await callTool(client, "koban_get_transaction", {
      transaction_id: transaction.id
    });
    expect(readback).toMatchObject({
      category_id: category.id,
      notes: existingNote,
      tags: expect.arrayContaining(["synthetic-e2e", "agent-interface-two"])
    });
    expect(readback.tags).not.toContain("agent-interface-one");

    const evidenceReadback = await callTool(client, "koban_list_transaction_evidence", {
      transaction_id: transaction.id
    });
    expect(evidenceReadback.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationship: "user_context",
          source_item: expect.objectContaining({ id: contextNote.source_item.id, summary: contextBody }),
          status: "accepted"
        }),
        expect.objectContaining({
          relationship: "receipt",
          source_item: expect.objectContaining({ id: receipt.id }),
          status: "accepted"
        })
      ])
    );
    const shopEvidence = await callTool(client, "koban_attach_transaction_evidence", {
      transaction_id: transaction.id, source_item_id: shopItems.data[0].id,
      relationship: "order", status: "accepted", confidence: 1
    });
    expect(shopEvidence).toMatchObject({ status: "accepted", relationship: "order", source_item: { id: shopItems.data[0].id } });

    const mailboxItemIds = new Set<string>();
    for (const [provider, profile] of [["gmail", "personal"], ["gmail", "work"], ["outlook", "personal"], ["outlook", "work"], ["icloud", "personal"]]) {
      const registered = await fetch(`${fixtureBaseUrl}/api/v1/mail-accounts`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, profile, email: `${profile}@example.test`, ...(provider === "icloud" ? { app_password: "fixture-app-specific-password" } : {}) })
      });
      expect(registered.status).toBe(201);
      const account = await registered.json();
      expect(JSON.stringify(account)).not.toContain("fixture-app-specific-password");
      const mail = provider === "gmail"
        ? { messages: [{ id: "same-mail-id", internalDate: String(Date.parse("2026-06-28T12:00:00Z")), snippet: "Groceries receipt $96.42", payload: { headers: [{ name: "Subject", value: "Mailbox receipt" }] } }] }
        : { value: [{ id: "same-mail-id", subject: "Mailbox receipt", bodyPreview: "Groceries receipt $96.42", receivedDateTime: "2026-06-28T12:00:00Z" }] };
      const importedMail = await callTool(client, "koban_import_source", { source_id: account.id, filename: "mail.json", content: JSON.stringify(mail) });
      expect(importedMail).toMatchObject({ itemsWritten: 1, sourceId: account.id });
      const mailItems = await callTool(client, "koban_list_source_items", { source_id: account.id, limit: 5 });
      expect(mailItems.data).toHaveLength(1);
      mailboxItemIds.add(mailItems.data[0].id);
    }
    expect(mailboxItemIds.size).toBe(5);
  } finally {
    await client.close();
  }
});

async function callTool(client: InstanceType<typeof Client>, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ arguments: args, name });
  expect(result.isError, toolText(result)).not.toBe(true);
  return JSON.parse(toolText(result));
}

function toolText(result: { content?: Array<{ text?: string; type: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  expect(text).toBeTruthy();
  return text!;
}
