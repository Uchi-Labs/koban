import type { Account, Transaction } from "@ai-finances/schema";
import { createHash } from "node:crypto";
import {
  classifyOneSidedInternalTransfer,
  isLikelyTransferLikeTransaction
} from "@/lib/transaction-classification";

export const internalTransferPairMatcherSource = "pair-matcher";
export const internalTransferHeuristicSource = "transfer-heuristic";
export const internalTransferPairDateWindowDays = 5;

export interface InternalTransferPairMatch {
  amount: number;
  dateDistanceDays: number;
  id: string;
  isAmbiguous: boolean;
  negativeTransactionId: string;
  positiveTransactionId: string;
  textMatched: boolean;
  transferClassified: boolean;
  transactionIds: [string, string];
}

export interface InternalTransferPairSuggestion {
  action: "set_category";
  categoryId: "cat_transfer";
  confidence: number;
  id: string;
  markReviewed: false;
  reason: string;
  source: typeof internalTransferPairMatcherSource;
  tags: [];
  transactionId: string;
}

export interface InternalTransferPairMatchPlan {
  autoApplyPairs: InternalTransferPairMatch[];
  autoApplySuggestions: InternalTransferPairSuggestion[];
  candidatePairs: InternalTransferPairMatch[];
  pendingPairs: InternalTransferPairMatch[];
  pendingSuggestions: InternalTransferPairSuggestion[];
}

interface MatchableTransaction {
  account: Account;
  amountMinor: number;
  dateTime: number;
  textMatched: boolean;
  transaction: Transaction;
}

interface CandidatePair {
  dateDistanceDays: number;
  negative: MatchableTransaction;
  positive: MatchableTransaction;
}

export function buildInternalTransferPairMatchPlan({
  accounts,
  transactions
}: {
  accounts: Account[];
  transactions: Transaction[];
}): InternalTransferPairMatchPlan {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const matchableTransactions = transactions.flatMap((transaction) => {
    const account = accountById.get(transaction.accountId);
    const amountMinor = amountToMinor(transaction.amount);
    const dateTime = transactionDateTime(transaction.date);

    if (!account || amountMinor === 0 || dateTime === undefined || !canSuggestTransferCategory(transaction)) {
      return [];
    }

    return [
      {
        account,
        amountMinor,
        dateTime,
        textMatched: isLikelyTransferLikeTransaction({
          accountType: account.type,
          allowPairedStatementCredit: true,
          amount: transaction.amount,
          description: transaction.description,
          merchantName: transaction.merchantName,
          tags: transaction.tags
        }),
        transaction
      } satisfies MatchableTransaction
    ];
  });
  const groups = groupByAmountAndCurrency(matchableTransactions);
  const candidates: CandidatePair[] = [];

  for (const group of groups.values()) {
    const positives = group.filter((entry) => entry.amountMinor > 0);
    const negatives = group.filter((entry) => entry.amountMinor < 0);

    for (const positive of positives) {
      for (const negative of negatives) {
        if (positive.transaction.accountId === negative.transaction.accountId) {
          continue;
        }

        const dateDistanceDays = dayDistance(positive.dateTime, negative.dateTime);

        if (dateDistanceDays > internalTransferPairDateWindowDays) {
          continue;
        }

        candidates.push({ dateDistanceDays, negative, positive });
      }
    }
  }

  const candidateCountByTransactionId = new Map<string, number>();

  for (const candidate of candidates) {
    increment(candidateCountByTransactionId, candidate.positive.transaction.id);
    increment(candidateCountByTransactionId, candidate.negative.transaction.id);
  }

  const candidatePairs = candidates
    .map((candidate) => pairMatchFromCandidate(candidate, candidateCountByTransactionId))
    .sort(comparePairMatches);
  const autoApplyPairs = candidatePairs.filter(
    (pair) => !pair.isAmbiguous && (pair.transferClassified || pair.textMatched)
  );
  const pendingPairs = candidatePairs.filter((pair) => !autoApplyPairs.includes(pair));

  return {
    autoApplyPairs,
    autoApplySuggestions: autoApplyPairs.flatMap((pair) => autoApplySuggestionsForPair(pair, matchableTransactions)),
    candidatePairs,
    pendingPairs,
    pendingSuggestions: pendingSuggestionsForPairs(pendingPairs, matchableTransactions)
  };
}

export interface OneSidedInternalTransferSuggestion {
  action: "set_category";
  categoryId: "cat_transfer";
  confidence: number;
  id: string;
  markReviewed: false;
  reason: string;
  source: typeof internalTransferHeuristicSource;
  tags: [];
  transactionId: string;
}

export interface OneSidedInternalTransferPlan {
  autoApplySuggestions: OneSidedInternalTransferSuggestion[];
}

