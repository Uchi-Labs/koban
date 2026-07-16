import type { Account, AccountType, Transaction } from "@ai-finances/schema";
export { normalizeProviderCurrencyCode } from "@/lib/currency";

export const internalAmountSignConvention = "internal_v1";

export interface LedgerAmountNormalization {
  amountSignConvention: typeof internalAmountSignConvention;
}

interface LedgerLike {
  accounts: Account[];
  normalization?: LedgerAmountNormalization;
  transactions: Transaction[];
}

export function normalizeAmountForAccountType(amount: number, accountType: AccountType): number {
  return accountType === "credit_card" ? roundMoney(-amount) : roundMoney(amount);
}

export function normalizeLedgerAmounts<TLedger extends LedgerLike>(
  ledger: TLedger
): { changed: boolean; ledger: TLedger & { normalization: LedgerAmountNormalization } } {
  if (ledger.normalization?.amountSignConvention === internalAmountSignConvention) {
    return {
      changed: false,
      ledger: ledger as TLedger & { normalization: LedgerAmountNormalization }
    };
  }

  const accountTypeById = new Map(ledger.accounts.map((account) => [account.id, account.type]));
  const changed = true;
  const transactions = ledger.transactions.map((transaction) => {
    const accountType = accountTypeById.get(transaction.accountId);
    const normalizedAmount = accountType
      ? normalizeAmountForAccountType(transaction.amount, accountType)
      : roundMoney(transaction.amount);

    if (normalizedAmount !== transaction.amount) {
      return {
        ...transaction,
        amount: normalizedAmount
      };
    }

    return transaction;
  });

  return {
    changed,
    ledger: {
      ...ledger,
      normalization: {
        amountSignConvention: internalAmountSignConvention
      },
      transactions
    }
  };
}

function roundMoney(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}
