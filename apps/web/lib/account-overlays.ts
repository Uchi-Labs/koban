// User overlay: which accounts count toward net worth.
//
// Provider syncs rebuild account rows with their own includedInNetWorth value
// (providers default to true, errored connections force false), so a user's
// choice stored on the row itself would be clobbered on every resync. Like
// category budget overrides, the choice persists as a small JSON map in the
// `sync_state` KV and is merged over accounts at read time.

import { readSyncStateValue, writeSyncStateValue } from "@/lib/db/finance-db";

const INCLUSION_OVERRIDES_KEY = "account_net_worth_overrides";

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