/**
 * Mark clear internal transfers that have no connected counterpart to pair with
 * — credit-card payment credits, bank-side card payment debits, vault/savings
 * moves, and rewards redemptions (Copilot's one-sided `internal_transfer`
 * marks). Any transaction id in `excludeTransactionIds` (already handled by the
 * pair matcher, auto or pending) is skipped so the two mechanisms never fight.
 */
export function buildOneSidedInternalTransferPlan({
  accounts,
  transactions,
  excludeTransactionIds = new Set<string>()
}: {
  accounts: Account[];
  transactions: Transaction[];
  excludeTransactionIds?: Set<string>;
}): OneSidedInternalTransferPlan {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const autoApplySuggestions: OneSidedInternalTransferSuggestion[] = [];

  for (const transaction of transactions) {
    if (excludeTransactionIds.has(transaction.id)) {
      continue;
    }

    // Only ever mark provider-default (`cat_other`) rows the user has not
    // touched — mirrors Copilot's `user_changed_type`: a user recategorization
    // is authoritative and never re-marked. (`cat_transfer` rows are already
    // marked; anything else is a user or provider decision we respect.)
    if (transaction.categoryId !== "cat_other" || !canSuggestTransferCategory(transaction)) {
      continue;
    }

    const account = accountById.get(transaction.accountId);
    const classification = classifyOneSidedInternalTransfer({
      accountType: account?.type,
      amount: transaction.amount,
      description: transaction.description,
      merchantName: transaction.merchantName
    });

    if (!classification) {
      continue;
    }

    autoApplySuggestions.push({
      action: "set_category",
      categoryId: "cat_transfer",
      confidence: 0.9,
      id: `sug_${stableIdSuffix([internalTransferHeuristicSource, transaction.id].join(":"))}`,
      markReviewed: false,
      reason: `${classification.reason}: no connected counterpart to pair, marked internal transfer.`,
      source: internalTransferHeuristicSource,
      tags: [],
      transactionId: transaction.id
    });
  }

  return { autoApplySuggestions };
}

function pairMatchFromCandidate(
  candidate: CandidatePair,
  candidateCountByTransactionId: Map<string, number>
): InternalTransferPairMatch {
  const transactionIds = sortedPairIds(candidate.positive.transaction.id, candidate.negative.transaction.id);
  const textMatched = candidate.positive.textMatched || candidate.negative.textMatched;
  const transferClassified =
    candidate.positive.transaction.categoryId === "cat_transfer" ||
    candidate.negative.transaction.categoryId === "cat_transfer";

  return {
    amount: Math.abs(candidate.positive.amountMinor) / 100,
    dateDistanceDays: candidate.dateDistanceDays,
    id: stablePairId(transactionIds),
    isAmbiguous:
      (candidateCountByTransactionId.get(candidate.positive.transaction.id) ?? 0) > 1 ||
      (candidateCountByTransactionId.get(candidate.negative.transaction.id) ?? 0) > 1,
    negativeTransactionId: candidate.negative.transaction.id,
    positiveTransactionId: candidate.positive.transaction.id,
    textMatched,
    transferClassified,
    transactionIds
  };
}

function autoApplySuggestionsForPair(
  pair: InternalTransferPairMatch,
  matchableTransactions: MatchableTransaction[]
): InternalTransferPairSuggestion[] {
  const transactionById = new Map(matchableTransactions.map((entry) => [entry.transaction.id, entry]));

  return pair.transactionIds.flatMap((transactionId) => {
    const entry = transactionById.get(transactionId);
    const counterpartId = pair.transactionIds.find((id) => id !== transactionId);
    const counterpart = counterpartId ? transactionById.get(counterpartId) : undefined;

    if (!entry || !counterpart) {
      return [];
    }

    return [
      createPairSuggestion({
        confidence: pair.transferClassified ? 0.97 : 0.94,
        counterpart,
        pair,
        reasonPrefix: "Pair matcher auto-applied transfer category",
        transaction: entry
      })
    ];
  });
}

