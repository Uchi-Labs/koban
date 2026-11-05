import path from "node:path";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { findWorkspaceRoot, readWorkspaceEnv } from "@/lib/workspace-env";

/** A configuration the server refuses to boot with. The message names the setting to change. */
export class AppConfigError extends Schema.TaggedError<AppConfigError>()("AppConfigError", {
  setting: Schema.String,
  reason: Schema.String
}) {
  override get message(): string {
    return `Invalid configuration (${this.setting}): ${this.reason}`;
  }
}

export type AppMode = "local" | "hosted";

export class AppConfig extends Context.Service<
  AppConfig,
  {
    /** `hosted` when DATABASE_URL is set (Postgres + Better Auth), otherwise `local` (PGlite). */
    readonly mode: AppMode;
    readonly databaseUrl: Option.Option<Redacted.Redacted<string>>;
    readonly authToken: Option.Option<Redacted.Redacted<string>>;
    readonly publicDemo: boolean;
    /** Directory for local state: the PGlite store's parent, `data/local` by default. */
    readonly dataDir: string;
    /** KOBAN_SECRET_KEY when set. Required in hosted mode; local mode falls back to `secretKeyFile`. */
    readonly secretKey: Option.Option<Redacted.Redacted<string>>;
    readonly secretKeyFile: string;
    readonly secrets: {
      readonly betterAuthSecret: Option.Option<Redacted.Redacted<string>>;
      readonly llmApiKey: Option.Option<Redacted.Redacted<string>>;
      readonly openAiApiKey: Option.Option<Redacted.Redacted<string>>;
      readonly plaidSandboxSecret: Option.Option<Redacted.Redacted<string>>;
      readonly plaidSecret: Option.Option<Redacted.Redacted<string>>;
      readonly simpleFinAccessUrl: Option.Option<Redacted.Redacted<string>>;
      readonly snapTradeConsumerKey: Option.Option<Redacted.Redacted<string>>;
      readonly snapTradeUserSecret: Option.Option<Redacted.Redacted<string>>;
      readonly voyageApiKey: Option.Option<Redacted.Redacted<string>>;
    };
  }
>()("koban/config/AppConfig") {}

const optionalSecret = (name: string) => Config.option(Config.Redacted(name));

const rawConfig = Config.all({
  authToken: optionalSecret("AI_FINANCES_AUTH_TOKEN"),
  bindHost: Config.option(Config.String("HOSTNAME")),
  databaseUrl: optionalSecret("DATABASE_URL"),
  nodeEnv: Config.option(Config.String("NODE_ENV")),
  pgliteDir: Config.option(Config.String("AI_FINANCES_PGLITE_DIR")),
  publicDemo: Config.option(Config.String("KOBAN_PUBLIC_DEMO")),
  secretKey: optionalSecret("KOBAN_SECRET_KEY"),
  secrets: Config.all({
    betterAuthSecret: optionalSecret("BETTER_AUTH_SECRET"),
    llmApiKey: optionalSecret("AI_FINANCES_LLM_API_KEY"),
    openAiApiKey: optionalSecret("OPENAI_API_KEY"),
    plaidSandboxSecret: optionalSecret("PLAID_SANDBOX_SECRET"),
    plaidSecret: optionalSecret("PLAID_SECRET"),
    simpleFinAccessUrl: optionalSecret("SIMPLEFIN_ACCESS_URL"),
    snapTradeConsumerKey: optionalSecret("SNAPTRADE_CONSUMER_KEY"),
    snapTradeUserSecret: optionalSecret("SNAPTRADE_USER_SECRET"),
    voyageApiKey: optionalSecret("VOYAGE_API_KEY")
  })
});

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return loopbackHosts.has(normalized) || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

/** The database name in a Postgres URL contains "demo"; the public demo serves nothing else. */
export function isDemoDatabaseUrl(databaseUrl: string): boolean {
  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    return false;
  }
  if (!/^postgres(?:ql)?:$/.test(target.protocol)) return false;
  return decodeURIComponent(target.pathname.replace(/^\//, "")).toLowerCase().includes("demo");
}

const make = Effect.gen(function* () {
  const raw = yield* rawConfig;
  const mode: AppMode = Option.isSome(raw.databaseUrl) ? "hosted" : "local";
  const publicDemo = Option.getOrUndefined(raw.publicDemo)?.trim() === "1";
  const dataDir = Option.match(raw.pgliteDir, {
    onNone: () => path.join(findWorkspaceRoot(), "data", "local"),
    onSome: (dir) => path.dirname(path.resolve(dir))
  });

  if (publicDemo) {
    const demoTarget = Option.map(raw.databaseUrl, Redacted.value);
    if (Option.isNone(demoTarget) || !isDemoDatabaseUrl(demoTarget.value)) {
      return yield* new AppConfigError({
        reason:
          "KOBAN_PUBLIC_DEMO=1 serves every visitor without sign-in, so DATABASE_URL must point at a Postgres database whose name contains 'demo'. Unset KOBAN_PUBLIC_DEMO or point DATABASE_URL at the demo database.",
        setting: "KOBAN_PUBLIC_DEMO"
      });
    }
  }

  if (mode === "hosted" && Option.isNone(raw.secretKey)) {
    return yield* new AppConfigError({
      reason:
        "hosted mode (DATABASE_URL set) needs a secrets-encryption key. Set KOBAN_SECRET_KEY to 32 random bytes in base64, for example the output of `openssl rand -base64 32`, and keep it with your other deployment secrets.",
      setting: "KOBAN_SECRET_KEY"
    });
  }

  // `next start` and the standalone server bind HOSTNAME, or every interface
  // when it is unset. Local mode without a token answers anyone who can reach
  // the port, so it only boots on loopback (system-design F11).
  const openLocalMode = mode === "local" && Option.isNone(raw.authToken) && !publicDemo;
  if (openLocalMode && Option.getOrUndefined(raw.nodeEnv) === "production") {
    const bindHost = Option.getOrElse(raw.bindHost, () => "0.0.0.0");
    if (!isLoopbackHost(bindHost)) {
      return yield* new AppConfigError({
        reason: `the server binds ${bindHost} with no sign-in. Set AI_FINANCES_AUTH_TOKEN to require a token, or set HOSTNAME=127.0.0.1 to serve this machine only.`,
        setting: "AI_FINANCES_AUTH_TOKEN"
      });
    }
  }

  return AppConfig.of({
    authToken: raw.authToken,
    dataDir,
    databaseUrl: raw.databaseUrl,
    mode,
    publicDemo,
    secretKey: raw.secretKey,
    secretKeyFile: path.join(dataDir, "secret-key"),
    secrets: raw.secrets
  });
});

/** Reads the active ConfigProvider. Tests provide one with `ConfigProvider.fromUnknown`. */
export const layer = Layer.effect(AppConfig, make);

/**
 * The process environment with the workspace `.env` as a fallback (the shell
 * wins; see `readWorkspaceEnv`), read when the runtime is built.
 */
export const workspaceConfigProviderLayer = Layer.unwrap(
  Effect.sync(() => ConfigProvider.layer(ConfigProvider.fromEnv({ env: readWorkspaceEnv() })))
);
