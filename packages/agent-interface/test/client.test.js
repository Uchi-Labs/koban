import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  executeOperation,
  KobanClientError,
  resolveConfiguration
} from "../src/client.js";

test("validates arguments before making an HTTP request", async () => {
  let requested = false;

  await assert.rejects(
    executeOperation("koban_list_transactions", { unexpected: true }, {
      configuration: configuration("http://127.0.0.1:1"),
      fetchImpl: async () => {
        requested = true;
        throw new Error("must not run");
      }
    }),
    (error) => error instanceof KobanClientError && error.code === "INVALID_ARGUMENTS"
  );
  assert.equal(requested, false);
});

test("sends validated requests with bearer authentication and backend request shapes", async () => {
  await withServer(async (request, response) => {
    assert.equal(request.method, "PATCH");
    assert.equal(request.url, "/api/v1/transactions/txn%2Fa");
    assert.equal(request.headers.authorization, "Bearer test-token");
    assert.deepEqual(JSON.parse(await readBody(request)), {
      category_id: "cat_food",
      reviewed: true
    });
    json(response, 200, { id: "txn/a", object: "transaction" });
  }, async (baseUrl) => {
    const result = await executeOperation("koban_update_transaction", {
      category_id: "cat_food",
      reviewed: true,
      transaction_id: "txn/a"
    }, {
      configuration: configuration(baseUrl, "test-token")
    });

    assert.deepEqual(result, { id: "txn/a", object: "transaction" });
  });
});

test("does not follow backend redirects", async () => {
  let redirectedRequest = false;
  await withServer((request, response) => {
    if (request.url === "/redirected") {
      redirectedRequest = true;
      json(response, 200, { leaked: true });
      return;
    }
    response.writeHead(302, { location: "/redirected" });
    response.end();
  }, async (baseUrl) => {
    await assert.rejects(
      executeOperation("koban_get_sync_status", {}, {
        configuration: configuration(baseUrl)
      }),
      (error) => error instanceof KobanClientError && error.code === "NETWORK_ERROR"
    );
  });
  assert.equal(redirectedRequest, false);
});

test("bounds request duration and response size", async (context) => {
  await context.test("request timeout", async () => {
    await withServer((_request, _response) => {}, async (baseUrl) => {
      await assert.rejects(
        executeOperation("koban_get_sync_status", {}, {
          configuration: configuration(baseUrl),
          timeoutMs: 10
        }),
        (error) => error instanceof KobanClientError && error.code === "REQUEST_ABORTED"
      );
    });
  });

  await context.test("response size", async () => {
    await withServer((_request, response) => {
      response.writeHead(200, {
        "content-length": String(2 * 1024 * 1024 + 1),
        "content-type": "application/json"
      });
      response.end("{}");
    }, async (baseUrl) => {
      await assert.rejects(
        executeOperation("koban_get_sync_status", {}, {
          configuration: configuration(baseUrl)
        }),
        (error) => error instanceof KobanClientError && error.code === "RESPONSE_TOO_LARGE"
      );
    });
  });

  await context.test("write timeout reports an unknown outcome without retrying", async () => {
    let fetchCalls = 0;
    await assert.rejects(
      executeOperation("koban_update_transaction", {
        reviewed: true,
        transaction_id: "txn_1"
      }, {
        configuration: configuration("http://127.0.0.1:3007"),
        fetchImpl: async (_url, options) => {
          fetchCalls += 1;
          return await new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
          });
        },
        timeoutMs: 10
      }),
      (error) => {
        assert.equal(error.code, "REQUEST_ABORTED");
        assert.match(error.message, /outcome may be unknown; do not automatically retry/);
        return true;
      }
    );
    assert.equal(fetchCalls, 1);
  });
});

test("redacts the configured token from bounded backend errors", async () => {
  const token = "test-secret-token";
  await withServer((_request, response) => {
    json(response, 401, { error: `invalid ${token}` });
  }, async (baseUrl) => {
    await assert.rejects(
      executeOperation("koban_get_sync_status", {}, {
        configuration: configuration(baseUrl, token)
      }),
      (error) => {
        assert.equal(error.code, "HTTP_ERROR");
        assert.doesNotMatch(error.message, /test-secret-token/);
        assert.match(error.message, /\[REDACTED\]/);
        return true;
      }
    );
  });
});

test("redacts tokens before truncating a backend error at its length boundary", async () => {
  const token = "test-secret-token";
  await withServer((_request, response) => {
    json(response, 400, { error: `${"x".repeat(295)}${token}` });
  }, async (baseUrl) => {
    await assert.rejects(
      executeOperation("koban_get_sync_status", {}, {
        configuration: configuration(baseUrl, token)
      }),
      (error) => {
        assert.equal(error.code, "HTTP_ERROR");
        assert.doesNotMatch(error.message, /test-/);
        return true;
      }
    );
  });
});

