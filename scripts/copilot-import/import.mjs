#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "../..");
const DEFAULT_SQLITE = path.join(
  homedir(),
  "Library/Group Containers/group.com.copilot.production/database/CopilotDB.sqlite"
);
const COPILOT_PROVIDER_CONNECTION_ID = "provider_copilot_import";
const DAY_MS = 86_400_000;

export function toMinor(amount) {
  if (amount === null || amount === undefined || amount === "") {
    throw new Error("Money amount is missing.");
  }
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid money amount: ${amount}`);
  }
  return Math.round(parsed * 100);
}

export function normalizeBalanceMinor(amount, accountType) {
  const minor = toMinor(amount);
  return accountType === "credit_card" || accountType === "loan" ? -minor : minor;
}

export function buildTransactionTags(transaction, mappings) {
  const tags = [];
  const categoryName = mappings.categories?.[transaction.category_id]?.name;
  if (categoryName) {
    tags.push(`copilot:cat:${categoryName}`);
  }

  for (const tagId of parseTagIds(transaction.tag_ids).values) {
    const tagName = mappings.tags?.[tagId]?.name;
    if (tagName) {
      tags.push(`copilot:tag:${tagName}`);
    }
  }

  if (Number(transaction.is_amazon) === 1) {
    tags.push("copilot:amazon");
  }

  return [...new Set(tags)];
}

export function findDuplicateTransaction(copilotTransaction, existingTransactions) {
  const amountMinor = toMinor(-Number(copilotTransaction.amount));
  const date = dateOnly(copilotTransaction.date);
  const candidates = existingTransactions
    .filter((transaction) => {
      if (String(transaction.id).startsWith("copilot_txn_")) {
        return false;
      }
      return Number(transaction.amount_minor) === amountMinor && dayDistance(date, dateOnly(transaction.date)) <= 2;
    })
    .sort((left, right) => {
      const distance = dayDistance(date, dateOnly(left.date)) - dayDistance(date, dateOnly(right.date));
      return distance || String(left.id).localeCompare(String(right.id));
    });

  return candidates[0];
}

export function findMerchantSignEvidence(duplicates) {
  return duplicates
    .map((duplicate) => {
      const sourceNames = [duplicate.source.name_override, duplicate.source.name, duplicate.source.original_name].filter(Boolean);
      const targetNames = [duplicate.target.merchant_name, duplicate.target.description].filter(Boolean);
      const merchantScore = Math.max(
        0,
        ...sourceNames.flatMap((sourceName) => targetNames.map((targetName) => textSimilarity(sourceName, targetName)))
      );
      return { ...duplicate, merchantScore: roundScore(merchantScore) };
    })
    .filter((duplicate) => duplicate.merchantScore >= 0.55)
    .sort((left, right) => right.merchantScore - left.merchantScore)[0];
}

export function matchCopilotAccount(sourceAccount, targetAccounts) {
  const mask = normalizeMask(sourceAccount.mask);
  if (!mask) {
    return { status: "unmatched", reason: "missing mask" };
  }

  const maskCandidates = targetAccounts.filter((account) => normalizeMask(account.mask) === mask);
  if (maskCandidates.length === 0) {
    return { status: "unmatched", reason: "no target account with the same mask" };
  }

  const sourceType = mapAccountType(sourceAccount);
  const sourceNames = [sourceAccount.name, sourceAccount.officialName].filter(Boolean);
  const scored = maskCandidates
    .map((account) => {
      const nameScore = Math.max(0, ...sourceNames.map((name) => textSimilarity(name, account.name)));
      const institutionScore = textSimilarity(sourceAccount.institutionName, account.institution_name);
      const typeScore = sourceType === account.type ? 1 : 0;
      return {
        ...account,
        score: roundScore(nameScore * 0.55 + institutionScore * 0.35 + typeScore * 0.1),
        signals: { institutionScore: roundScore(institutionScore), nameScore: roundScore(nameScore), typeScore }
      };
    })
    .filter((candidate) => candidate.signals.nameScore >= 0.35 || candidate.signals.institutionScore >= 0.55)
    .sort((left, right) => right.score - left.score || String(left.id).localeCompare(String(right.id)));

  if (scored.length === 0) {
    return { status: "unmatched", reason: "mask matched but names/institutions did not" };
  }
  if (scored.length === 1) {
    return { status: "matched", account: scored[0] };
  }
  if (scored[0].score - scored[1].score >= 0.12) {
    return { status: "matched", account: scored[0] };
  }
  return { status: "ambiguous", candidates: scored };
}

export function buildImportPlan({ balances, existingAccounts, existingSnapshots, existingTransactions, mappings, overrides = {}, sourceStats, transactions }) {
  // Operator-supplied resolutions for dry-run blockers: forced account matches
  // (verified out-of-band, e.g. by balance equality), a default currency for a
  // single-currency user's rows that predate Copilot storing one, and permission
  // for archival accounts to import with a zero opening balance.
  const forcedMatches = overrides.forcedMatches ?? {};
  const defaultCurrency = overrides.defaultCurrency;
  const allowEmptyBalances = overrides.allowEmptyBalances === true;
  const accountMappings = normalizeMappingBucket(mappings.accounts);
  const categoryMappings = normalizeMappingBucket(mappings.categories);
  const tagMappings = normalizeMappingBucket(mappings.tags);
  const normalizedMappings = { accounts: accountMappings, categories: categoryMappings, tags: tagMappings };
  const relevantAccountIds = new Set([...transactions.map((row) => row.account_id), ...balances.map((row) => row.account_id)]);
  const targetAccounts = existingAccounts.filter((account) => account.provider !== "copilot");
  const existingCopilotAccounts = new Map(
    existingAccounts
      .filter((account) => account.provider === "copilot")
      .map((account) => [account.id, account])
  );
  const balanceRowsByAccount = groupBy(balances, (row) => row.account_id);
  const transactionRowsByAccount = groupBy(transactions, (row) => row.account_id);
  const existingTransactionsByAccount = groupBy(existingTransactions, (row) => row.account_id);
  const latestExistingSnapshotByAccount = new Map(existingSnapshots.map((row) => [row.account_id, row]));
  const accountPlans = [];

  for (const sourceAccountId of [...relevantAccountIds].sort()) {
    const sourceAccount = accountMappings[sourceAccountId];
    if (!sourceAccount) {
      accountPlans.push({ sourceAccountId, status: "missing_mapping" });
      continue;
    }

    const stableAccountId = copilotAccountId(sourceAccountId);
    const existingImportedAccount = existingCopilotAccounts.get(stableAccountId);
    if (existingImportedAccount) {
      accountPlans.push({
        sourceAccount,
        sourceAccountId,
        status: "unmatched",
        targetAccount: existingImportedAccount,
        reason: "existing Copilot import account"
      });
      continue;
    }

    const forcedTargetId = forcedMatches[sourceAccountId];
    const match = forcedTargetId
      ? (() => {
          const forced = targetAccounts.find((account) => account.id === forcedTargetId);
          if (!forced) {
            throw new Error(`Forced match target ${forcedTargetId} does not exist for ${sourceAccountId}.`);
          }
          return { status: "matched", account: forced };
        })()
      : matchCopilotAccount(sourceAccount, targetAccounts);
    if (match.status === "matched") {
      accountPlans.push({ sourceAccount, sourceAccountId, status: "matched", targetAccount: match.account });
    } else if (match.status === "ambiguous") {
      accountPlans.push({ sourceAccount, sourceAccountId, status: "ambiguous", candidates: match.candidates });
    } else {
      const latestBalance = newestDatedRow(balanceRowsByAccount.get(sourceAccountId) ?? []);
      const latestTransaction = newestDatedRow(transactionRowsByAccount.get(sourceAccountId) ?? []);
      const type = mapAccountType(sourceAccount);
      const sourceName = cleanText(sourceAccount.name) || cleanText(sourceAccount.officialName);
      const currency =
        cleanText(sourceAccount.currency) ||
        accountCurrency(transactionRowsByAccount.get(sourceAccountId) ?? []) ||
        defaultCurrency ||
        null;
      accountPlans.push({
        sourceAccount,
        sourceAccountId,
        status: "unmatched",
        reason: match.reason,
        targetAccount: {
          id: stableAccountId,
          provider: "copilot",
          provider_connection_id: COPILOT_PROVIDER_CONNECTION_ID,
          group_id: type ? groupIdForType(type) : null,
          name: sourceName,
          institution_name: cleanText(sourceAccount.institutionName),
          type,
          mask: normalizeMask(sourceAccount.mask),
          currency,
          current_balance_minor:
            latestBalance?.current_balance === null || latestBalance?.current_balance === undefined
              ? null
              : normalizeBalanceMinor(latestBalance.current_balance, type),
          available_balance_minor:
            latestBalance?.available_balance === null || latestBalance?.available_balance === undefined
              ? null
              : toMinor(latestBalance.available_balance),
          included_in_net_worth: false,
          last_updated_at: `${dateOnly(latestBalance?.date ?? latestTransaction?.date)}T00:00:00.000Z`
        }
      });
    }
  }

  const accountPlanBySourceId = new Map(accountPlans.map((plan) => [plan.sourceAccountId, plan]));
  const duplicates = [];
  const importTransactions = [];
  const invalidTagJsonTransactionIds = [];
  const invalidTransactionAmountIds = [];
  const missingTransactionCurrencyIds = [];
  const missingTransactionNameIds = [];
  const missingCategoryIds = new Set();
  const missingTagIds = new Set();

  for (const transaction of transactions) {
    const accountPlan = accountPlanBySourceId.get(transaction.account_id);
    if (!accountPlan || !["matched", "unmatched"].includes(accountPlan.status)) {
      continue;
    }

    if (cleanText(transaction.category_id) && !categoryMappings[transaction.category_id]?.name) {
      missingCategoryIds.add(transaction.category_id);
    }
    const parsedTagIds = parseTagIds(transaction.tag_ids);
    if (!parsedTagIds.valid) {
      invalidTagJsonTransactionIds.push(transaction.id);
    }
    for (const tagId of parsedTagIds.values) {
      if (!tagMappings[tagId]?.name) {
        missingTagIds.add(tagId);
      }
    }

    if (transaction.amount === null || transaction.amount === undefined || !Number.isFinite(Number(transaction.amount))) {
      invalidTransactionAmountIds.push(transaction.id);
      continue;
    }
    const currency = cleanText(transaction.iso_currency_code)?.toUpperCase() || defaultCurrency;
    if (!currency) {
      missingTransactionCurrencyIds.push(transaction.id);
    }
    const merchantName = cleanText(transaction.name_override) || cleanText(transaction.name) || cleanText(transaction.original_name);
    const description = cleanText(transaction.original_name) || cleanText(transaction.name);
    if (!merchantName || !description) {
      missingTransactionNameIds.push(transaction.id);
    }

    const duplicate =
      accountPlan.status === "matched"
        ? findDuplicateTransaction(transaction, existingTransactionsByAccount.get(accountPlan.targetAccount.id) ?? [])
        : undefined;
    if (duplicate) {
      duplicates.push({ source: transaction, target: duplicate, targetAccountId: accountPlan.targetAccount.id });
      continue;
    }

    importTransactions.push({
      id: `copilot_txn_${transaction.id}`,
      sourceId: transaction.id,
      accountId: accountPlan.targetAccount.id,
      providerConnectionId: accountPlan.targetAccount.provider_connection_id,
      date: dateOnly(transaction.date),
      merchantName,
      description,
      amountMinor: toMinor(-Number(transaction.amount)),
      currency,
      categoryId: "cat_other",
      status: "posted",
      reviewed: false,
      tags: buildTransactionTags(transaction, normalizedMappings),
      notes: cleanText(transaction.user_note) || null
    });
  }

  const snapshots = [];
  const invalidBalanceRows = [];
  for (const balance of balances) {
    const accountPlan = accountPlanBySourceId.get(balance.account_id);
    if (!accountPlan || !["matched", "unmatched"].includes(accountPlan.status)) {
      continue;
    }
    if (balance.current_balance === null || balance.current_balance === undefined || !Number.isFinite(Number(balance.current_balance))) {
      invalidBalanceRows.push(`${balance.account_id}:${balance.date}`);
      continue;
    }
    const accountType = accountPlan.targetAccount.type ?? mapAccountType(accountPlan.sourceAccount);
    const date = dateOnly(balance.date);
    snapshots.push({
      id: `copilot_bal_${balance.account_id}_${date}`,
      accountId: accountPlan.targetAccount.id,
      asOfDate: date,
      capturedAt: `${date}T00:00:00.000Z`,
      ledgerBalanceMinor: normalizeBalanceMinor(balance.current_balance, accountType),
      availableBalanceMinor:
        balance.available_balance === null || balance.available_balance === undefined
          ? null
          : toMinor(balance.available_balance),
      currency:
        accountPlan.targetAccount.currency ||
        cleanText(accountPlan.sourceAccount?.currency) ||
        accountCurrency(transactionRowsByAccount.get(balance.account_id) ?? []),
      source: "copilot"
    });
  }

  const blockingIssues = [];
  const ambiguous = accountPlans.filter((plan) => plan.status === "ambiguous");
  const missingAccountMappings = accountPlans.filter((plan) => plan.status === "missing_mapping");
  const newAccounts = accountPlans
    .filter((plan) => plan.status === "unmatched" && plan.targetAccount.provider === "copilot" && !existingCopilotAccounts.has(plan.targetAccount.id))
    .map((plan) => plan.targetAccount);
  if (allowEmptyBalances) {
    for (const account of newAccounts) {
      if (account.current_balance_minor === null) {
        account.current_balance_minor = 0; // archival, net-worth-excluded — zero is honest
      }
    }
  }
  const missingBalanceAccountIds = newAccounts.filter((account) => account.current_balance_minor === null).map((account) => account.id);
  const missingCurrencyAccountIds = newAccounts.filter((account) => !account.currency).map((account) => account.id);
  const missingInstitutionAccountIds = newAccounts.filter((account) => !account.institution_name).map((account) => account.id);
  const missingNameAccountIds = newAccounts.filter((account) => !account.name).map((account) => account.id);
  const missingTypeAccountIds = newAccounts.filter((account) => !account.type).map((account) => account.id);
  if (ambiguous.length > 0) blockingIssues.push(`${ambiguous.length} ambiguous account mapping(s)`);
  if (missingAccountMappings.length > 0) blockingIssues.push(`${missingAccountMappings.length} missing account mapping(s)`);
  if (missingCategoryIds.size > 0) blockingIssues.push(`${missingCategoryIds.size} used category id(s) without names`);
  if (missingTagIds.size > 0) blockingIssues.push(`${missingTagIds.size} used tag id(s) without names`);
  if (invalidTagJsonTransactionIds.length > 0) blockingIssues.push(`${invalidTagJsonTransactionIds.length} transaction(s) with invalid tag_ids JSON`);
  if (invalidTransactionAmountIds.length > 0) blockingIssues.push(`${invalidTransactionAmountIds.length} transaction(s) with invalid amounts`);
  if (missingTransactionCurrencyIds.length > 0) blockingIssues.push(`${missingTransactionCurrencyIds.length} transaction(s) without source currency`);
  if (missingTransactionNameIds.length > 0) blockingIssues.push(`${missingTransactionNameIds.length} transaction(s) without source names/descriptions`);
  if (invalidBalanceRows.length > 0) blockingIssues.push(`${invalidBalanceRows.length} balance row(s) without valid current_balance`);
  if (missingBalanceAccountIds.length > 0) blockingIssues.push(`${missingBalanceAccountIds.length} new account(s) without accountDailyBalance history`);
  if (missingCurrencyAccountIds.length > 0) blockingIssues.push(`${missingCurrencyAccountIds.length} new account(s) without source currency`);
  if (missingInstitutionAccountIds.length > 0) blockingIssues.push(`${missingInstitutionAccountIds.length} new account(s) without a source institution`);
  if (missingNameAccountIds.length > 0) blockingIssues.push(`${missingNameAccountIds.length} new account(s) without a source name`);
  if (missingTypeAccountIds.length > 0) blockingIssues.push(`${missingTypeAccountIds.length} new account(s) without a recognized source type`);
  const importedDateRange = range(importTransactions.map((transaction) => transaction.date));
  const sourceDateRange = range(transactions.map((transaction) => dateOnly(transaction.date)));
  const snapshotDateRange = range(snapshots.map((snapshot) => snapshot.asOfDate));
  const signEvidenceDuplicate = findMerchantSignEvidence(duplicates);
  const creditAccountPlan = accountPlans.find(
    (plan) => plan.status === "matched" && plan.targetAccount.type === "credit_card" && latestExistingSnapshotByAccount.has(plan.targetAccount.id)
  );
  const creditSourceBalance = creditAccountPlan
    ? newestDatedRow(balanceRowsByAccount.get(creditAccountPlan.sourceAccountId) ?? [])
    : undefined;
  const balanceSignEvidence =
    creditAccountPlan && creditSourceBalance
      ? {
          account: creditAccountPlan.targetAccount.name,
          copilotRawMinor: toMinor(creditSourceBalance.current_balance),
          normalizedMinor: normalizeBalanceMinor(creditSourceBalance.current_balance, "credit_card"),
          kobanExistingMinor: Number(latestExistingSnapshotByAccount.get(creditAccountPlan.targetAccount.id).ledger_balance_minor)
        }
      : undefined;
  if (
    balanceSignEvidence &&
    balanceSignEvidence.normalizedMinor !== 0 &&
    balanceSignEvidence.kobanExistingMinor !== 0 &&
    Math.sign(balanceSignEvidence.normalizedMinor) !== Math.sign(balanceSignEvidence.kobanExistingMinor)
  ) {
    blockingIssues.push("credit balance sign verification disagrees with the existing Koban snapshot");
  }
  if (!signEvidenceDuplicate) {
    blockingIssues.push("no amount/date duplicate also matched merchant identity for transaction sign verification");
  }

  return {
    accountPlans,
    blockingIssues,
    duplicates,
    importTransactions,
    invalidTagJsonTransactionIds,
    invalidTransactionAmountIds,
    missingBalanceAccountIds,
    missingCategoryIds: [...missingCategoryIds].sort(),
    missingCurrencyAccountIds,
    missingInstitutionAccountIds,
    missingTagIds: [...missingTagIds].sort(),
    missingTransactionCurrencyIds,
    missingTransactionNameIds,
    missingTypeAccountIds,
    newAccounts,
    snapshots,
    sourceStats,
    ranges: { importedDateRange, snapshotDateRange, sourceDateRange },
    sourceCounts: {
      accountCount: relevantAccountIds.size,
      balanceCount: balances.length,
      transactionCount: transactions.length,
      usedCategoryCount: new Set(transactions.map((transaction) => transaction.category_id).filter(Boolean)).size,
      uncategorizedTransactionCount: transactions.filter((transaction) => !cleanText(transaction.category_id)).length,
      taggedTransactionCount: transactions.filter((transaction) => parseTagIds(transaction.tag_ids).values.length > 0).length,
      amazonTransactionCount: transactions.filter((transaction) => Number(transaction.is_amazon) === 1).length
    },
    signEvidence: {
      balance: balanceSignEvidence,
      transaction: signEvidenceDuplicate
        ? {
            copilotMerchant:
              cleanText(signEvidenceDuplicate.source.name_override) ||
              cleanText(signEvidenceDuplicate.source.name) ||
              cleanText(signEvidenceDuplicate.source.original_name),
            kobanMerchant:
              cleanText(signEvidenceDuplicate.target.merchant_name) || cleanText(signEvidenceDuplicate.target.description),
            merchantScore: signEvidenceDuplicate.merchantScore,
            copilotAmountMinor: toMinor(signEvidenceDuplicate.source.amount),
            normalizedMinor: toMinor(-Number(signEvidenceDuplicate.source.amount)),
            kobanExistingMinor: Number(signEvidenceDuplicate.target.amount_minor),
            date: dateOnly(signEvidenceDuplicate.source.date)
          }
        : undefined
    }
  };
}

export function formatDryRunReport(plan) {
  const lines = [
    "COPILOT MONEY -> KOBAN FULL-HISTORY IMPORT",
    "DRY-RUN REPORT — NO DATABASE WRITES PERFORMED",
    "",
    "Source",
    `- Eligible posted transactions: ${formatNumber(plan.sourceCounts.transactionCount)} (${formatRange(plan.ranges.sourceDateRange)})`,
    `- Skipped pending transactions: ${formatNumber(plan.sourceStats.pendingCount)}`,
    `- Skipped user-deleted transactions: ${formatNumber(plan.sourceStats.deletedCount)}`,
    `- Daily balance snapshots read: ${formatNumber(plan.sourceCounts.balanceCount)}`,
    `- Copilot accounts referenced: ${formatNumber(plan.sourceCounts.accountCount)}`,
    "",
    "Account mapping"
  ];

  for (const account of plan.accountPlans) {
    const sourceName = account.sourceAccount?.name || account.sourceAccount?.officialName || account.sourceAccountId;
    const mask = account.sourceAccount?.mask ? ` …${account.sourceAccount.mask}` : " (no mask)";
    const accountTransactions = plan.importTransactions.filter((transaction) => transaction.sourceId && transaction.accountId === account.targetAccount?.id).length;
    const accountDuplicates = plan.duplicates.filter((duplicate) => duplicate.source.account_id === account.sourceAccountId).length;
    const accountSnapshots = plan.snapshots.filter((snapshot) => snapshot.accountId === account.targetAccount?.id).length;
    if (account.status === "matched") {
      lines.push(
        `- MATCHED: ${sourceName}${mask} -> ${account.targetAccount.institution_name} / ${account.targetAccount.name} ` +
          `[${account.targetAccount.provider}] | import ${accountTransactions}, drop dupes ${accountDuplicates}, snapshots ${accountSnapshots}`
      );
    } else if (account.status === "unmatched") {
      lines.push(
        `- UNMATCHED/NEW: ${sourceName}${mask} -> ${account.targetAccount.id} (net worth excluded; ${account.reason}) ` +
          `| import ${accountTransactions}, snapshots ${accountSnapshots}`
      );
    } else if (account.status === "ambiguous") {
      lines.push(
        `- AMBIGUOUS: ${sourceName}${mask} -> ${account.candidates.map((candidate) => `${candidate.institution_name}/${candidate.name} (${candidate.id}, score ${candidate.score})`).join("; ")}`
      );
    } else {
      lines.push(`- MISSING MAPPING: ${account.sourceAccountId}`);
    }
  }

  const matchedCount = plan.accountPlans.filter((account) => account.status === "matched").length;
  const unmatchedCount = plan.accountPlans.filter((account) => account.status === "unmatched").length;
  const ambiguousCount = plan.accountPlans.filter((account) => account.status === "ambiguous").length;
  const missingCount = plan.accountPlans.filter((account) => account.status === "missing_mapping").length;
  lines.push(
    `- Summary: ${matchedCount} matched, ${unmatchedCount} unmatched/import accounts, ${ambiguousCount} ambiguous, ${missingCount} missing mappings`,
    "",
    "Transactions",
    `- To import/upsert: ${formatNumber(plan.importTransactions.length)} (${formatRange(plan.ranges.importedDateRange)})`,
    `- Existing Koban duplicates dropped: ${formatNumber(plan.duplicates.length)}`,
    `- Target category: cat_other for every imported row; reviewed=false`,
    `- Copilot categories preserved as source tags: ${formatNumber(plan.sourceCounts.usedCategoryCount - plan.missingCategoryIds.length)}/${formatNumber(plan.sourceCounts.usedCategoryCount)} used category ids resolved`,
    `- Source rows without a Copilot category: ${formatNumber(plan.sourceCounts.uncategorizedTransactionCount)} (no category provenance tag added)`,
    `- Copilot user tags: ${formatNumber(plan.sourceCounts.taggedTransactionCount)} tagged transactions; missing tag ids ${plan.missingTagIds.length}`,
    `- Amazon provenance: ${formatNumber(plan.sourceCounts.amazonTransactionCount)} transactions tagged copilot:amazon`,
    `- Invalid tag_ids JSON rows: ${formatNumber(plan.invalidTagJsonTransactionIds.length)}`,
    `- Invalid amount rows: ${formatNumber(plan.invalidTransactionAmountIds.length)}`,
    `- Rows without source currency: ${formatNumber(plan.missingTransactionCurrencyIds.length)}`,
    `- Rows without source names/descriptions: ${formatNumber(plan.missingTransactionNameIds.length)}`,
    "",
    "Balance history",
    `- Snapshots to upsert: ${formatNumber(plan.snapshots.length)} (${formatRange(plan.ranges.snapshotDateRange)})`,
    `- New archival accounts: ${formatNumber(plan.newAccounts.length)} under ${COPILOT_PROVIDER_CONNECTION_ID}, includedInNetWorth=false`,
    `- New accounts without accountDailyBalance history: ${formatNumber(plan.missingBalanceAccountIds.length)}`,
    "",
    "Sign verification"
  );

  if (plan.signEvidence.transaction) {
    const evidence = plan.signEvidence.transaction;
    lines.push(
      `- Known overlap row: ${evidence.date}; Copilot merchant "${evidence.copilotMerchant}" and Koban merchant "${evidence.kobanMerchant}" ` +
        `(similarity ${evidence.merchantScore}); Copilot ${money(evidence.copilotAmountMinor)} -> Koban ${money(evidence.normalizedMinor)}, existing Koban ${money(evidence.kobanExistingMinor)}`
    );
  } else {
    lines.push("- No overlapping transaction was available for a merchant-row sign check.");
  }
  if (plan.signEvidence.balance) {
    const evidence = plan.signEvidence.balance;
    lines.push(
      `- Credit balance: ${evidence.account}; Copilot raw ${money(evidence.copilotRawMinor)} -> normalized ${money(evidence.normalizedMinor)}; existing Koban snapshot ${money(evidence.kobanExistingMinor)}`
    );
  } else {
    lines.push("- No matched credit-card snapshot was available for a balance sign check.");
  }

  lines.push("", "Apply readiness");
  if (plan.blockingIssues.length === 0) {
    lines.push("- READY FOR ORCHESTRATOR REVIEW. Apply was not run.");
  } else {
    lines.push("- BLOCKED. Apply will refuse to run until these issues are resolved:");
    for (const issue of plan.blockingIssues) lines.push(`  - ${issue}`);
  }
  if (plan.missingCategoryIds.length > 0) lines.push(`- Missing category ids: ${plan.missingCategoryIds.join(", ")}`);
  if (plan.missingTagIds.length > 0) lines.push(`- Missing tag ids: ${plan.missingTagIds.join(", ")}`);
  if (plan.missingBalanceAccountIds.length > 0) lines.push(`- Missing-balance account ids: ${plan.missingBalanceAccountIds.join(", ")}`);
  if (plan.missingCurrencyAccountIds.length > 0) lines.push(`- Missing-currency account ids: ${plan.missingCurrencyAccountIds.join(", ")}`);
  if (plan.missingInstitutionAccountIds.length > 0) lines.push(`- Missing-institution account ids: ${plan.missingInstitutionAccountIds.join(", ")}`);
  if (plan.missingTypeAccountIds.length > 0) lines.push(`- Missing-type account ids: ${plan.missingTypeAccountIds.join(", ")}`);

  return `${lines.join("\n")}\n`;
}

export async function applyPlan(plan, persist = persistThroughFinanceDb) {
  if (plan.blockingIssues.length > 0) {
    throw new Error(`Refusing --apply because the dry run has blockers: ${plan.blockingIssues.join("; ")}`);
  }

  const now = new Date().toISOString();
  return persist({
    accounts: plan.newAccounts.map((account) => ({
      id: account.id,
      providerConnectionId: account.provider_connection_id,
      groupId: account.group_id,
      name: account.name,
      institutionName: account.institution_name,
      type: account.type,
      mask: account.mask ?? undefined,
      currency: account.currency,
      currentBalance: account.current_balance_minor / 100,
      availableBalance:
        account.available_balance_minor === null ? undefined : account.available_balance_minor / 100,
      includedInNetWorth: false,
      lastUpdatedAt: account.last_updated_at
    })),
    balanceSnapshots: plan.snapshots.map((snapshot) => ({
      id: snapshot.id,
      accountId: snapshot.accountId,
      asOfDate: snapshot.asOfDate,
      capturedAt: snapshot.capturedAt,
      ledgerBalance: snapshot.ledgerBalanceMinor / 100,
      availableBalance:
        snapshot.availableBalanceMinor === null ? undefined : snapshot.availableBalanceMinor / 100,
      currency: snapshot.currency,
      source: snapshot.source
    })),
    providerConnection:
      plan.newAccounts.length > 0
        ? {
            id: COPILOT_PROVIDER_CONNECTION_ID,
            provider: "copilot",
            displayName: "Copilot Money Import",
            status: "connected",
            configured: true,
            lastSyncedAt: now
          }
        : undefined,
    transactions: plan.importTransactions.map((transaction) => ({
      id: transaction.id,
      accountId: transaction.accountId,
      providerConnectionId: transaction.providerConnectionId,
      date: transaction.date,
      postedDate: transaction.date,
      merchantName: transaction.merchantName,
      description: transaction.description,
      amount: transaction.amountMinor / 100,
      currency: transaction.currency,
      categoryId: "cat_other",
      status: "posted",
      reviewed: false,
      tags: transaction.tags,
      notes: transaction.notes ?? undefined
    }))
  });
}

async function persistThroughFinanceDb(input) {
  const loaded = await loadFinanceDbCopilotImporter();
  try {
    return await loaded.apply(input);
  } finally {
    await loaded.close();
  }
}

export async function loadFinanceDbCopilotImporter() {
  const require = createRequire(path.join(ROOT_DIR, "apps/web/package.json"));
  const viteEntry = require.resolve("vite");
  const { createServer } = await import(pathToFileURL(viteEntry).href);
  const appRoot = path.join(ROOT_DIR, "apps/web");
  const server = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "error",
    resolve: { alias: { "@": appRoot } },
    root: appRoot,
    server: { middlewareMode: true }
  });

  const financeDb = await server.ssrLoadModule("/lib/db/finance-db.ts");
  return {
    apply: financeDb.applyCopilotHistoryImport,
    close: () => server.close()
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.mappings)) {
    throw new Error(`Mappings file not found: ${args.mappings}. Run extract.py first.`);
  }
  if (!existsSync(args.sqlite)) {
    throw new Error(`Copilot SQLite database not found: ${args.sqlite}`);
  }

  const mappings = JSON.parse(readFileSync(args.mappings, "utf8"));
  const transactions = sqliteJson(
    args.sqlite,
    `SELECT id, date, name, original_name, name_override, amount, iso_currency_code, account_id,
            category_id, recurring, recurring_id, user_note, user_reviewed, tag_ids, is_amazon, financial_goal_id
     FROM Transactions
     WHERE COALESCE(user_deleted, 0) = 0 AND COALESCE(pending, 0) = 0
     ORDER BY date, id`
  );
  const balances = sqliteJson(
    args.sqlite,
    `SELECT date, account_id, current_balance, available_balance
     FROM accountDailyBalance
     ORDER BY date, account_id`
  );
  const sourceStats = sqliteJson(
    args.sqlite,
    `SELECT
       SUM(CASE WHEN COALESCE(user_deleted, 0) = 0 AND COALESCE(pending, 0) = 1 THEN 1 ELSE 0 END) AS pending_count,
       SUM(CASE WHEN COALESCE(user_deleted, 0) <> 0 THEN 1 ELSE 0 END) AS deleted_count
     FROM Transactions`
  )[0] ?? { pending_count: 0, deleted_count: 0 };

  const databaseUrl = process.env.DATABASE_URL || readRootEnv().DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is missing from the environment and root .env file.");
  }
  const require = createRequire(path.join(ROOT_DIR, "apps/web/package.json"));
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  let plan;
  try {
    const [accountsResult, transactionsResult, snapshotsResult, categoryResult] = await Promise.all([
      pool.query(
        `SELECT a.*, pc.provider
         FROM accounts a
         JOIN provider_connections pc ON pc.id = a.provider_connection_id
         ORDER BY pc.provider, a.institution_name, a.name, a.id`
      ),
      pool.query(
        `SELECT id, account_id, provider_connection_id, date, amount_minor, merchant_name, description
         FROM transactions
         ORDER BY date, id`
      ),
      pool.query(
        `SELECT DISTINCT ON (account_id) account_id, as_of_date, captured_at, ledger_balance_minor, source
         FROM account_balance_snapshots
         ORDER BY account_id, as_of_date DESC, captured_at DESC, id DESC`
      ),
      pool.query("SELECT id FROM categories WHERE id = 'cat_other'")
    ]);
    if (categoryResult.rows.length !== 1) {
      throw new Error("Target category cat_other does not exist; refusing to plan an import.");
    }

    plan = buildImportPlan({
      balances,
      existingAccounts: accountsResult.rows,
      existingSnapshots: snapshotsResult.rows,
      existingTransactions: transactionsResult.rows,
      mappings,
      overrides: {
        allowEmptyBalances: args.allowEmptyBalances,
        defaultCurrency: args.defaultCurrency,
        forcedMatches: args.forcedMatches
      },
      sourceStats: {
        deletedCount: Number(sourceStats.deleted_count ?? 0),
        pendingCount: Number(sourceStats.pending_count ?? 0)
      },
      transactions
    });
    const report = formatDryRunReport(plan);
    process.stdout.write(report);
    if (args.report) {
      writeFileSync(args.report, report, "utf8");
    }
  } finally {
    await pool.end();
  }

  if (args.apply) {
    await applyPlan(plan);
    process.stdout.write(
      `\nAPPLY COMPLETE: ${plan.newAccounts.length} new accounts, ${plan.importTransactions.length} transactions, ${plan.snapshots.length} snapshots.\n`
    );
  }
}

function parseArgs(argv) {
  const args = {
    allowEmptyBalances: false,
    apply: false,
    defaultCurrency: undefined,
    forcedMatches: {},
    mappings: path.join(SCRIPT_DIR, "mappings.json"),
    report: null,
    sqlite: DEFAULT_SQLITE
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") args.apply = true;
    else if (argument === "--allow-empty-balance-accounts") args.allowEmptyBalances = true;
    else if (argument === "--default-currency")
      args.defaultCurrency = requireValue(argv, ++index, argument).toUpperCase();
    else if (argument === "--match") {
      const pair = requireValue(argv, ++index, argument);
      const [sourceId, targetId] = pair.split("=");
      if (!sourceId || !targetId) throw new Error(`--match expects <copilotAccountId>=<kobanAccountId>, got: ${pair}`);
      args.forcedMatches[sourceId] = targetId;
    } else if (argument === "--mappings") args.mappings = path.resolve(requireValue(argv, ++index, argument));
    else if (argument === "--report") args.report = path.resolve(requireValue(argv, ++index, argument));
    else if (argument === "--sqlite") args.sqlite = path.resolve(requireValue(argv, ++index, argument));
    else if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: node scripts/copilot-import/import.mjs [--mappings PATH] [--sqlite PATH] [--report PATH] [--default-currency USD] [--match copilotId=kobanId]... [--allow-empty-balance-accounts] [--apply]"
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function sqliteJson(sqlitePath, sql) {
  const output = execFileSync("sqlite3", ["-readonly", "-json", sqlitePath, sql], {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024
  });
  return output.trim() ? JSON.parse(output) : [];
}

function readRootEnv() {
  const envPath = path.join(ROOT_DIR, ".env");
  if (!existsSync(envPath)) return {};
  const values = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function normalizeMappingBucket(bucket) {
  if (!bucket) return {};
  if (!Array.isArray(bucket)) return bucket;
  return Object.fromEntries(bucket.filter((entry) => entry?.id).map((entry) => [entry.id, entry]));
}

function parseTagIds(value) {
  if (value === null || value === undefined || value === "") return { valid: true, values: [] };
  if (Array.isArray(value)) return { valid: true, values: value.map(String) };
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? { valid: true, values: parsed.map(String) } : { valid: false, values: [] };
  } catch {
    return { valid: false, values: [] };
  }
}

function mapAccountType(account) {
  const value = [account.originalType, account.originalSubtype, account.type, account.subtype, account.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/credit|card/.test(value)) return "credit_card";
  if (/saving/.test(value)) return "savings";
  if (/checking/.test(value)) return "checking";
  if (/investment|brokerage|stock plan/.test(value)) return "investment";
  if (/loan|mortgage/.test(value)) return "loan";
  if (/cash|other/.test(value)) return "cash";
  return null;
}

function groupIdForType(type) {
  if (type === "credit_card") return "group_credit";
  if (type === "investment") return "group_investments";
  if (type === "loan") return "group_other";
  return "group_cash";
}

function normalizeMask(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : null;
}

function copilotAccountId(sourceAccountId) {
  return `copilot_acct_${sourceAccountId}`;
}

function textSimilarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  let overlap = 0;
  const remaining = new Map();
  for (const gram of bBigrams) remaining.set(gram, (remaining.get(gram) ?? 0) + 1);
  for (const gram of aBigrams) {
    const count = remaining.get(gram) ?? 0;
    if (count > 0) {
      overlap += 1;
      remaining.set(gram, count - 1);
    }
  }
  return (2 * overlap) / (aBigrams.length + bBigrams.length);
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, " ")
    .toLowerCase()
    .replace(/\b(?:bank|card|account|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(value) {
  if (value.length < 2) return [value];
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
}

function roundScore(value) {
  return Math.round(value * 1000) / 1000;
}

function dateOnly(value) {
  const match = String(value ?? "").match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error(`Invalid date: ${value}`);
  return match[0];
}

function dayDistance(left, right) {
  return Math.abs(Date.parse(`${left}T00:00:00.000Z`) - Date.parse(`${right}T00:00:00.000Z`)) / DAY_MS;
}

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function groupBy(items, keyFor) {
  const result = new Map();
  for (const item of items) {
    const key = keyFor(item);
    const values = result.get(key) ?? [];
    values.push(item);
    result.set(key, values);
  }
  return result;
}

function newestDatedRow(rows) {
  return [...rows].sort((left, right) => dateOnly(right.date).localeCompare(dateOnly(left.date)))[0];
}

function accountCurrency(transactions) {
  return cleanText(transactions.find((transaction) => transaction.iso_currency_code)?.iso_currency_code)?.toUpperCase() || null;
}

function range(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort();
  return { first: sorted[0], last: sorted.at(-1) };
}

function formatRange(value) {
  return value ? `${value.first} -> ${value.last}` : "none";
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function money(minor) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(minor) / 100);
}

const isDirectExecution = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
