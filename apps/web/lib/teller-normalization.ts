import type { Account, AccountType, Transaction } from "@ai-finances/schema";
export { normalizeProviderCurrencyCode } from "@/lib/currency";

export const tellerInternalAmountSignConvention = "internal_v1";

export interface TellerLedgerAmountNormalization {
  amountSignConvention: typeof tellerInternalAmountSignConvention;
}

interface TellerLedgerLike {
  accounts: Account[];
  normalization?: TellerLedgerAmountNormalization;
  transactions: Transaction[];
}

export function normalizeTellerAmountForAccountType(amount: number, accountType: AccountType): number {
  return accountType === "credit_card" ? roundMoney(-amount) : roundMoney(amount);
}

export function normalizeTellerLedgerAmounts<TLedger extends TellerLedgerLike>(
  ledger: TLedger
): { changed: boolean; ledger: TLedger & { normalization: TellerLedgerAmountNormalization } } {
  if (ledger.normalization?.amountSignConvention === tellerInternalAmountSignConvention) {
    return {
      changed: false,
      ledger: ledger as TLedger & { normalization: TellerLedgerAmountNormalization }
    };
  }

  const accountTypeById = new Map(ledger.accounts.map((account) => [account.id, account.type]));
  const changed = true;
  const transactions = ledger.transactions.map((transaction) => {
    const accountType = accountTypeById.get(transaction.accountId);
    const normalizedAmount = accountType
      ? normalizeTellerAmountForAccountType(transaction.amount, accountType)
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
        amountSignConvention: tellerInternalAmountSignConvention
      },
      transactions
    }
  };
}

function roundMoney(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}