test("supports environment-only configuration without reading home credentials", async () => {
  const resolved = await resolveConfiguration({
    env: {
      KOBAN_API_TOKEN: "env-token",
      KOBAN_BASE_URL: "http://127.0.0.1:3008",
      KOBAN_CONFIG: "none"
    },
    homeDir: "/path/that/must/not/be/read"
  });

  assert.deepEqual(resolved, {
    baseUrl: "http://127.0.0.1:3008",
    configPath: undefined,
    token: "env-token",
    tokenSource: "environment",
    timeoutMs: undefined
  });
});

test("binds stored credentials to their configured origin", async () => {
  await withConfig({ baseUrl: "https://finance.example.test/base", token: "stored-token" }, async (configPath) => {
    const changedOrigin = await resolveConfiguration({
      env: { KOBAN_BASE_URL: "https://other.example.test", KOBAN_CONFIG: configPath }
    });
    assert.equal(changedOrigin.baseUrl, "https://other.example.test");
    assert.equal(changedOrigin.token, undefined);
    assert.equal(changedOrigin.tokenSource, "none");

    const matchingOrigin = await resolveConfiguration({
      env: { KOBAN_BASE_URL: "https://finance.example.test/another-path", KOBAN_CONFIG: configPath }
    });
    assert.equal(matchingOrigin.token, "stored-token");
    assert.equal(matchingOrigin.tokenSource, "config");

    const explicitToken = await resolveConfiguration({
      env: {
        KOBAN_API_TOKEN: "environment-token",
        KOBAN_BASE_URL: "https://other.example.test",
        KOBAN_CONFIG: configPath
      }
    });
    assert.equal(explicitToken.token, "environment-token");
    assert.equal(explicitToken.tokenSource, "environment");
  });
});

test("an explicitly empty environment token disables stored authentication", async () => {
  await withConfig({ baseUrl: "https://finance.example.test", token: "stored-token" }, async (configPath) => {
    const resolved = await resolveConfiguration({
      env: { KOBAN_API_TOKEN: "", KOBAN_CONFIG: configPath }
    });
    assert.equal(resolved.token, undefined);
    assert.equal(resolved.tokenSource, "none");
  });
});

test("allows plain HTTP only for loopback backends", async () => {
  for (const baseUrl of [
    "http://localhost:3007",
    "http://127.0.0.1:3007",
    "http://[::1]:3007",
    "https://finance.example.test"
  ]) {
    const resolved = await resolveConfiguration({
      env: { KOBAN_BASE_URL: baseUrl, KOBAN_CONFIG: "none" }
    });
    assert.equal(resolved.baseUrl, baseUrl);
  }

  await assert.rejects(
    resolveConfiguration({
      env: { KOBAN_BASE_URL: "http://finance.example.test", KOBAN_CONFIG: "none" }
    }),
    (error) => error instanceof KobanClientError && error.code === "CONFIG_ERROR"
  );

  let requested = false;
  await assert.rejects(
    executeOperation("koban_get_sync_status", {}, {
      configuration: configuration("http://finance.example.test"),
      fetchImpl: async () => {
        requested = true;
        return Response.json({});
      }
    }),
    (error) => error instanceof KobanClientError && error.code === "CONFIG_ERROR"
  );
  assert.equal(requested, false);
});

test("validates bounded timeout overrides from environment and config", async () => {
  const fromEnvironment = await resolveConfiguration({
    env: { KOBAN_CONFIG: "none", KOBAN_TIMEOUT_MS: "600000" }
  });
  assert.equal(fromEnvironment.timeoutMs, 600_000);

  await withConfig({ timeoutMs: 120_000 }, async (configPath) => {
    const fromConfig = await resolveConfiguration({ env: { KOBAN_CONFIG: configPath } });
    assert.equal(fromConfig.timeoutMs, 120_000);
  });

  for (const value of ["", "0", "1200001", "1.5", "forever"]) {
    await assert.rejects(
      resolveConfiguration({ env: { KOBAN_CONFIG: "none", KOBAN_TIMEOUT_MS: value } }),
      (error) => error instanceof KobanClientError && error.code === "CONFIG_ERROR"
    );
  }
});

function configuration(baseUrl, token) {
  return { baseUrl, token, tokenSource: token ? "config" : "none" };
}

async function withConfig(config, run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "koban-client-test-"));
  const configPath = path.join(directory, "config.json");
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  try {
    await run(configPath);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function withServer(handler, run) {
  const server = http.createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      response.destroy(error);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function readBody(request) {
  let value = "";
  for await (const chunk of request) value += chunk;
  return value;
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
