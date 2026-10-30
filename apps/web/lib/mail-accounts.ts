import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type MailProvider = "gmail" | "icloud" | "outlook";

export interface MailAccount {
  email: string;
  id: string;
  label: string;
  profile: string;
  provider: MailProvider;
}

export interface SaveMailAccountInput {
  appPassword?: string;
  email: string;
  label?: string;
  profile: string;
  provider: MailProvider;
}

interface StoredMailAccount extends MailAccount {
  appPassword?: string;
}

interface MailAccountStore {
  accounts: StoredMailAccount[];
  version: 1;
}

interface MailAccountOptions {
  homeDir?: string;
}

const registryGlobal = globalThis as typeof globalThis & {
  __kobanMailAccountWrites?: Promise<void>;
};

export class MailAccountError extends Error {
  constructor(message: string, readonly code: "conflict" | "invalid" | "not_found" | "storage") {
    super(message);
    this.name = "MailAccountError";
  }
}

export async function listMailAccounts(options: MailAccountOptions = {}): Promise<MailAccount[]> {
  return (await readStore(options)).accounts.map(publicAccount);
}

export function listMailAccountsSync(options: MailAccountOptions = {}): MailAccount[] {
  const file = registryPath(options);
  try {
    assertPrivateMode(statSync(file).mode);
    return validateStore(JSON.parse(readFileSync(file, "utf8"))).accounts.map(publicAccount);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    if (error instanceof MailAccountError) throw error;
    throw new MailAccountError("Mail account registry is malformed or unreadable.", "storage");
  }
}

export async function getMailAccount(id: string, options: MailAccountOptions = {}): Promise<MailAccount | undefined> {
  const account = (await readStore(options)).accounts.find((candidate) => candidate.id === id);
  return account ? publicAccount(account) : undefined;
}

export async function saveMailAccount(
  input: SaveMailAccountInput,
  options: MailAccountOptions = {}
): Promise<MailAccount> {
  const normalized = normalizeInput(input);
  let saved: MailAccount | undefined;
  const write = getWriteQueue().then(async () => {
    const store = await readStore(options);
    const index = store.accounts.findIndex((account) =>
      account.provider === normalized.provider && account.profile === normalized.profile
    );
    const existing = store.accounts[index];

    if (existing && existing.email !== normalized.email) {
      throw new MailAccountError(
        `Mail profile ${normalized.profile} is already bound to a different email address. Create a new profile to preserve source attribution.`,
        "conflict"
      );
    }
    if (!existing && normalized.provider === "icloud" && !normalized.appPassword) {
      throw new MailAccountError("A new iCloud mail profile requires an app-specific password.", "invalid");
    }

    const next: StoredMailAccount = {
      ...(existing ?? normalized),
      email: normalized.email,
      id: mailAccountId(normalized.provider, normalized.profile),
      label: input.label === undefined && existing ? existing.label : normalized.label,
      profile: normalized.profile,
      provider: normalized.provider,
      ...(normalized.provider === "icloud"
        ? { appPassword: normalized.appPassword ?? existing?.appPassword }
        : {})
    };
    if (index === -1) store.accounts.push(next);
    else store.accounts[index] = next;
    store.accounts.sort((left, right) => left.id.localeCompare(right.id));
    await writeStore(store, options);
    saved = publicAccount(next);
  });
  setWriteQueue(write);
  await write;
  if (!saved) throw new MailAccountError("Mail account save did not complete.", "storage");
  return saved;
}

export async function getMailAccountSecret(
  id: string,
  options: MailAccountOptions = {}
): Promise<{ appPassword?: string } | undefined> {
  const account = (await readStore(options)).accounts.find((candidate) => candidate.id === id);
  return account ? { appPassword: account.appPassword } : undefined;
}

export async function readIcloudCredentials(
  accountId: string,
  options: MailAccountOptions = {}
): Promise<{ appPassword: string; email: string }> {
  const account = (await readStore(options)).accounts.find((candidate) => candidate.id === accountId);
  if (!account || account.provider !== "icloud") {
    throw new MailAccountError("iCloud mail profile not found.", "not_found");
  }
  if (!account.appPassword) {
    throw new MailAccountError("iCloud mail profile does not contain an app-specific password.", "invalid");
  }
  return { appPassword: account.appPassword, email: account.email };
}

export function outlookConfigPath(
  account: Pick<MailAccount, "profile"> | string,
  options: MailAccountOptions = {}
): string {
  const profile = normalizeProfile(typeof account === "string" ? account : account.profile);
  return path.join(resolveHome(options), ".config", "koban", "mail-profiles", "outlook", `${profile}.json`);
}

