// User overlays on accounts: net-worth inclusion and display name.
//
// Provider syncs rebuild account rows with their own values (providers default
// includedInNetWorth to true, errored connections force false, and names come
// straight from the institution), so a user's choice stored on the row itself
// would be clobbered on every resync. Like category budget overrides, each
// choice persists as a small JSON map in the `sync_state` KV and is merged
// over accounts at read time — which makes a rename reflect everywhere the
// account name flows (lists, sidebar, transaction views) from one merge point.

import { readSyncStateValue, writeSyncStateValue } from "@/lib/db/finance-db";

const INCLUSION_OVERRIDES_KEY = "account_net_worth_overrides";
const NAME_OVERRIDES_KEY = "account_name_overrides";

export type AccountInclusionOverrides = Record<string, boolean>;

export async function getAccountInclusionOverrides(): Promise<AccountInclusionOverrides> {
  const raw = await readSyncStateValue(INCLUSION_OVERRIDES_KEY);

  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const result: AccountInclusionOverrides = {};
    for (const [accountId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") {
        result[accountId] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function setAccountInclusionOverride(accountId: string, included: boolean | null): Promise<void> {
  const overrides = await getAccountInclusionOverrides();

  if (included === null) {
    if (!(accountId in overrides)) {
      return;
    }
    delete overrides[accountId];
  } else {
    overrides[accountId] = included;
  }

  await writeSyncStateValue(INCLUSION_OVERRIDES_KEY, JSON.stringify(overrides));
}

/** Merge KV inclusion overrides over each account's provider-derived flag. */
export function applyInclusionOverrides<T extends { id: string; includedInNetWorth: boolean }>(
  accounts: T[],
  overrides: AccountInclusionOverrides
): T[] {
  return accounts.map((account) =>
    account.id in overrides ? { ...account, includedInNetWorth: overrides[account.id] } : account
  );
}

export type AccountNameOverrides = Record<string, string>;

export async function getAccountNameOverrides(): Promise<AccountNameOverrides> {
  const raw = await readSyncStateValue(NAME_OVERRIDES_KEY);

  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const result: AccountNameOverrides = {};
    for (const [accountId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim().length > 0) {
        result[accountId] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** `null` clears the alias so the provider name shows again. */
export async function setAccountNameOverride(accountId: string, name: string | null): Promise<void> {
  const overrides = await getAccountNameOverrides();

  if (name === null) {
    if (!(accountId in overrides)) {
      return;
    }
    delete overrides[accountId];
  } else {
    overrides[accountId] = name;
  }

  await writeSyncStateValue(NAME_OVERRIDES_KEY, JSON.stringify(overrides));
}

/** Merge KV name aliases over each account's provider-derived name. */
export function applyNameOverrides<T extends { id: string; name: string }>(
  accounts: T[],
  overrides: AccountNameOverrides
): T[] {
  return accounts.map((account) =>
    account.id in overrides ? { ...account, name: overrides[account.id] } : account
  );
}
