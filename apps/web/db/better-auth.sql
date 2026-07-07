BEGIN;

CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  image TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS better_auth_single_user_guard ON "user" ((TRUE));

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS "session" (
  id TEXT PRIMARY KEY,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS session_user_id_idx ON "session" ("userId");

CREATE TABLE IF NOT EXISTS "account" (
  id TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  scope TEXT,
  password TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS account_user_id_idx ON "account" ("userId");

CREATE TABLE IF NOT EXISTS "verification" (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS verification_identifier_idx ON "verification" (identifier);

CREATE TABLE IF NOT EXISTS apikey (
  id TEXT PRIMARY KEY,
  "configId" TEXT NOT NULL DEFAULT 'default',
  name TEXT,
  start TEXT,
  "referenceId" TEXT NOT NULL,
  prefix TEXT,
  key TEXT NOT NULL,
  "refillInterval" INTEGER,
  "refillAmount" INTEGER,
  "lastRefillAt" TIMESTAMPTZ,
  enabled BOOLEAN DEFAULT TRUE,
  "rateLimitEnabled" BOOLEAN DEFAULT TRUE,
  "rateLimitTimeWindow" INTEGER DEFAULT 86400000,
  "rateLimitMax" INTEGER DEFAULT 10,
  "requestCount" INTEGER DEFAULT 0,
  remaining INTEGER,
  "lastRequest" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  permissions TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS apikey_config_id_idx ON apikey ("configId");
CREATE INDEX IF NOT EXISTS apikey_reference_id_idx ON apikey ("referenceId");
CREATE INDEX IF NOT EXISTS apikey_key_idx ON apikey (key);

CREATE TABLE IF NOT EXISTS passkey (
  id TEXT PRIMARY KEY,
  name TEXT,
  "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  "credentialID" TEXT NOT NULL,
  counter INTEGER NOT NULL,
  "deviceType" TEXT NOT NULL,
  "backedUp" BOOLEAN NOT NULL,
  transports TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aaguid TEXT
);

CREATE INDEX IF NOT EXISTS passkey_user_id_idx ON passkey ("userId");
CREATE INDEX IF NOT EXISTS passkey_credential_id_idx ON passkey ("credentialID");

CREATE TABLE IF NOT EXISTS "twoFactor" (
  id TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  "backupCodes" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  verified BOOLEAN DEFAULT TRUE,
  "failedVerificationCount" INTEGER DEFAULT 0,
  "lockedUntil" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS two_factor_user_id_idx ON "twoFactor" ("userId");
CREATE INDEX IF NOT EXISTS two_factor_secret_idx ON "twoFactor" (secret);

COMMIT;
