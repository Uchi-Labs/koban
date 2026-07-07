import type { Account } from "@ai-finances/schema";

export interface NetWorthToggleAccount {
  /** Signed net-worth impact this account has when included. */
  contribution: number;
  currency: string;
  id: string;
  included: boolean;
  mask?: string;
  name: string;
}

export interface NetWorthToggleGroup {
  accounts: NetWorthToggleAccount[];
  id: string;
  name: string;
}

const GROUP_DEFINITIONS: Array<{ id: string; name: string; types: Array<Account["type"]> }> = [
  { id: "cash", name: "Cash", types: ["cash", "checking", "savings"] },
  { id: "credit", name: "Credit cards", types: ["credit_card"] },
  { id: "investments", name: "Investments", types: ["investment"] },
  { id: "loans", name: "Loans", types: ["loan"] }
];

// Groups raw accounts (excluded ones too — createAccountGroups drops those, and a
// hidden account must stay visible here or it could never be re-included).
export function buildNetWorthToggleGroups(accounts: Account[]): NetWorthToggleGroup[] {
  return GROUP_DEFINITIONS.flatMap((definition) => {
    const rows = accounts
      .filter((account) => definition.types.includes(account.type))
      .map((account) => ({
        contribution:
          account.type === "credit_card" || account.type === "loan"
            ? -Math.abs(account.currentBalance)
            : account.currentBalance,
        currency: account.currency,
        id: account.id,
        included: account.includedInNetWorth,
        mask: account.mask,
        name: account.name
      }));

    return rows.length > 0 ? [{ accounts: rows, id: definition.id, name: definition.name }] : [];
  });
}
