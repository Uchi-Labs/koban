import type { Transaction } from "@ai-finances/schema";

export function isIncomeTransaction(transaction: Pick<Transaction, "amount" | "categoryId">): boolean {
  return transaction.amount > 0 && transaction.categoryId !== "cat_transfer";
}

export function isSpendingTransaction(transaction: Pick<Transaction, "amount" | "categoryId">): boolean {
  return transaction.amount < 0 && transaction.categoryId !== "cat_transfer";
}

export function isReviewActionableTransaction(transaction: Pick<Transaction, "amount" | "categoryId" | "reviewed">): boolean {
  if (transaction.reviewed || transaction.categoryId === "cat_transfer") {
    return false;
  }

  if (transaction.categoryId === "cat_other") {
    return true;
  }

  return isSpendingTransaction(transaction) || (transaction.amount > 0 && transaction.categoryId !== "cat_income");
}

export function isLikelyIncomeTransaction({
  description,
  merchantName,
  providerCategory
}: {
  description?: string | null;
  merchantName?: string | null;
  providerCategory?: string | null;
}): boolean {
  const category = normalizeForClassification(providerCategory);
  if (category === "income") {
    return true;
  }

  const text = normalizeForClassification(`${merchantName ?? ""} ${description ?? ""}`);

  if (!text) {
    return false;
  }

  return /\b(?:payroll|salary|direct deposit|interest earned|interest payment|dividend)\b/.test(text);
}

export function isLikelyGroceryTransaction({
  description,
  merchantName,
  providerCategory
}: {
  description?: string | null;
  merchantName?: string | null;
  providerCategory?: string | null;
}): boolean {
  const category = normalizeForClassification(providerCategory);
  if (category === "groceries" || category === "grocery") {
    return true;
  }

  const text = normalizeForClassification(`${merchantName ?? ""} ${description ?? ""}`);

  if (!text) {
    return false;
  }

  return /\b(?:instacart|whole foods|trader joe s?|aldi|wegmans|kroger|safeway|giant eagle|food co op|food coop|grocery|supermarket)\b/.test(text);
}

export function isLikelyTransferLikeTransaction({
  description,
  merchantName,
  providerCategory,
  tags,
  transactionType
}: {
  description?: string | null;
  merchantName?: string | null;
  providerCategory?: string | null;
  tags?: string[];
  transactionType?: string | null;
}): boolean {
  const category = normalizeForClassification(providerCategory);
  if (category === "investment" || category === "loan" || category === "transfer") {
    return true;
  }

  const type = normalizeForClassification(transactionType);
  if (type === "transfer") {
    return true;
  }

  if (tags?.some((tag) => normalizeForClassification(tag) === "teller transfer")) {
    return true;
  }

  const text = normalizeForClassification(`${merchantName ?? ""} ${description ?? ""}`);

  if (!text) {
    return false;
  }

  if (/\b(?:zelle|venmo|cash app)\b/.test(text)) {
    return true;
  }

  if (/\bxoom\b/.test(text)) {
    return true;
  }

  if (/\breal time payment credit recd\b/.test(text)) {
    return true;
  }

  if (/\bonline transfer\b/.test(text)) {
    return true;
  }

  if (/\btransfer\b/.test(text) && /\b(?:bank|checking|savings?|sav|from|to|web id|transaction)\b/.test(text)) {
    return true;
  }

  if (/\bach pmt\b/.test(text) && /\b(?:american express|amex|chase|capital one|citi|discover|card|credit)\b/.test(text)) {
    return true;
  }

  if (/\bpayment to\b.*\b(?:card|ending in \d{3,4})\b/.test(text)) {
    return true;
  }

  if (/\b(?:credit card|card)\s+(?:payment|pmt)\b/.test(text)) {
    return true;
  }

  return false;
}

function normalizeForClassification(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
