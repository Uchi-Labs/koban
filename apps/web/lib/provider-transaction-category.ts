import type { AccountType } from "@ai-finances/schema";
import {
  isLikelyGroceryTransaction,
  isLikelyIncomeTransaction,
  isLikelyTransferLikeTransaction
} from "@/lib/transaction-classification";

export function mapProviderTransactionCategory({
  accountType,
  amount,
  description,
  merchantName
}: {
  accountType: AccountType;
  amount: number;
  description: string;
  merchantName: string;
}) {
  if (
    isLikelyTransferLikeTransaction({
      accountType,
      amount,
      description,
      merchantName
    })
  ) {
    return "cat_transfer";
  }

  if (isLikelyIncomeTransaction({ description, merchantName })) {
    return "cat_income";
  }

  if (isLikelyGroceryTransaction({ description, merchantName })) {
    return "cat_food";
  }

  return "cat_other";
}