function mailAccountId(provider: MailProvider, profile: string): string {
  const prefix = provider === "gmail"
    ? "source_gmail"
    : provider === "outlook"
      ? "source_outlook_email"
      : "source_icloud_mail";
  return `${prefix}__${profile}`;
}

function normalizeInput(input: SaveMailAccountInput): StoredMailAccount {
  if (!(["gmail", "icloud", "outlook"] as unknown[]).includes(input.provider)) {
    throw new MailAccountError("Mail provider must be gmail, outlook, or icloud.", "invalid");
  }
  const profile = normalizeProfile(input.profile);
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@-][^\s@]*@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new MailAccountError("Mail account email is invalid.", "invalid");
  }
  const label = input.label?.trim() || email;
  if (label.length > 100 || /[\u0000-\u001f\u007f]/.test(label)) {
    throw new MailAccountError("Mail account label is invalid.", "invalid");
  }
  const appPassword = input.appPassword?.trim();
  if (appPassword && (appPassword.length > 512 || /[\r\n\0]/.test(appPassword))) {
    throw new MailAccountError("iCloud app-specific password is invalid.", "invalid");
  }
  if (input.provider !== "icloud" && appPassword) {
    throw new MailAccountError("App-specific passwords are supported only for iCloud mail.", "invalid");
  }
  return { email, id: mailAccountId(input.provider, profile), label, profile, provider: input.provider, appPassword };
}

function normalizeProfile(value: string): string {
  const profile = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(profile)) {
    throw new MailAccountError("Mail profile must be a safe slug using lowercase letters, numbers, underscores, or hyphens.", "invalid");
  }
  return profile;
}

function publicAccount(account: StoredMailAccount): MailAccount {
  return {
    email: account.email,
    id: account.id,
    label: account.label,
    profile: account.profile,
    provider: account.provider
  };
}

async function readStore(options: MailAccountOptions): Promise<MailAccountStore> {
  const file = registryPath(options);
  try {
    assertPrivateMode((await stat(file)).mode);
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    return validateStore(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { accounts: [], version: 1 };
    if (error instanceof MailAccountError) throw error;
    throw new MailAccountError("Mail account registry is malformed or unreadable.", "storage");
  }
}

function validateStore(value: unknown): MailAccountStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MailAccountError("Mail account registry is malformed.", "storage");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.accounts)) throw new MailAccountError("Mail account registry has an unsupported format.", "storage");
  const accounts = record.accounts.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new MailAccountError("Mail account registry contains an invalid account.", "storage");
    const row = value as Record<string, unknown>;
    const normalized = normalizeInput({
      appPassword: typeof row.appPassword === "string" ? row.appPassword : undefined,
      email: typeof row.email === "string" ? row.email : "",
      label: typeof row.label === "string" ? row.label : undefined,
      profile: typeof row.profile === "string" ? row.profile : "",
      provider: row.provider as MailProvider
    });
    if (row.id !== normalized.id) throw new MailAccountError("Mail account registry contains an invalid account id.", "storage");
    return normalized;
  });
  if (new Set(accounts.map(({ id }) => id)).size !== accounts.length) throw new MailAccountError("Mail account registry contains duplicate profiles.", "storage");
  return { accounts, version: 1 };
}

async function writeStore(store: MailAccountStore, options: MailAccountOptions): Promise<void> {
  const file = registryPath(options);
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, file);
    await chmod(file, 0o600);
    const details = await stat(file);
    if ((details.mode & 0o777) !== 0o600) throw new MailAccountError("Mail account registry permissions are unsafe.", "storage");
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (error instanceof MailAccountError) throw error;
    throw new MailAccountError("Unable to save mail account registry.", "storage");
  }
}

function registryPath(options: MailAccountOptions): string {
  if (!options.homeDir && process.env.KOBAN_MAIL_ACCOUNTS_FILE) {
    return path.resolve(process.env.KOBAN_MAIL_ACCOUNTS_FILE);
  }
  return path.join(resolveHome(options), ".config", "koban", "mail-accounts.json");
}

function resolveHome(options: MailAccountOptions): string {
  return options.homeDir ?? os.homedir();
}

function getWriteQueue(): Promise<void> {
  return registryGlobal.__kobanMailAccountWrites ?? Promise.resolve();
}

function setWriteQueue(write: Promise<void>): void {
  registryGlobal.__kobanMailAccountWrites = write.catch(() => undefined);
}

function assertPrivateMode(mode: number): void {
  if ((mode & 0o077) !== 0) {
    throw new MailAccountError("Mail account registry permissions are unsafe; expected mode 0600.", "storage");
  }
}
