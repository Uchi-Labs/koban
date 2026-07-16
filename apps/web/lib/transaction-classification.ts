import type { AccountType, Transaction } from "@ai-finances/schema";

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
  accountType,
  allowPairedStatementCredit = false,
  amount,
  description,
  merchantName,
  providerCategory,
  tags,
  transactionType
}: {
  accountType?: AccountType;
  allowPairedStatementCredit?: boolean;
  amount?: number;
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

  if (tags?.some((tag) => normalizeForClassification(tag) === "plaid transfer")) {
    return true;
  }

  const text = normalizeForClassification(`${merchantName ?? ""} ${description ?? ""}`);

  if (!text) {
    return false;
  }

  if (hasCardPaymentCreditText(text)) {
    return isLikelyCardPaymentCreditTransaction({
      accountType,
      allowStatementCredit: allowPairedStatementCredit,
      amount,
      description,
      merchantName
    });
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

export function isLikelyCardPaymentCreditTransaction({
  accountType,
  allowStatementCredit = false,
  amount,
  description,
  merchantName
}: {
  accountType?: AccountType;
  allowStatementCredit?: boolean;
  amount?: number;
  description?: string | null;
  merchantName?: string | null;
}): boolean {
  if (accountType !== "credit_card" || typeof amount !== "number" || amount <= 0) {
    return false;
  }

  const text = normalizeForClassification(`${merchantName ?? ""} ${description ?? ""}`);

  if (!text) {
    return false;
  }

  if (hasDirectCardPaymentCreditText(text)) {
    return true;
  }

  return allowStatementCredit && /\bstatement credit\b/.test(text);
}

function hasCardPaymentCreditText(text: string): boolean {
  return hasDirectCardPaymentCreditText(text) || /\bstatement credit\b/.test(text);
}

function hasDirectCardPaymentCreditText(text: string): boolean {
  // Hyphens/underscores are already collapsed to spaces by normalizeForClassification,
  // so "AUTO-PAY THANK YOU" → "auto pay thank you" and "DIRECTPAY" → "directpay".
  return /\b(?:payment thank you|automatic payment|autopay payment|auto pay thank you|internet payment thank you|directpay)\b/.test(
    text
  );
}

// ── One-sided internal-transfer classification ────────────────────────────────
// A "clear" internal transfer we can mark even when the counterpart account is
// not connected (so the pair matcher has nothing to pair with): a credit-card
// payment credit, a bank-side card payment debit, a directional vault/account
// move, or a rewards redemption. Each branch combines merchant/description text
// with sign + account-type context per Copilot's model — a bare issuer name like
// "DISCOVER" or "SOFI BANK" never qualifies on its own.

export interface OneSidedInternalTransferClassification {
  reason: string;
}

export function classifyOneSidedInternalTransfer({
  accountType,
  amount,
  description,
  merchantName
}: {
  accountType?: AccountType;
  amount?: number;
  description?: string | null;
  merchantName?: string | null;
}): OneSidedInternalTransferClassification | null {
  const text = normalizeForClassification(`${merchantName ?? ""} ${description ?? ""}`);

  // Directional account/vault moves ("To Emergency Fund Vault", "From Savings
  // Balance", "To Checking") — internal regardless of sign or account type.
  if (isDirectionalAccountMove(text)) {
    return { reason: "Directional account transfer (vault/savings/checking move)" };
  }

  // Rewards / cashback redemptions moving reward balance into cash.
  if (isRewardRedemption(text)) {
    return { reason: "Rewards/cashback redemption" };
  }

  // Card-side payment credit: positive on a credit-card account with direct
  // card-payment text (statement credits alone stay ambiguous — pair only).
  if (
    isLikelyCardPaymentCreditTransaction({
      accountType,
      allowStatementCredit: false,
      amount,
      description,
      merchantName
    })
  ) {
    return { reason: "Credit-card payment received (card side)" };
  }

  // Bank-side card payment debit: negative on a cash account whose merchant is a
  // recognized card-issuer payment ("CHASE CREDIT CRD", "Apple Card", "AMEX
  // EPAYMENT"). Requires a card/payment token — a bare issuer name is excluded.
  if (
    (accountType === "checking" || accountType === "savings" || accountType === "cash") &&
    typeof amount === "number" &&
    amount < 0 &&
    isCardIssuerPaymentDebitText(text)
  ) {
    return { reason: "Card payment sent (bank side)" };
  }

  return null;
}

function isDirectionalAccountMove(text: string): boolean {
  if (!text) {
    return false;
  }

  return (
    /\b(?:to|from)\b/.test(text) &&
    /\b(?:emergency fund|vault|savings|checking|savings balance|money vault|round up)\b/.test(text)
  );
}

function isRewardRedemption(text: string): boolean {
  if (!text) {
    return false;
  }

  if (/\bcashback bonus\b/.test(text)) {
    return true;
  }

  return /\bredemption\b/.test(text) && /\b(?:reward|rewards|cashback|cash back|points)\b/.test(text);
}

function isCardIssuerPaymentDebitText(text: string): boolean {
  if (!text) {
    return false;
  }

  // Explicit card-payment phrases stand on their own.
  if (/\b(?:epayment|e payment|credit crd|credit card|apple card|applecard|directpay)\b/.test(text)) {
    return true;
  }

  // Otherwise require an issuer token paired with an explicit card/payment word,
  // so a bare "DISCOVER" / "SOFI BANK" purchase never qualifies.
  const hasIssuer =
    /\b(?:chase|amex|american express|discover|citi|capital one|sofi|barclays|synchrony|goldman|gs bank|us bank|wells fargo)\b/.test(
      text
    );

  return hasIssuer && /\b(?:card|crd|autopay|auto pay|bill pay|card payment)\b/.test(text);
}

function normalizeForClassification(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
