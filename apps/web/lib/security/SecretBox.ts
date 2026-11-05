import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { AppConfig, AppConfigError } from "@/lib/config/AppConfig";

// AES-256-GCM, the same construction as the Microsoft token seal
// (lib/microsoft-source-oauth.ts), keyed by KOBAN_SECRET_KEY instead of a
// per-feature secret. E5 moves stored provider secrets onto this service.
const sealVersion = "kb1";
const keyBytes = 32;

export class SecretKeyFileError extends Schema.TaggedError<SecretKeyFileError>()("SecretKeyFileError", {
  path: Schema.String,
  cause: Schema.Defect()
}) {
  override get message(): string {
    return `Unable to read or create the local secrets key at ${this.path}.`;
  }
}

export class SecretUnsealError extends Schema.TaggedError<SecretUnsealError>()("SecretUnsealError", {
  cause: Schema.optional(Schema.Defect())
}) {
  override get message(): string {
    return "Stored secret could not be decrypted with the current KOBAN_SECRET_KEY.";
  }
}

export class SecretBox extends Context.Service<
  SecretBox,
  {
    readonly seal: (plaintext: string) => Effect.Effect<string>;
    readonly unseal: (sealed: string) => Effect.Effect<string, SecretUnsealError>;
  }
>()("koban/security/SecretBox") {}

/** Decodes KOBAN_SECRET_KEY: 32 bytes as base64 or base64url. */
export function decodeSecretKey(encoded: string): Buffer | undefined {
  const trimmed = encoded.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) return undefined;
  const key = Buffer.from(trimmed.replaceAll("-", "+").replaceAll("_", "/"), "base64");
  return key.length === keyBytes ? key : undefined;
}

export function sealWithKey(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [sealVersion, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function unsealWithKey(key: Buffer, sealed: string): string {
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== sealVersion || !iv || !tag || !ciphertext) {
    throw new Error("Not a sealed secret.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

// Local mode: the first boot writes a fresh key with mode 0600; later boots
// read it back. `wx` fails if another process created the file first, and that
// process's key is then read instead of overwritten.
function readOrCreateKeyFile(keyPath: string): Buffer {
  try {
    mkdirSync(path.dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, `${randomBytes(keyBytes).toString("base64")}\n`, { flag: "wx", mode: 0o600 });
    chmodSync(keyPath, 0o600);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const key = decodeSecretKey(readFileSync(keyPath, "utf8"));
  if (!key) throw new Error("The key file does not hold 32 base64-encoded bytes.");
  return key;
}

const loadKey = Effect.gen(function* () {
  const config = yield* AppConfig;
  if (Option.isSome(config.secretKey)) {
    const key = decodeSecretKey(Redacted.value(config.secretKey.value));
    if (!key) {
      return yield* new AppConfigError({
        reason: "KOBAN_SECRET_KEY must be 32 random bytes in base64, for example the output of `openssl rand -base64 32`.",
        setting: "KOBAN_SECRET_KEY"
      });
    }
    return key;
  }
  return yield* Effect.try({
    try: () => readOrCreateKeyFile(config.secretKeyFile),
    catch: (cause) => new SecretKeyFileError({ cause, path: config.secretKeyFile })
  });
});

const make = Effect.gen(function* () {
  const key = yield* loadKey;

  const seal = Effect.fn("SecretBox.seal")(function* (plaintext: string) {
    return sealWithKey(key, plaintext);
  });

  const unseal = Effect.fn("SecretBox.unseal")(function* (sealed: string) {
    return yield* Effect.try({
      try: () => unsealWithKey(key, sealed),
      catch: (cause) => new SecretUnsealError({ cause })
    });
  });

  return SecretBox.of({ seal, unseal });
});

export const layer = Layer.effect(SecretBox, make);