function pendingSuggestionsForPairs(
  pairs: InternalTransferPairMatch[],
  matchableTransactions: MatchableTransaction[]
): InternalTransferPairSuggestion[] {
  const transactionById = new Map(matchableTransactions.map((entry) => [entry.transaction.id, entry]));
  const pendingPairsByTransactionId = new Map<string, InternalTransferPairMatch[]>();

  for (const pair of pairs) {
    for (const transactionId of pair.transactionIds) {
      pendingPairsByTransactionId.set(transactionId, [
        ...(pendingPairsByTransactionId.get(transactionId) ?? []),
        pair
      ]);
    }
  }

  return Array.from(pendingPairsByTransactionId.entries()).flatMap(([transactionId, transactionPairs]) => {
    const entry = transactionById.get(transactionId);

    if (!entry) {
      return [];
    }

    const counterpartEntries = transactionPairs.flatMap((pair) => {
      const counterpartId = pair.transactionIds.find((id) => id !== transactionId);
      const counterpart = counterpartId ? transactionById.get(counterpartId) : undefined;
      return counterpart ? [counterpart] : [];
    });
    const counterpartIds = counterpartEntries.map((counterpart) => counterpart.transaction.id).sort();
    const reason =
      transactionPairs.some((pair) => pair.isAmbiguous)
        ? `Pair matcher found multiple possible opposite-side matches for ${formatAmount(transactionPairs[0]?.amount ?? 0)} within ${internalTransferPairDateWindowDays} days: ${formatCounterparts(counterpartEntries)}. Review before applying transfer.`
        : `Pair matcher found an equal opposite-side amount within ${internalTransferPairDateWindowDays} days, but neither side has transfer or card-payment text. Review before applying transfer.`;

    return [
      {
        action: "set_category",
        categoryId: "cat_transfer",
        confidence: transactionPairs.some((pair) => pair.isAmbiguous) ? 0.74 : 0.7,
        id: `sug_${stableIdSuffix([
          internalTransferPairMatcherSource,
          "pending",
          transactionId,
          ...counterpartIds
        ].join(":"))}`,
        markReviewed: false,
        reason,
        source: internalTransferPairMatcherSource,
        tags: [],
        transactionId
      }
    ];
  });
}

function createPairSuggestion({
  confidence,
  counterpart,
  pair,
  reasonPrefix,
  transaction
}: {
  confidence: number;
  counterpart: MatchableTransaction;
  pair: InternalTransferPairMatch;
  reasonPrefix: string;
  transaction: MatchableTransaction;
}): InternalTransferPairSuggestion {
  return {
    action: "set_category",
    categoryId: "cat_transfer",
    confidence,
    id: `sug_${stableIdSuffix([
      internalTransferPairMatcherSource,
      pair.id,
      transaction.transaction.id,
      counterpart.transaction.id
    ].join(":"))}`,
    markReviewed: false,
    reason: `${reasonPrefix}: ${formatAmount(pair.amount)} matches ${counterpart.account.name} on ${counterpart.transaction.date} within ${pair.dateDistanceDays} days.`,
    source: internalTransferPairMatcherSource,
    tags: [],
    transactionId: transaction.transaction.id
  };
}

function groupByAmountAndCurrency(transactions: MatchableTransaction[]): Map<string, MatchableTransaction[]> {
  const groups = new Map<string, MatchableTransaction[]>();

  for (const transaction of transactions) {
    const key = `${Math.abs(transaction.amountMinor)}:${transaction.transaction.currency}`;
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }

  return groups;
}

function canSuggestTransferCategory(transaction: Transaction): boolean {
  if (transaction.categoryId === "cat_transfer") {
    return true;
  }

  if (transaction.categoryId !== "cat_other") {
    return false;
  }

  if (transaction.reviewed || transaction.notes?.trim()) {
    return false;
  }

  return transaction.tags.every(isProviderOwnedTag);
}

const providerTagNames = ["teller", "plaid", "simplefin", "snaptrade", "financekit"] as const;

function isProviderOwnedTag(tag: string): boolean {
  const normalized = tag.trim().toLowerCase();
  // Provider-assigned tags are the bare provider name (Plaid/SimpleFIN/SnapTrade/
  // FinanceKit) or a namespaced Teller type ("teller:card_payment"). A row that
  // carries only these has not been user-touched, so it stays eligible for
  // automatic transfer marking.
  return providerTagNames.some((name) => normalized === name || normalized.startsWith(`${name}:`));
}

function amountToMinor(amount: number): number {
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function transactionDateTime(date: string): number | undefined {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dayDistance(leftDateTime: number, rightDateTime: number): number {
  return Math.abs(Math.round((leftDateTime - rightDateTime) / 86_400_000));
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedPairIds(left: string, right: string): [string, string] {
  return [left, right].sort() as [string, string];
}

function stablePairId(transactionIds: [string, string]): string {
  return `pair_${stableIdSuffix(transactionIds.join(":"))}`;
}

function stableIdSuffix(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function comparePairMatches(left: InternalTransferPairMatch, right: InternalTransferPairMatch): number {
  return left.transactionIds[0].localeCompare(right.transactionIds[0]) ||
    left.transactionIds[1].localeCompare(right.transactionIds[1]);
}

function formatAmount(amount: number): string {
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatCounterparts(counterparts: MatchableTransaction[]): string {
  return counterparts
    .slice(0, 3)
    .map((entry) => `${entry.account.name} ${entry.transaction.date}`)
    .join(", ");
}
