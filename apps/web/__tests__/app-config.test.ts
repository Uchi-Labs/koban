// @vitest-environment node

import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach } from "vitest";
import * as AppConfig from "@/lib/config/AppConfig";
import { bootAppRuntime, disposeAppRuntime } from "@/lib/effect/runtime";
import * as SecretBox from "@/lib/security/SecretBox";

const testKey = randomBytes(32).toString("base64");

function configFrom(env: Record<string, string>) {
  return AppConfig.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))));
}

const readConfig = Effect.gen(function* () {
  return yield* AppConfig.AppConfig;
});

const configFailure = (env: Record<string, string>) =>
  readConfig.pipe(Effect.provide(configFrom(env)), Effect.flip);

describe("AppConfig", () => {
  it.effect("refuses public demo mode on a database whose name lacks 'demo'", () =>
    Effect.gen(function* () {
      const error = yield* configFailure({
        DATABASE_URL: "postgresql://koban@db.internal/finances",
        KOBAN_PUBLIC_DEMO: "1",
        KOBAN_SECRET_KEY: testKey
      });
      expect(error).toBeInstanceOf(AppConfig.AppConfigError);
      expect(error).toMatchObject({ setting: "KOBAN_PUBLIC_DEMO" });
    })
  );

  it.effect("refuses public demo mode on the local PGlite store", () =>
    Effect.gen(function* () {
      const error = yield* configFailure({ KOBAN_PUBLIC_DEMO: "1" });
      expect(error).toMatchObject({ _tag: "AppConfigError", setting: "KOBAN_PUBLIC_DEMO" });
    })
  );

  it.effect("accepts public demo mode on a demo database", () =>
    Effect.gen(function* () {
      const config = yield* readConfig.pipe(
        Effect.provide(
          configFrom({
            DATABASE_URL: "postgresql://koban@db.internal/koban_demo",
            KOBAN_PUBLIC_DEMO: "1",
            KOBAN_SECRET_KEY: testKey
          })
        )
      );
      expect(config).toMatchObject({ mode: "hosted", publicDemo: true });
    })
  );

  it.effect("requires KOBAN_SECRET_KEY in hosted mode", () =>
    Effect.gen(function* () {
      const error = yield* configFailure({ DATABASE_URL: "postgresql://koban@db.internal/finances" });
      expect(error).toMatchObject({ _tag: "AppConfigError", setting: "KOBAN_SECRET_KEY" });
      expect(error.message).toContain("openssl rand -base64 32");
    })
  );

  it.effect("refuses a production server bound off loopback with no sign-in", () =>
    Effect.gen(function* () {
      const unset = yield* configFailure({ NODE_ENV: "production" });
      expect(unset).toMatchObject({ _tag: "AppConfigError", setting: "AI_FINANCES_AUTH_TOKEN" });
      expect(unset.message).toContain("0.0.0.0");

      const wildcard = yield* configFailure({ HOSTNAME: "0.0.0.0", NODE_ENV: "production" });
      expect(wildcard).toMatchObject({ setting: "AI_FINANCES_AUTH_TOKEN" });
    })
  );

  it.effect("boots a production server on loopback, or off loopback with a token", () =>
    Effect.gen(function* () {
      const loopback = yield* readConfig.pipe(Effect.provide(configFrom({ HOSTNAME: "127.0.0.1", NODE_ENV: "production" })));
      expect(loopback.mode).toBe("local");

      const withToken = yield* readConfig.pipe(
        Effect.provide(configFrom({ AI_FINANCES_AUTH_TOKEN: "token", HOSTNAME: "0.0.0.0", NODE_ENV: "production" }))
      );
      expect(withToken.mode).toBe("local");
    })
  );

  it.effect("keeps local state next to an explicit PGlite directory", () =>
    Effect.gen(function* () {
      const config = yield* readConfig.pipe(Effect.provide(configFrom({ AI_FINANCES_PGLITE_DIR: "/srv/koban/pglite" })));
      expect(config.dataDir).toBe("/srv/koban");
      expect(config.secretKeyFile).toBe("/srv/koban/secret-key");
    })
  );
});

describe("app runtime boot", () => {
  const saved = { DATABASE_URL: process.env.DATABASE_URL, KOBAN_PUBLIC_DEMO: process.env.KOBAN_PUBLIC_DEMO };

  afterEach(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await disposeAppRuntime();
  });

  it("refuses to boot public demo mode against a non-demo database", async () => {
    await disposeAppRuntime();
    process.env.KOBAN_PUBLIC_DEMO = "1";
    process.env.DATABASE_URL = "postgresql://koban@db.internal/finances";

    await expect(bootAppRuntime()).rejects.toMatchObject({ _tag: "AppConfigError", setting: "KOBAN_PUBLIC_DEMO" });
  });
});

describe("SecretBox", () => {
  let dataDir: string | undefined;

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { force: true, recursive: true });
    dataDir = undefined;
  });

  const secretBox = (env: Record<string, string>) =>
    SecretBox.layer.pipe(Layer.provide(configFrom(env)));

  it.effect("seals and unseals with KOBAN_SECRET_KEY, and rejects tampered or foreign values", () =>
    Effect.gen(function* () {
      const box = yield* SecretBox.SecretBox;
      const sealed = yield* box.seal("access-token-123");

      expect(sealed).not.toContain("access-token-123");
      expect(yield* box.unseal(sealed)).toBe("access-token-123");

      const [version, iv, tag, ciphertext] = sealed.split(".");
      const tampered = [version, iv, tag, `${ciphertext.slice(0, -2)}AA`].join(".");
      expect(yield* Effect.flip(box.unseal(tampered))).toMatchObject({ _tag: "SecretUnsealError" });
      expect(yield* Effect.flip(box.unseal("plain-base64-value"))).toMatchObject({ _tag: "SecretUnsealError" });
    }).pipe(Effect.provide(secretBox({ KOBAN_SECRET_KEY: testKey })))
  );

  it.effect("rejects a KOBAN_SECRET_KEY that is not 32 bytes", () =>
    Effect.gen(function* () {
      const error = yield* Effect.gen(function* () {
        return yield* SecretBox.SecretBox;
      }).pipe(
        Effect.provide(secretBox({ KOBAN_SECRET_KEY: "too-short" })),
        Effect.flip
      );
      expect(error).toMatchObject({ _tag: "AppConfigError", setting: "KOBAN_SECRET_KEY" });
    })
  );

  it.effect("generates a 0600 key file on first local boot and reuses it", () =>
    Effect.gen(function* () {
      dataDir = mkdtempSync(path.join(tmpdir(), "koban-secret-key-"));
      const env = { AI_FINANCES_PGLITE_DIR: path.join(dataDir, "pglite") };
      const keyPath = path.join(dataDir, "secret-key");

      const sealed = yield* Effect.gen(function* () {
        return yield* (yield* SecretBox.SecretBox).seal("first boot");
      }).pipe(Effect.provide(secretBox(env)));

      expect(existsSync(keyPath)).toBe(true);
      expect(statSync(keyPath).mode & 0o777).toBe(0o600);
      const firstKey = readFileSync(keyPath, "utf8");

      const reopened = yield* Effect.gen(function* () {
        return yield* (yield* SecretBox.SecretBox).unseal(sealed);
      }).pipe(Effect.provide(secretBox(env)));

      expect(reopened).toBe("first boot");
      expect(readFileSync(keyPath, "utf8")).toBe(firstKey);
    })
  );
});
