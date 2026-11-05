import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";

test("real MCP client lists annotated tools and calls the shared backend client", async () => {
  const requests = [];
  const server = createMcpServer({
    clientOptions: {
      configuration: {
        baseUrl: "http://127.0.0.1:3007",
        token: "mcp-test-token",
        tokenSource: "config"
      },
      fetchImpl: async (url, options) => {
        requests.push({
          authorization: options.headers.authorization,
          method: options.method,
          url: String(url)
        });
        return Response.json({ object: "sync_status" });
      }
    }
  });
  const client = new Client({ name: "koban-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const readTool = listed.tools.find((tool) => tool.name === "koban_get_sync_status");
    const writeTool = listed.tools.find((tool) => tool.name === "koban_update_transaction");
    assert.equal(listed.tools.length, 35);
    assert.deepEqual(readTool?.annotations, {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: true
    });
    assert.deepEqual(writeTool?.annotations, {
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
      readOnlyHint: false
    });

    const result = await client.callTool({ name: "koban_get_sync_status", arguments: {} });
    assert.deepEqual(result, {
      content: [{ type: "text", text: JSON.stringify({ object: "sync_status" }) }]
    });
    assert.deepEqual(requests, [{
      authorization: "Bearer mcp-test-token",
      method: "GET",
      url: "http://127.0.0.1:3007/api/v1/sync-runs"
    }]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP tool errors are bounded protocol results", async () => {
  const server = createMcpServer();
  const client = new Client({ name: "koban-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({
      name: "koban_list_transactions",
      arguments: { unexpected: true }
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text ?? "", /^INVALID_ARGUMENTS:/);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP cancellation aborts the backend request without retrying", async () => {
  let fetchCalls = 0;
  let backendAborted = false;
  let markFetchStarted;
  const fetchStarted = new Promise((resolve) => {
    markFetchStarted = resolve;
  });
  const server = createMcpServer({
    clientOptions: {
      configuration: {
        baseUrl: "http://127.0.0.1:3007",
        tokenSource: "none"
      },
      fetchImpl: async (_url, options) => {
        fetchCalls += 1;
        markFetchStarted();
        return await new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            backendAborted = true;
            reject(options.signal.reason);
          }, { once: true });
        });
      }
    }
  });
  const client = new Client({ name: "koban-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const controller = new AbortController();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const call = client.callTool(
      { name: "koban_get_sync_status", arguments: {} },
      undefined,
      { signal: controller.signal }
    );
    await fetchStarted;
    controller.abort(new Error("caller cancelled"));

    await assert.rejects(call);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(backendAborted, true);
    assert.equal(fetchCalls, 1);
  } finally {
    await client.close();
    await server.close();
  }
});
