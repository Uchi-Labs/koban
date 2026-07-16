import type {
  Account,
  Category,
  EnrichmentSuggestion,
  EnrichmentSuggestionAction,
  EnrichmentSuggestionStatus,
  EvidenceRelationship,
  ExternalSourceKind,
  ExternalSourceStatus,
  FinancialGoal,
  FinancialGoalState,
  InvestmentPosition,
  ProviderConnection,
  SourceItem,
  TagStyle,
  Transaction,
  TransactionEvidenceLink,
  TransactionRule,
  TransactionRuleMatchField,
  TransactionRuleMatchOperator
} from "@ai-finances/schema";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { appCategories } from "@/lib/categories";
import {
  categoryPaletteColor,
  inferCategoryEmoji,
  isCategoryColor,
  isValidCssColor,
  neutralCategoryColor,
  neutralCategoryEmoji
} from "@/lib/category-style";
import { normalizeCurrencyCode } from "@/lib/currency";
import { runInDbWriteScope } from "@/lib/db/db-write-context";
import type { FinanceDbDriver } from "@/lib/db/finance-db-driver";
import { PgFinanceDbDriver } from "@/lib/db/pg-driver";
import {
  hasActivePglitePostmaster,
  isRecoverablePgliteStartupError,
  openPgliteFinanceDb,
  quarantinePgliteDirectory
} from "@/lib/db/pglite-driver";
import {
  activeEmbeddingModel,
  embedTexts,
  type EmbeddingModelInfo
} from "@/lib/embeddings";
import {
  buildInternalTransferPairMatchPlan,
  buildOneSidedInternalTransferPlan,
  internalTransferHeuristicSource,
  internalTransferPairMatcherSource
} from "@/lib/internal-transfer-pairing";
import { invalidateShellDataCache, type AccountBalanceSnapshot, type Ledger } from "@/lib/finance-data";
import { normalizeLedgerAmounts, internalAmountSignConvention } from "@/lib/ledger-normalization";
import {
  isLikelyCatastrophicRegex,
  validateTransactionRuleCreateBody,
  validateTransactionRuleUpdateBody
} from "@/lib/transaction-rule-input";
import {
  isLikelyGroceryTransaction,
  isLikelyIncomeTransaction,
  isLikelyTransferLikeTransaction,
  isReviewActionableTransaction
} from "@/lib/transaction-classification";
import { findWorkspaceRoot, readWorkspaceEnv } from "@/lib/workspace-env";

type FinanceDb = FinanceDbDriver;

const maxRegexRuleCandidateLength = 512;
let categoryRegistrySeeded = false;

export interface SemanticSearchResult {
  body: string;
  distance: number;
  resourceId: string;
  resourceType: "source_item" | "transaction";
  score: number;
  sourceItem?: SourceItem;
  title: string;
  transaction?: Transaction;
}

interface TransactionOverlayRow {
  id: string;
  category_id: string;
  reviewed: boolean;
  tags: unknown;
  notes: string | null;
  financial_goal_id: string | null;
  paired_transaction_id: string | null;
}

interface CategoryRegistryRow {
  archived: boolean;
  color: string;
  created_at: string;
  emoji: string;
  id: string;
  name: string;
  sort_order: number;
  updated_at: string;
}

interface TagRegistryRow {
  color: string | null;
  created_at: string;
  kind: string;
  name: string;
  updated_at: string;
}

interface ProviderConnectionRow {
  id: string;
  provider: ProviderConnection["provider"];
  display_name: string;
  status: ProviderConnection["status"];
  configured: boolean;
  last_synced_at: string | null;
  stale_after: string | null;
  error_message: string | null;
}

interface AccountRow {
  id: string;
  provider_connection_id: string;
  group_id: string;
  name: string;
  institution_name: string;
  type: Account["type"];
  mask: string | null;
  currency: Account["currency"];
  current_balance_minor: number;
  available_balance_minor: number | null;
  included_in_net_worth: boolean;
  last_updated_at: string;
}

interface AccountBalanceSnapshotRow {
  id: string;
  account_id: string;
  as_of_date: string;
  captured_at: string;
  ledger_balance_minor: number;
  available_balance_minor: number | null;
  currency: string;
  source: string;
}

interface InvestmentPositionRow {
  id: string;
  account_id: string;
  symbol: string;
  description: string;
  units: number;
  price: number | null;
  cost_basis: number | null;
  currency: string;
  market_value_minor: number;
}

interface TransactionRow {
  id: string;
  account_id: string;
  provider_connection_id: string;
  date: string;
  authorized_date: string | null;
  posted_date: string | null;
  merchant_name: string;
  description: string;
  amount_minor: number;
  currency: Transaction["currency"];
  category_id: string;
  status: Transaction["status"];
  reviewed: boolean;
  tags: unknown;
  notes: string | null;
  pending_transaction_id: string | null;
  financial_goal_id: string | null;
  paired_transaction_id: string | null;
}

interface FinancialGoalRow {
  id: string;
  name: string;
  emoji: string | null;
  target_amount_minor: number | null;
  state: FinancialGoalState;
  created_at: string;
  updated_at: string;
}

interface FinancialGoalStatsRow extends FinancialGoalRow {
  saved_amount_minor: number;
  transaction_count: number;
}

interface TransactionRuleRow {
  category_id: string | null;
  created_at: string;
  enabled: boolean;
  id: string;
  last_applied_at: string | null;
  last_applied_count: number;
  mark_reviewed: boolean;
  match_field: TransactionRuleMatchField;
  match_operator: TransactionRuleMatchOperator;
  name: string;
  pattern: string;
  tags: unknown;
  updated_at: string;
}

interface EnrichmentSuggestionRow {
  action: EnrichmentSuggestionAction;
  applied_at: string | null;
  category_id: string | null;
  confidence: number;
  created_at: string;
  id: string;
  mark_reviewed: boolean;
  reason: string;
  rule_match_field: TransactionRuleMatchField | null;
  rule_match_operator: TransactionRuleMatchOperator | null;
  rule_name: string | null;
  rule_pattern: string | null;
  source: string;
  status: EnrichmentSuggestionStatus;
  tags: unknown;
  transaction_id: string | null;
  updated_at: string;
}

interface SyncStateRow {
  key: string;
  value: string;
}

export type FinanceDbLlmProviderName = "none" | "ollama" | "openai_compatible";
export type FinanceDbLlmCredentialSource = "none" | "openai_api_key" | "chatgpt_oauth" | "ollama" | "local";

export interface FinanceDbLlmProviderStatus {
  baseUrl?: string;
  chatGptOAuthConnected?: boolean;
  chatGptOAuthEnabled?: boolean;
  configured: boolean;
  credentialSource?: FinanceDbLlmCredentialSource;
  errorMessage?: string;
  model?: string;
  provider: FinanceDbLlmProviderName;
  status: ExternalSourceStatus;
  timeoutMs: number;
}

export interface FinanceDbLlmEvidenceSummary {
  confidence: number;
  relationship: string;
  status: string;
  summary: string;
  title: string;
}

export interface FinanceDbLlmEnrichmentContext {
  evidenceByTransactionId: Map<string, FinanceDbLlmEvidenceSummary[]>;
  existingRules: TransactionRule[];
  limit: number;
  transactions: Transaction[];
}

export interface FinanceDbLlmEnrichmentRunSummary {
  completed: boolean;
  errorMessage?: string;
  provider: FinanceDbLlmProviderStatus;
  source?: string;
  suggestionsAccepted: number;
  suggestionsRejected: number;
  suggestionsSeen: number;
}

export interface FinanceDbLlmEnrichmentRunResult extends FinanceDbLlmEnrichmentRunSummary {
  suggestions: EnrichmentSuggestionInput[];
}

export interface FinanceDbLlmEnrichmentDependencies {
  generateLlmEnrichmentSuggestions(context: FinanceDbLlmEnrichmentContext): Promise<FinanceDbLlmEnrichmentRunResult>;
  getProviderStatus(): Promise<FinanceDbLlmProviderStatus>;
}

interface LlmProviderHealthSnapshot extends FinanceDbLlmProviderStatus {
  checkedAt: string;
}

interface SourceItemRow {
  amount_minor: number | null;
  currency: SourceItem["currency"] | null;
  external_id: string;
  id: string;
  kind: SourceItem["kind"];
  merchant_name: string | null;
  occurred_at: string | null;
  source_id: string;
  summary: string;
  title: string;
}

interface EvidenceSummaryRow {
  confidence: number;
  relationship: EvidenceRelationship;
  summary: string;
  status: TransactionEvidenceLink["status"];
  title: string;
}

interface EvidenceSummaryBatchRow extends EvidenceSummaryRow {
  transaction_id: string;
}

interface SourceItemMatchRow extends SourceItemRow {
  updated_at: string;
}

interface PrefixedTransactionRow {
  transaction_account_id: string;
  transaction_amount_minor: number;
  transaction_authorized_date: string | null;
  transaction_category_id: string;
  transaction_currency: Transaction["currency"];
  transaction_date: string;
  transaction_description: string;
  transaction_id_value: string;
  transaction_merchant_name: string;
  transaction_notes: string | null;
  transaction_pending_transaction_id: string | null;
  transaction_posted_date: string | null;
  transaction_provider_connection_id: string;
  transaction_reviewed: boolean;
  transaction_status: Transaction["status"];
  transaction_tags: unknown;
}

interface PrefixedSourceItemRow {
  source_item_amount_minor: number | null;
  source_item_currency: SourceItem["currency"] | null;
  source_item_external_id: string;
  source_item_id: string;
  source_item_kind: SourceItem["kind"];
  source_item_merchant_name: string | null;
  source_item_occurred_at: string | null;
  source_item_source_id: string;
  source_item_summary: string;
  source_item_title: string;
}

interface AppSyncRunRow {
  id: string;
  status: AppSyncRunStatus;
  started_at: string;
  finished_at: string;
  financekit_status?: AppSyncRunStatus;
  plaid_status?: AppSyncRunStatus;
  snaptrade_status?: AppSyncRunStatus;
  simplefin_status?: AppSyncRunStatus;
  sources_status: AppSyncRunStatus;
  enrichment_status: AppSyncRunStatus;
  financekit_summary?: unknown;
  plaid_summary?: unknown;
  snaptrade_summary?: unknown;
  simplefin_summary?: unknown;
  sources_summary: unknown;
  enrichment_summary: unknown;
  error_message: string | null;
}

interface SyncScheduleRow {
  claimed_at: string | null;
  claimed_by: string | null;
  created_at: string;
  enabled: boolean;
  id: string;
  interval_minutes: number;
  last_error_message: string | null;
  last_finished_at: string | null;
  last_run_id: string | null;
  last_started_at: string | null;
  last_status: AppSyncRunStatus | null;
  next_run_at: string | null;
  updated_at: string;
}

export interface ExternalSourceCatalogEntry {
  command: string;
  configured?: boolean;
  displayName: string;
  id: string;
  kind: ExternalSourceKind;
  status?: ExternalSourceStatus;
}

export interface SourceStoreSummary {
  evidenceLinkCount: number;
  externalSourceCount: number;
  sourceItemCount: number;
}

export interface SourceStoreSourceSummary {
  evidenceLinkCount: number;
  lastImportedAt?: string;
  latestOccurredAt?: string;
  sourceId: string;
  sourceItemCount: number;
}

export interface ExternalSourceState {
  errorMessage?: string;
  id: string;
  lastSyncedAt?: string;
  status: ExternalSourceStatus;
}

export interface SourceItemInput extends SourceItem {
  metadata?: Record<string, unknown>;
}

export interface SourceSyncRunInput {
  errorMessage?: string;
  finishedAt: string;
  items: SourceItemInput[];
  runStatus: "succeeded" | "partial" | "error";
  sourceId: string;
  sourceStatus: ExternalSourceStatus;
  startedAt: string;
}

export interface SourceSyncRunRecord {
  errorMessage?: string;
  evidenceLinksSuggested: number;
  id: string;
  itemsSeen: number;
  itemsWritten: number;
  runStatus: "succeeded" | "partial" | "error";
  sourceId: string;
  sourceStatus: ExternalSourceStatus;
}

export interface SourceEvidenceRefreshResult {
  evidenceLinksSuggested: number;
  sourceItemCount: number;
}

export type AppSyncRunStatus = "error" | "partial" | "succeeded";
export const appSyncScheduleId = "whole_app";
export const snapTradeSyncScheduleId = "snaptrade";
export type SyncScheduleId = typeof appSyncScheduleId | typeof snapTradeSyncScheduleId;

// Insert defaults per schedule (disabled until the user/ops enables them).
const syncScheduleDefaults: Record<SyncScheduleId, { intervalMinutes: number }> = {
  [appSyncScheduleId]: { intervalMinutes: 240 },
  [snapTradeSyncScheduleId]: { intervalMinutes: 30 }
};
const syncScheduleClaimTtlMs = 15 * 60 * 1000;

export interface AppSyncRunInput {
  enrichmentStatus: AppSyncRunStatus;
  enrichmentSummary: Record<string, unknown>;
  errorMessage?: string;
  finishedAt: string;
  financekitStatus?: AppSyncRunStatus;
  financekitSummary?: Record<string, unknown>;
  plaidStatus?: AppSyncRunStatus;
  plaidSummary?: Record<string, unknown>;
  simplefinStatus?: AppSyncRunStatus;
  simplefinSummary?: Record<string, unknown>;
  sourcesStatus: AppSyncRunStatus;
  sourcesSummary: Record<string, unknown>;
  snaptradeStatus?: AppSyncRunStatus;
  snaptradeSummary?: Record<string, unknown>;
  startedAt: string;
  status: AppSyncRunStatus;
}

export interface AppSyncRunRecord extends AppSyncRunInput {
  id: string;
}

export interface SyncScheduleUpdateInput {
  enabled?: boolean;
  intervalMinutes?: number;
  nextRunAt?: string | null;
}

export interface SyncScheduleRecord {
  claimedAt?: string;
  claimedBy?: string;
  createdAt: string;
  enabled: boolean;
  id: string;
  intervalMinutes: number;
  lastErrorMessage?: string;
  lastFinishedAt?: string;
  lastRunId?: string;
  lastStartedAt?: string;
  lastStatus?: AppSyncRunStatus;
  nextRunAt?: string;
  updatedAt: string;
}

export interface ContextNoteResult {
  sourceItem: SourceItem;
}

export interface VoiceNoteResult {
  sourceItem: SourceItem;
}

export interface TransactionEvidenceItem {
  confidence: number;
  createdAt: string;
  relationship: EvidenceRelationship;
  sourceItem: SourceItem;
  status: TransactionEvidenceLink["status"];
  transactionId: string;
}

export interface EvidenceReviewItem extends TransactionEvidenceItem {
  transaction: Transaction;
}

export interface TransactionEvidenceCreateInput {
  confidence?: number;
  relationship?: EvidenceRelationship;
  sourceItemId: string;
  status?: TransactionEvidenceLink["status"];
  transactionId: string;
}

export interface TransactionRuleInput {
  categoryId?: string;
  enabled?: boolean;
  markReviewed?: boolean;
  matchField: TransactionRuleMatchField;
  matchOperator: TransactionRuleMatchOperator;
  name: string;
  pattern: string;
  tags?: string[];
}

export interface CategoryCreateInput {
  color?: string;
  emoji?: string;
  name: string;
}

export interface CategoryUpdateInput {
  archived?: boolean;
  color?: string;
  emoji?: string;
  name?: string;
  sortOrder?: number;
}

export interface RuleApplyResult {
  rulesApplied: number;
  transactionsUpdated: number;
}

export interface FinancialGoalCreateInput {
  emoji?: string;
  name: string;
  targetAmountMinor?: number;
}

export interface FinancialGoalUpdateInput {
  emoji?: string | null;
  name?: string;
  state?: FinancialGoalState;
  targetAmountMinor?: number | null;
}

/** A goal plus computed roll-ups over its assigned transactions. */
export interface FinancialGoalWithStats extends FinancialGoal {
  /**
   * Sum of assigned transaction amounts, sign-normalized so money set aside reads
   * positive. Outflow amounts are negative in this app (a goal-funding transfer
   * out of checking is negative), so we negate: saved = -SUM(amount_minor). This
   * also nets correctly — a later refund/withdrawal (positive amount) subtracts
   * from progress.
   */
  savedAmountMinor: number;
  transactionCount: number;
}

export interface EnrichmentRunResult {
  generatedAt: string;
  pairMatcher: InternalTransferPairMatchRunSummary;
  pendingSuggestions: number;
  provider: FinanceDbLlmEnrichmentRunSummary;
  suggestionsCreated: number;
  suggestionsSeen: number;
}

export interface SuggestionApplyResult {
  rule?: TransactionRule;
  suggestion: EnrichmentSuggestion;
  transaction?: Transaction;
}

export interface EnrichmentSuggestionBatchItem extends SuggestionApplyResult {
  id: string;
}

export interface EnrichmentSuggestionBatchResult {
  applied: EnrichmentSuggestionBatchItem[];
  failed: Array<{
    error: string;
    id: string;
  }>;
}

export interface EnrichmentSuggestionItem {
  suggestion: EnrichmentSuggestion;
  transaction?: Transaction;
}

export interface InternalTransferPairMatchRunSummary {
  autoAppliedPairs: number;
  autoAppliedSuggestions: number;
  candidatePairs: number;
  queuedPairs: number;
  queuedSuggestions: number;
  /** Hard-linked counterpart pairs written to `paired_transaction_id`. */
  linkedPairs: number;
  /** One-sided internal transfers marked by the vocabulary heuristic (no connected counterpart). */
  autoAppliedOneSided: number;
}

const emptyInternalTransferPairMatchRunSummary: InternalTransferPairMatchRunSummary = {
  autoAppliedPairs: 0,
  autoAppliedSuggestions: 0,
  candidatePairs: 0,
  queuedPairs: 0,
  queuedSuggestions: 0,
  linkedPairs: 0,
  autoAppliedOneSided: 0
};

export async function applyPersistedLlmProviderHealth(
  configuredProvider: FinanceDbLlmProviderStatus
): Promise<FinanceDbLlmProviderStatus> {
  if (!configuredProvider.configured || !financeDbExists()) {
    return configuredProvider;
  }

  const db = await getFinanceDb();
  const persistedProvider =
    await readPersistedLlmProviderHealth(db) ?? await readLatestAppSyncLlmProviderHealth(db);

  if (!persistedProvider || !sameConfiguredLlmProvider(configuredProvider, persistedProvider)) {
    return configuredProvider;
  }

  if (persistedProvider.status === "connected") {
    return {
      ...configuredProvider,
      status: "connected"
    };
  }

  if (persistedProvider.status === "error") {
    return {
      ...configuredProvider,
      errorMessage: persistedProvider.errorMessage ?? configuredProvider.errorMessage,
      status: "error"
    };
  }

  return configuredProvider;
}

export async function recordLlmProviderHealth(
  provider: FinanceDbLlmProviderStatus,
  checkedAt = new Date().toISOString()
): Promise<void> {
  await enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    await writeLlmProviderHealthSnapshot(db, provider, checkedAt);
  });
}

interface SemanticDocumentRecord {
  body: string;
  bodyHash: string;
  id: string;
  metadata: Record<string, unknown>;
  resourceId: string;
  resourceType: "source_item" | "transaction";
  title: string;
  updatedAt: string;
}

interface EnrichmentSuggestionInput {
  action: EnrichmentSuggestionAction;
  categoryId?: string;
  confidence: number;
  id: string;
  markReviewed?: boolean;
  reason: string;
  ruleMatchField?: TransactionRuleMatchField;
  ruleMatchOperator?: TransactionRuleMatchOperator;
  ruleName?: string;
  rulePattern?: string;
  source: string;
  tags?: string[];
  transactionId?: string;
}

interface SemanticDocumentRow {
  body: string;
  body_hash: string;
  id: string;
}

interface SemanticResourceSearchRow {
  body: string;
  distance: number;
  resource_id: string;
  resource_type: "source_item" | "transaction";
  title: string;
}

interface EmbeddingModelRow {
  dimensions: number;
  id: string;
  model: string;
  provider: string;
  retired_at: string | null;
}

interface SemanticIndexRefreshResult {
  activeModel: EmbeddingModelInfo;
  documentsEmbedded: number;
  modelChanged: boolean;
  previousModelIds: string[];
}

export interface LocalAppDataResetSummary {
  accountCount: number;
  appSyncRunCount: number;
  evidenceLinkCount: number;
  investmentPositionCount: number;
  providerConnectionCount: number;
  ruleCount: number;
  scheduleCount: number;
  semanticDocumentCount: number;
  semanticEmbeddingCount: number;
  sourceCount: number;
  sourceItemCount: number;
  sourceSyncRunCount: number;
  suggestionCount: number;
  syncRunCount: number;
  transactionCount: number;
}

interface FinanceDbGlobalState {
  promise: Promise<FinanceDb> | null;
  recoveryEvent: { originalPath: string; recoveredAt: string } | null;
  writeQueue: Promise<void>;
}

const financeDbGlobal = globalThis as typeof globalThis & {
  __aiFinancesFinanceDb?: FinanceDbGlobalState;
};

function getFinanceDbState(): FinanceDbGlobalState {
  return (financeDbGlobal.__aiFinancesFinanceDb ??= {
    promise: null,
    recoveryEvent: null,
    writeQueue: Promise.resolve()
  });
}

const llmProviderHealthStateKey = "llm_provider_health_v1";

export function getFinanceDbPath(): string {
  const env = readWorkspaceEnv();

  if (env.AI_FINANCES_PGLITE_DIR) {
    return env.AI_FINANCES_PGLITE_DIR;
  }

  // Belt-and-suspenders: test runners must NEVER open the user's real store.
  // Two separate agent-run incidents wiped data/local/pglite through test
  // cleanup paths; tests are required to set AI_FINANCES_PGLITE_DIR.
  if (process.env.NODE_ENV === "test" || process.env.VITEST || process.env.PLAYWRIGHT_TEST_BASE_URL) {
    throw new Error(
      "Refusing to open the default PGlite store in a test environment. Set AI_FINANCES_PGLITE_DIR to a throwaway directory."
    );
  }

  return path.join(findWorkspaceRoot(), "data", "local", "pglite");
}

export function financeDbExists(): boolean {
  const env = readWorkspaceEnv();

  if (env.DATABASE_URL) {
    return true;
  }

  let dbPath: string;
  try {
    dbPath = getFinanceDbPath();
  } catch {
    // Test env without AI_FINANCES_PGLITE_DIR: report "no store" instead of
    // throwing — only actual opens must fail loudly.
    return false;
  }
  return dbPath === ":memory:" || existsSync(dbPath);
}

export function consumeFinanceDbRecoveryEvent(): { originalPath: string; recoveredAt: string } | null {
  const state = getFinanceDbState();
  const event = state.recoveryEvent;
  state.recoveryEvent = null;
  return event;
}

export async function replaceLedgerInDb(ledger: Ledger): Promise<void> {
  return enqueueDbWrite(() => replaceLedgerInDbNow(ledger));
}

export interface SnapTradeInvestmentSnapshotInput {
  accounts: Account[];
  balanceSnapshots: AccountBalanceSnapshot[];
  errors: string[];
  finishedAt: string;
  positionAccountIds: string[];
  positions: InvestmentPosition[];
  providerConnections: ProviderConnection[];
  startedAt: string;
  successfulProviderConnectionIds: string[];
}

export interface SnapTradeInvestmentSnapshotRecord {
  accountCount: number;
  connectionCount: number;
  errorCount: number;
  lastSyncedAt: string;
  positionCount: number;
}

export interface SimpleFinLedgerSnapshotInput {
  accounts: Account[];
  balanceSnapshots: AccountBalanceSnapshot[];
  errors: unknown[];
  finishedAt: string;
  newestPostedAt?: number;
  providerConnections: ProviderConnection[];
  requestEndUnix: number;
  requestStartUnix: number;
  startedAt: string;
  successful: boolean;
  transactions: Transaction[];
}

export interface PlaidLedgerSnapshotInput {
  accounts: Account[];
  balanceSnapshots: AccountBalanceSnapshot[];
  errors: string[];
  finishedAt: string;
  providerConnections: ProviderConnection[];
  removedTransactionIds: string[];
  startedAt: string;
  successfulProviderConnectionIds: string[];
  syncState: Record<string, string>;
  transactions: Transaction[];
}

export interface FinanceKitLedgerSnapshotInput {
  accounts: Account[];
  balanceSnapshots: AccountBalanceSnapshot[];
  deviceName?: string;
  finishedAt: string;
  providerConnection: ProviderConnection;
  startedAt: string;
  transactions: Transaction[];
}

export interface SimpleFinLedgerSnapshotRecord {
  accountCount: number;
  connectionCount: number;
  errorCount: number;
  lastSyncedAt: string;
  newestPostedAt?: number;
  transactionCount: number;
}

export interface PlaidLedgerSnapshotRecord {
  accountCount: number;
  connectionCount: number;
  errorCount: number;
  lastSyncedAt: string;
  removedTransactionCount: number;
  transactionCount: number;
}

export interface FinanceKitLedgerSnapshotRecord {
  accountsUpserted: number;
  lastIngestedAt: string;
  transactionsAdded: number;
  transactionsUnchanged: number;
  transactionsUpdated: number;
}

export async function replaceSnapTradeInvestmentSnapshot(
  input: SnapTradeInvestmentSnapshotInput
): Promise<SnapTradeInvestmentSnapshotRecord> {
  return enqueueDbWrite(() => replaceSnapTradeInvestmentSnapshotNow(input));
}

/**
 * Additively upsert balance snapshots without deleting any existing rows.
 * Used for provider history backfills (e.g. SnapTrade daily account value
 * history) where each row is keyed one-per-account-per-day. Idempotent on the
 * snapshot id, so re-running a backfill tops up new dates and refreshes known
 * ones while leaving live intraday sync captures untouched. Snapshots whose
 * account no longer exists are skipped rather than failing the batch.
 */
export async function upsertAccountBalanceSnapshots(snapshots: AccountBalanceSnapshot[]): Promise<number> {
  if (snapshots.length === 0) {
    return 0;
  }

  return enqueueDbWrite(() => upsertAccountBalanceSnapshotsNow(snapshots));
}

export async function replacePlaidLedgerSnapshot(input: PlaidLedgerSnapshotInput): Promise<PlaidLedgerSnapshotRecord> {
  return enqueueDbWrite(() => replacePlaidLedgerSnapshotNow(input));
}

export async function replaceSimpleFinLedgerSnapshot(
  input: SimpleFinLedgerSnapshotInput
): Promise<SimpleFinLedgerSnapshotRecord> {
  return enqueueDbWrite(() => replaceSimpleFinLedgerSnapshotNow(input));
}

export async function ingestFinanceKitLedgerSnapshot(
  input: FinanceKitLedgerSnapshotInput
): Promise<FinanceKitLedgerSnapshotRecord> {
  return enqueueDbWrite(() => ingestFinanceKitLedgerSnapshotNow(input));
}

export interface CopilotHistoryImportInput {
  accounts: Account[];
  balanceSnapshots: AccountBalanceSnapshot[];
  providerConnection?: ProviderConnection;
  transactions: Transaction[];
}

export interface CopilotHistoryImportRecord {
  accountCount: number;
  balanceSnapshotCount: number;
  transactionCount: number;
}

/**
 * Persist an approved one-time Copilot history plan through the same serialized
 * write boundary as live provider syncs. Existing transaction overlays always
 * win on idempotent reruns.
 */
export async function applyCopilotHistoryImport(
  input: CopilotHistoryImportInput
): Promise<CopilotHistoryImportRecord> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const existingOverlays = await readTransactionOverlays(db);

    await db.exec("BEGIN");
    try {
      if (input.providerConnection) {
        await upsertProviderConnection(db, input.providerConnection);
      }

      for (const account of input.accounts) {
        await upsertAccount(db, account);
      }

      for (const snapshot of input.balanceSnapshots) {
        await db.query(
          `INSERT INTO account_balance_snapshots (
            id,
            account_id,
            as_of_date,
            captured_at,
            ledger_balance_minor,
            available_balance_minor,
            currency,
            source
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO UPDATE SET
            account_id = EXCLUDED.account_id,
            as_of_date = EXCLUDED.as_of_date,
            captured_at = EXCLUDED.captured_at,
            ledger_balance_minor = EXCLUDED.ledger_balance_minor,
            available_balance_minor = EXCLUDED.available_balance_minor,
            currency = EXCLUDED.currency,
            source = EXCLUDED.source`,
          [
            snapshot.id,
            snapshot.accountId,
            snapshot.asOfDate,
            snapshot.capturedAt,
            moneyToMinor(snapshot.ledgerBalance),
            snapshot.availableBalance === undefined ? null : moneyToMinor(snapshot.availableBalance),
            snapshot.currency,
            snapshot.source
          ]
        );
      }

      for (const transaction of input.transactions) {
        await upsertTransaction(db, mergeTransactionOverlay(transaction, existingOverlays.get(transaction.id)));
      }

      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }

    invalidateShellDataCache();
    return {
      accountCount: input.accounts.length,
      balanceSnapshotCount: input.balanceSnapshots.length,
      transactionCount: input.transactions.length
    };
  });
}

export async function resetLocalAppData(): Promise<LocalAppDataResetSummary> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const summary = await readLocalAppDataResetSummary(db);

    await db.exec("BEGIN");
    try {
      await db.query("DELETE FROM semantic_embeddings");
      await db.query("DELETE FROM semantic_documents");
      await db.query("DELETE FROM transaction_evidence_links");
      await db.query("DELETE FROM source_items");
      await db.query("DELETE FROM source_sync_runs");
      await db.query("DELETE FROM external_sources");
      await db.query("DELETE FROM enrichment_suggestions");
      await db.query("DELETE FROM transaction_rules");
      await db.query("DELETE FROM transactions");
      await db.query("DELETE FROM investment_positions");
      await db.query("DELETE FROM account_balance_snapshots");
      await db.query("DELETE FROM accounts");
      await db.query("DELETE FROM sync_run_items");
      await db.query("DELETE FROM sync_runs");
      await db.query("DELETE FROM provider_connections");
      await db.query("DELETE FROM app_sync_runs");
      await db.query("DELETE FROM sync_schedules");
      await db.query("DELETE FROM embedding_models");
      await db.query("DELETE FROM sync_state");
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }

    return summary;
  });
}

export async function listCategories({
  includeArchived = true
}: {
  includeArchived?: boolean;
} = {}): Promise<Category[]> {
  const db = await getFinanceDb();
  return listCategoriesInDb(db, { includeArchived });
}

export async function createCategory(input: CategoryCreateInput): Promise<Category> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const name = normalizeCategoryName(input.name);

    if (!name) {
      throw new Error("Category name is required.");
    }

    const existingCategories = await listCategoriesInDb(db, { includeArchived: true });
    const timestamp = new Date().toISOString();
    const nextSortOrder = Math.max(0, ...existingCategories.map((category) => category.sortOrder)) + 10;
    const category: Category = {
      archived: false,
      color: assertValidRegistryColorInput(input.color) ?? categoryPaletteColor(existingCategories.length),
      createdAt: timestamp,
      emoji: normalizeEmoji(input.emoji) ?? inferCategoryEmoji(name, neutralCategoryEmoji),
      icon: "circle",
      id: `cat_custom_${stableIdSuffix(`${name}:${timestamp}`)}`,
      name,
      sortOrder: nextSortOrder,
      updatedAt: timestamp
    };

    await upsertCategoryRegistryRow(db, category);
    return category;
  });
}

export async function updateCategory(categoryId: string, input: CategoryUpdateInput): Promise<Category | null> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const category = await getCategoryInDb(db, categoryId);

    if (!category) {
      return null;
    }

    const nextName = input.name === undefined ? category.name : normalizeCategoryName(input.name);

    if (!nextName) {
      throw new Error("Category name is required.");
    }

    const nextCategory: Category = {
      ...category,
      archived: input.archived ?? category.archived,
      color: assertValidRegistryColorInput(input.color) ?? category.color,
      // Keep the stored emoji unless the caller sets one — re-inferring from the
      // name here would clobber a custom emoji on every color/name-only PATCH.
      emoji: normalizeEmoji(input.emoji) ?? category.emoji,
      name: nextName,
      sortOrder: input.sortOrder === undefined ? category.sortOrder : normalizeSortOrder(input.sortOrder, category.sortOrder),
      updatedAt: new Date().toISOString()
    };

    await upsertCategoryRegistryRow(db, nextCategory);
    return nextCategory;
  });
}

const seededCategoryIds = new Set([
  "cat_income", "cat_housing", "cat_food", "cat_transportation", "cat_software",
  "cat_shopping", "cat_travel", "cat_transfer", "cat_other"
]);

export async function deleteCustomCategoryAndReassign(categoryId: string, replacementCategoryId: string): Promise<boolean> {
  if (seededCategoryIds.has(categoryId)) throw new Error("System categories cannot be deleted.");
  if (categoryId === replacementCategoryId) throw new Error("Choose a different replacement category.");

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const [category, replacement] = await Promise.all([
      getCategoryInDb(db, categoryId),
      getCategoryInDb(db, replacementCategoryId)
    ]);
    if (!category) return false;
    if (!replacement || replacement.archived) throw new Error("Choose an active replacement category.");

    await db.exec("BEGIN");
    try {
      const affected = await db.query<{ id: string }>("SELECT id FROM transactions WHERE category_id = $1", [categoryId]);
      await db.query("UPDATE transactions SET category_id = $2 WHERE category_id = $1", [categoryId, replacementCategoryId]);
      await db.query("UPDATE transaction_rules SET category_id = $2 WHERE category_id = $1", [categoryId, replacementCategoryId]);
      await db.query("UPDATE enrichment_suggestions SET category_id = $2 WHERE category_id = $1", [categoryId, replacementCategoryId]);
      await db.query("DELETE FROM categories WHERE id = $1", [categoryId]);
      for (const transaction of affected.rows) {
        await refreshTransactionSemanticDocument(db, transaction.id);
      }
      await db.exec("COMMIT");
      invalidateShellDataCache();
      return true;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  });
}

export async function getCategoryIdsForValidation(): Promise<Set<string>> {
  const categories = await listCategories({ includeArchived: false });
  return new Set(categories.map((category) => category.id));
}

/**
 * List all goals with computed roll-ups over their assigned transactions.
 * `saved_amount_minor` is sign-normalized (negated) so money set aside reads
 * positive — see {@link FinancialGoalWithStats}.
 */
export async function listFinancialGoals(): Promise<FinancialGoalWithStats[]> {
  const db = await getFinanceDb();
  const result = await db.query<FinancialGoalStatsRow>(
    `SELECT
      g.id,
      g.name,
      g.emoji,
      g.target_amount_minor,
      g.state,
      g.created_at,
      g.updated_at,
      COALESCE(-SUM(t.amount_minor), 0)::int AS saved_amount_minor,
      COUNT(t.id)::int AS transaction_count
    FROM financial_goals g
    LEFT JOIN transactions t ON t.financial_goal_id = g.id
    GROUP BY g.id
    ORDER BY g.created_at DESC, g.id DESC`
  );

  return result.rows.map(financialGoalStatsFromRow);
}

export async function getFinancialGoalIdsForValidation(): Promise<Set<string>> {
  const db = await getFinanceDb();
  const result = await db.query<{ id: string }>("SELECT id FROM financial_goals");
  return new Set(result.rows.map((row) => row.id));
}

export async function createFinancialGoal(input: FinancialGoalCreateInput): Promise<FinancialGoal> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const name = normalizeGoalName(input.name);

    if (!name) {
      throw new Error("Goal name is required.");
    }

    const timestamp = new Date().toISOString();
    const goal: FinancialGoal = {
      id: `goal_${stableIdSuffix(`${name}:${timestamp}`)}`,
      name,
      emoji: normalizeEmoji(input.emoji),
      targetAmountMinor: normalizeTargetAmount(input.targetAmountMinor),
      state: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await upsertFinancialGoalRow(db, goal);
    return goal;
  });
}

export async function updateFinancialGoal(
  goalId: string,
  input: FinancialGoalUpdateInput
): Promise<FinancialGoal | null> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const existing = await db.query<FinancialGoalRow>("SELECT * FROM financial_goals WHERE id = $1", [goalId]);
    const row = existing.rows[0];

    if (!row) {
      return null;
    }

    const current = financialGoalFromRow(row);
    const nextName = input.name === undefined ? current.name : normalizeGoalName(input.name);

    if (!nextName) {
      throw new Error("Goal name is required.");
    }

    const nextGoal: FinancialGoal = {
      ...current,
      name: nextName,
      emoji: input.emoji === undefined ? current.emoji : normalizeEmoji(input.emoji ?? undefined),
      targetAmountMinor:
        input.targetAmountMinor === undefined
          ? current.targetAmountMinor
          : normalizeTargetAmount(input.targetAmountMinor ?? undefined),
      state: input.state ?? current.state,
      updatedAt: new Date().toISOString()
    };

    await upsertFinancialGoalRow(db, nextGoal);
    return nextGoal;
  });
}

/**
 * Delete a goal. Transactions are NOT deleted — their assignment is cleared so
 * they return to the unassigned pool.
 */
export async function deleteFinancialGoal(goalId: string): Promise<boolean> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();

    await db.exec("BEGIN");
    try {
      await db.query("UPDATE transactions SET financial_goal_id = NULL WHERE financial_goal_id = $1", [goalId]);
      const result = await db.query<{ id: string }>("DELETE FROM financial_goals WHERE id = $1 RETURNING id", [goalId]);
      await db.exec("COMMIT");
      return result.rows.length > 0;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  });
}

/**
 * Assign (or, with `null`, unassign) a transaction to a goal. The goal id is a
 * user overlay stored on the transaction row itself (Copilot-style).
 */
export async function setTransactionFinancialGoal(
  transactionId: string,
  financialGoalId: string | null
): Promise<Transaction | null> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const existing = await db.query<TransactionRow>("SELECT * FROM transactions WHERE id = $1", [transactionId]);
    const row = existing.rows[0];

    if (!row) {
      return null;
    }

    const nextTransaction: Transaction = {
      ...transactionFromRow(row),
      financialGoalId: financialGoalId ?? undefined
    };

    return upsertTransaction(db, nextTransaction);
  });
}

async function upsertFinancialGoalRow(db: FinanceDb, goal: FinancialGoal): Promise<void> {
  await db.query(
    `INSERT INTO financial_goals (
      id,
      name,
      emoji,
      target_amount_minor,
      state,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      emoji = EXCLUDED.emoji,
      target_amount_minor = EXCLUDED.target_amount_minor,
      state = EXCLUDED.state,
      updated_at = EXCLUDED.updated_at`,
    [
      goal.id,
      goal.name,
      goal.emoji ?? null,
      goal.targetAmountMinor ?? null,
      goal.state,
      goal.createdAt,
      goal.updatedAt
    ]
  );
}

function financialGoalFromRow(row: FinancialGoalRow): FinancialGoal {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji ?? undefined,
    targetAmountMinor: row.target_amount_minor ?? undefined,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function financialGoalStatsFromRow(row: FinancialGoalStatsRow): FinancialGoalWithStats {
  return {
    ...financialGoalFromRow(row),
    savedAmountMinor: Number(row.saved_amount_minor),
    transactionCount: Number(row.transaction_count)
  };
}

function normalizeGoalName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

function normalizeTargetAmount(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  const rounded = Math.round(value);
  return rounded > 0 ? rounded : undefined;
}

export async function listTagStyles(): Promise<TagStyle[]> {
  const db = await getFinanceDb();
  const result = await db.query<TagRegistryRow>("SELECT * FROM tag_registry ORDER BY lower(name), name");
  return result.rows.map(tagStyleFromRow);
}

export async function upsertTagStyle(name: string, color?: string | null): Promise<TagStyle> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const tagName = normalizeTagName(name);

    if (!tagName) {
      throw new Error("Tag name is required.");
    }

    const normalizedColor = color === null ? null : normalizeRegistryColor(color);
    const timestamp = new Date().toISOString();
    const result = await db.query<TagRegistryRow>(
      `INSERT INTO tag_registry (
        name,
        color,
        kind,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $4)
      ON CONFLICT (name) DO UPDATE SET
        color = EXCLUDED.color,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [tagName, normalizedColor ?? null, classifyTagKind(tagName), timestamp]
    );

    return tagStyleFromRow(result.rows[0]);
  });
}

export async function renameTag(oldName: string, newName: string): Promise<TagStyle> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const normalizedOldName = normalizeTagName(oldName);
    const normalizedNewName = normalizeTagName(newName);

    if (!normalizedOldName) {
      throw new Error("Current tag name is required.");
    }
    if (!normalizedNewName) {
      throw new Error("New tag name is required.");
    }

    await db.exec("BEGIN");
    try {
      const oldResult = await db.query<TagRegistryRow>(
        "SELECT * FROM tag_registry WHERE lower(name) = lower($1) ORDER BY name",
        [normalizedOldName]
      );
      const oldRows = oldResult.rows;
      const oldRow = oldRows.find((row) => row.name === normalizedOldName)
        ?? oldRows.find((row) => row.color !== null)
        ?? oldRows[0];

      if (!oldRow) {
        throw new Error(`Tag "${normalizedOldName}" was not found.`);
      }
      if (oldRows.some((row) => row.kind === "source")) {
        throw new Error(`Source tag "${oldRow.name}" cannot be renamed because provider resync would restore it.`);
      }

      const sameCaseInsensitiveName = normalizedOldName.toLowerCase() === normalizedNewName.toLowerCase();
      const targetResult = sameCaseInsensitiveName
        ? oldResult
        : await db.query<TagRegistryRow>(
            "SELECT * FROM tag_registry WHERE lower(name) = lower($1) ORDER BY name",
            [normalizedNewName]
          );
      const targetRow = targetResult.rows.find((row) => row.name === normalizedNewName)
        ?? (!sameCaseInsensitiveName
          ? targetResult.rows.find((row) => row.color !== null) ?? targetResult.rows[0]
          : undefined);
      const timestamp = new Date().toISOString();
      let renamedRow: TagRegistryRow;

      if (targetRow) {
        const sourceRows = oldRows.filter((row) => row.name !== targetRow.name);
        const duplicateTargetRows = sameCaseInsensitiveName
          ? []
          : targetResult.rows.filter((row) => row.name !== targetRow.name);
        const fallbackRows = [...duplicateTargetRows, ...sourceRows];
        const fallbackColor = fallbackRows.find((row) => row.color !== null)?.color ?? null;
        const merged = await db.query<TagRegistryRow>(
          `UPDATE tag_registry
          SET
            color = COALESCE(color, $2),
            updated_at = $3
          WHERE name = $1
          RETURNING *`,
          [targetRow.name, fallbackColor, timestamp]
        );
        renamedRow = merged.rows[0];
        for (const sourceRow of sourceRows) {
          await db.query("DELETE FROM tag_registry WHERE name = $1", [sourceRow.name]);
        }
        for (const duplicateTargetRow of duplicateTargetRows) {
          await db.query("DELETE FROM tag_registry WHERE name = $1", [duplicateTargetRow.name]);
        }
      } else {
        const duplicateRows = oldRows.filter((row) => row.name !== oldRow.name);
        const fallbackColor = oldRows.find((row) => row.color !== null)?.color ?? null;

        for (const duplicateRow of duplicateRows) {
          await db.query("DELETE FROM tag_registry WHERE name = $1", [duplicateRow.name]);
        }
        const renamed = await db.query<TagRegistryRow>(
          `UPDATE tag_registry
          SET
            name = $2,
            color = COALESCE(color, $3),
            updated_at = $4
          WHERE name = $1
          RETURNING *`,
          [oldRow.name, normalizedNewName, fallbackColor, timestamp]
        );
        renamedRow = renamed.rows[0];
      }

      const replacementName = renamedRow.name;
      const transactionRows = await db.query<Pick<TransactionRow, "id" | "tags">>(
        "SELECT id, tags FROM transactions"
      );

      for (const transactionRow of transactionRows.rows) {
        const currentTags = parseTags(transactionRow.tags);
        if (!currentTags.some((tag) => tag.toLowerCase() === normalizedOldName.toLowerCase())) {
          continue;
        }

        const nextTags = replaceTagName(currentTags, normalizedOldName, replacementName);
        await db.query("UPDATE transactions SET tags = $2 WHERE id = $1", [
          transactionRow.id,
          JSON.stringify(nextTags)
        ]);
        await refreshTransactionSemanticDocument(db, transactionRow.id);
      }

      await db.exec("COMMIT");
      return tagStyleFromRow(renamedRow);
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  });
}

async function replaceLedgerInDbNow(ledger: Ledger): Promise<void> {
  const normalizedLedger = normalizeLedgerAmounts(ledger).ledger;
  const db = await getFinanceDb();
  const existingOverlays = await readTransactionOverlays(db);

  await db.exec("BEGIN");
  try {
    // Full-ledger replace: clear only the providers represented by the incoming
    // snapshot. Provider-specific lanes not owned by this ledger remain intact.
    const replacedProviders = [...new Set(normalizedLedger.providerConnections.map((connection) => connection.provider))];
    if (replacedProviders.length > 0) {
      const placeholders = replacedProviders.map((_, index) => `$${index + 1}`).join(", ");
      await db.query(`DELETE FROM provider_connections WHERE provider IN (${placeholders})`, replacedProviders);
    }
    await db.query("DELETE FROM sync_run_items WHERE sync_run_id IN (SELECT id FROM sync_runs WHERE provider = 'koban')");
    await db.query("DELETE FROM sync_runs WHERE provider = 'koban'");

    await db.query(
      `INSERT INTO sync_runs (
        id,
        provider,
        status,
        started_at,
        finished_at,
        accounts_seen,
        transactions_seen,
        error_count,
        error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        provider = EXCLUDED.provider,
        status = EXCLUDED.status,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        accounts_seen = EXCLUDED.accounts_seen,
        transactions_seen = EXCLUDED.transactions_seen,
        error_count = EXCLUDED.error_count,
        error_message = EXCLUDED.error_message`,
      [
        `sync_${normalizedLedger.lastSyncedAt.replace(/[^0-9a-z]/gi, "")}`,
        "koban",
        normalizedLedger.syncSummary.errors.length > 0 ? "error" : "succeeded",
        normalizedLedger.lastSyncedAt,
        normalizedLedger.lastSyncedAt,
        normalizedLedger.accounts.length,
        normalizedLedger.transactions.length,
        normalizedLedger.syncSummary.errors.length,
        normalizedLedger.syncSummary.errors.join("\n") || null
      ]
    );

    for (const connection of normalizedLedger.providerConnections) {
      await upsertProviderConnection(db, connection);
    }

    for (const account of normalizedLedger.accounts) {
      await upsertAccount(db, account);
    }

    for (const snapshot of createLedgerBalanceSnapshots(normalizedLedger)) {
      await db.query(
        `INSERT INTO account_balance_snapshots (
          id,
          account_id,
          as_of_date,
          captured_at,
          ledger_balance_minor,
          available_balance_minor,
          currency,
          source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          ledger_balance_minor = EXCLUDED.ledger_balance_minor,
          available_balance_minor = EXCLUDED.available_balance_minor,
          captured_at = EXCLUDED.captured_at`,
        [
          snapshot.id,
          snapshot.accountId,
          snapshot.asOfDate,
          snapshot.capturedAt,
          moneyToMinor(snapshot.ledgerBalance),
          snapshot.availableBalance === undefined ? null : moneyToMinor(snapshot.availableBalance),
          snapshot.currency,
          snapshot.source
        ]
      );
    }

    for (const transaction of normalizedLedger.transactions) {
      const overlay = existingOverlays.get(transaction.id);
      await upsertTransaction(db, mergeTransactionOverlay(transaction, overlay));
    }

    await clearDanglingTransactionPairs(db);
    await applyTransactionRulesNow(db);
    await replaceTransactionSemanticDocuments(db, normalizedLedger);

    await writeSyncState(db, {
      last_synced_at: normalizedLedger.lastSyncedAt,
      sync_start_date: normalizedLedger.syncStartDate,
      enrollment_count: String(normalizedLedger.enrollmentCount),
      account_count: String(normalizedLedger.accounts.length),
      transaction_count: String(normalizedLedger.transactions.length),
      error_count: String(normalizedLedger.syncSummary.errors.length),
      amount_sign_convention: normalizedLedger.normalization.amountSignConvention
    });

    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

async function replaceSnapTradeInvestmentSnapshotNow(
  input: SnapTradeInvestmentSnapshotInput
): Promise<SnapTradeInvestmentSnapshotRecord> {
  const db = await getFinanceDb();
  const connectionIds = input.providerConnections.map((connection) => connection.id);
  const accountIds = input.accounts.map((account) => account.id);
  const successfulConnectionIds = [...new Set(input.successfulProviderConnectionIds)];
  const positionAccountIds = [...new Set(input.positionAccountIds)];

  await db.exec("BEGIN");
  try {
    if (connectionIds.length === 0) {
      await db.query("DELETE FROM provider_connections WHERE provider = 'snaptrade'");
    } else {
      await db.query("DELETE FROM provider_connections WHERE provider = 'snaptrade' AND NOT (id = ANY($1))", [
        connectionIds
      ]);
    }

    await db.query(
      `INSERT INTO sync_runs (
        id,
        provider,
        status,
        started_at,
        finished_at,
        accounts_seen,
        transactions_seen,
        error_count,
        error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        provider = EXCLUDED.provider,
        status = EXCLUDED.status,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        accounts_seen = EXCLUDED.accounts_seen,
        error_count = EXCLUDED.error_count,
        error_message = EXCLUDED.error_message`,
      [
        `sync_snaptrade_${input.finishedAt.replace(/[^0-9a-z]/gi, "")}`,
        "snaptrade",
        input.errors.length > 0 ? "error" : "succeeded",
        input.startedAt,
        input.finishedAt,
        input.accounts.length,
        input.errors.length,
        input.errors.join("\n") || null
      ]
    );

    for (const connection of input.providerConnections) {
      await upsertProviderConnection(db, connection);
    }

    if (successfulConnectionIds.length > 0) {
      if (accountIds.length > 0) {
        await db.query(
          `DELETE FROM accounts
          WHERE provider_connection_id = ANY($1)
            AND NOT (id = ANY($2))`,
          [successfulConnectionIds, accountIds]
        );
      } else {
        await db.query("DELETE FROM accounts WHERE provider_connection_id = ANY($1)", [successfulConnectionIds]);
      }
    }

    for (const account of input.accounts) {
      await upsertAccount(db, account);
    }

    for (const snapshot of input.balanceSnapshots) {
      await db.query(
        `INSERT INTO account_balance_snapshots (
          id,
          account_id,
          as_of_date,
          captured_at,
          ledger_balance_minor,
          available_balance_minor,
          currency,
          source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          ledger_balance_minor = EXCLUDED.ledger_balance_minor,
          available_balance_minor = EXCLUDED.available_balance_minor,
          captured_at = EXCLUDED.captured_at`,
        [
          snapshot.id,
          snapshot.accountId,
          snapshot.asOfDate,
          snapshot.capturedAt,
          moneyToMinor(snapshot.ledgerBalance),
          snapshot.availableBalance === undefined ? null : moneyToMinor(snapshot.availableBalance),
          snapshot.currency,
          snapshot.source
        ]
      );
    }

    if (positionAccountIds.length > 0) {
      await db.query("DELETE FROM investment_positions WHERE account_id = ANY($1)", [positionAccountIds]);
    }

    for (const position of input.positions) {
      await upsertInvestmentPosition(db, position);
    }

    await writeSyncState(db, {
      snaptrade_last_synced_at: input.finishedAt,
      snaptrade_connection_count: String(input.providerConnections.length),
      snaptrade_account_count: String(input.accounts.length),
      snaptrade_position_count: String(input.positions.length),
      snaptrade_error_count: String(input.errors.length)
    });

    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  return {
    accountCount: input.accounts.length,
    connectionCount: input.providerConnections.length,
    errorCount: input.errors.length,
    lastSyncedAt: input.finishedAt,
    positionCount: input.positions.length
  };
}

async function upsertAccountBalanceSnapshotsNow(snapshots: AccountBalanceSnapshot[]): Promise<number> {
  const db = await getFinanceDb();
  const knownAccountIds = new Set(
    (await db.query<{ id: string }>("SELECT id FROM accounts")).rows.map((row) => row.id)
  );

  await db.exec("BEGIN");
  try {
    let written = 0;

    for (const snapshot of snapshots) {
      if (!knownAccountIds.has(snapshot.accountId)) {
        continue;
      }

      await db.query(
        `INSERT INTO account_balance_snapshots (
          id,
          account_id,
          as_of_date,
          captured_at,
          ledger_balance_minor,
          available_balance_minor,
          currency,
          source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          as_of_date = EXCLUDED.as_of_date,
          captured_at = EXCLUDED.captured_at,
          ledger_balance_minor = EXCLUDED.ledger_balance_minor,
          available_balance_minor = EXCLUDED.available_balance_minor,
          currency = EXCLUDED.currency,
          source = EXCLUDED.source`,
        [
          snapshot.id,
          snapshot.accountId,
          snapshot.asOfDate,
          snapshot.capturedAt,
          moneyToMinor(snapshot.ledgerBalance),
          snapshot.availableBalance === undefined ? null : moneyToMinor(snapshot.availableBalance),
          snapshot.currency,
          snapshot.source
        ]
      );
      written++;
    }

    await db.exec("COMMIT");
    return written;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

async function replacePlaidLedgerSnapshotNow(input: PlaidLedgerSnapshotInput): Promise<PlaidLedgerSnapshotRecord> {
  const db = await getFinanceDb();
  const existingOverlays = await readTransactionOverlays(db);
  const removedTransactionIds = [...new Set(input.removedTransactionIds)];
  const erroredConnectionIds = input.providerConnections
    .filter((connection) => connection.status === "error")
    .map((connection) => connection.id);

  await db.exec("BEGIN");
  try {
    await db.query(
      `INSERT INTO sync_runs (
        id,
        provider,
        status,
        started_at,
        finished_at,
        accounts_seen,
        transactions_seen,
        error_count,
        error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        provider = EXCLUDED.provider,
        status = EXCLUDED.status,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        accounts_seen = EXCLUDED.accounts_seen,
        transactions_seen = EXCLUDED.transactions_seen,
        error_count = EXCLUDED.error_count,
        error_message = EXCLUDED.error_message`,
      [
        `sync_plaid_${input.finishedAt.replace(/[^0-9a-z]/gi, "")}`,
        "plaid",
        input.errors.length > 0 ? "error" : "succeeded",
        input.startedAt,
        input.finishedAt,
        input.accounts.length,
        input.transactions.length,
        input.errors.length,
        input.errors.join("\n") || null
      ]
    );

    for (const connection of input.providerConnections) {
      await upsertProviderConnection(db, connection);
    }

    for (const account of input.accounts) {
      await upsertAccount(db, account);
    }

    if (erroredConnectionIds.length > 0) {
      await db.query("UPDATE accounts SET included_in_net_worth = FALSE WHERE provider_connection_id = ANY($1)", [
        erroredConnectionIds
      ]);
    }

    for (const snapshot of input.balanceSnapshots) {
      await db.query(
        `INSERT INTO account_balance_snapshots (
          id,
          account_id,
          as_of_date,
          captured_at,
          ledger_balance_minor,
          available_balance_minor,
          currency,
          source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          ledger_balance_minor = EXCLUDED.ledger_balance_minor,
          available_balance_minor = EXCLUDED.available_balance_minor,
          captured_at = EXCLUDED.captured_at`,
        [
          snapshot.id,
          snapshot.accountId,
          snapshot.asOfDate,
          snapshot.capturedAt,
          moneyToMinor(snapshot.ledgerBalance),
          snapshot.availableBalance === undefined ? null : moneyToMinor(snapshot.availableBalance),
          snapshot.currency,
          snapshot.source
        ]
      );
    }

    if (removedTransactionIds.length > 0) {
      await db.query("DELETE FROM transactions WHERE id = ANY($1)", [removedTransactionIds]);
    }

    for (const transaction of input.transactions) {
      const pendingOverlay = transaction.pendingTransactionId
        ? existingOverlays.get(transaction.pendingTransactionId)
        : undefined;
      const overlay = existingOverlays.get(transaction.id) ?? pendingOverlay;

      if (transaction.pendingTransactionId && transaction.pendingTransactionId !== transaction.id) {
        await db.query("DELETE FROM transactions WHERE id = $1", [transaction.pendingTransactionId]);
      }

      await upsertTransaction(db, mergeTransactionOverlay(transaction, overlay));
    }

    await clearDanglingTransactionPairs(db);
    await applyTransactionRulesNow(db);
    await replaceTransactionSemanticDocuments(db, {
      source: "koban",
      version: 1,
      lastSyncedAt: input.finishedAt,
      syncStartDate: input.startedAt.slice(0, 10),
      enrollmentCount: input.providerConnections.length,
      accounts: input.accounts,
      transactions: input.transactions,
      providerConnections: input.providerConnections,
      syncSummary: {
        accountCount: input.accounts.length,
        transactionCount: input.transactions.length,
        errors: input.errors
      }
    });

    await writeSyncState(db, {
      plaid_last_synced_at: input.finishedAt,
      plaid_connection_count: String(input.providerConnections.length),
      plaid_account_count: String(input.accounts.length),
      plaid_transaction_count: String(input.transactions.length),
      plaid_removed_transaction_count: String(removedTransactionIds.length),
      plaid_error_count: String(input.errors.length),
      ...input.syncState
    });

    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  return {
    accountCount: input.accounts.length,
    connectionCount: input.providerConnections.length,
    errorCount: input.errors.length,
    lastSyncedAt: input.finishedAt,
    removedTransactionCount: removedTransactionIds.length,
    transactionCount: input.transactions.length
  };
}

async function replaceSimpleFinLedgerSnapshotNow(
  input: SimpleFinLedgerSnapshotInput
): Promise<SimpleFinLedgerSnapshotRecord> {
  const db = await getFinanceDb();
  const existingOverlays = await readTransactionOverlays(db);
  const connectionIds = input.providerConnections.map((connection) => connection.id);
  const accountIds = input.accounts.map((account) => account.id);

  await db.exec("BEGIN");
  try {
    if (input.successful) {
      if (connectionIds.length === 0) {
        await db.query("DELETE FROM provider_connections WHERE provider = 'simplefin'");
      } else {
        await db.query("DELETE FROM provider_connections WHERE provider = 'simplefin' AND NOT (id = ANY($1))", [
          connectionIds
        ]);
      }
    }

    await db.query(
      `INSERT INTO sync_runs (
        id,
        provider,
        status,
        started_at,
        finished_at,
        accounts_seen,
        transactions_seen,
        error_count,
        error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        provider = EXCLUDED.provider,
        status = EXCLUDED.status,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        accounts_seen = EXCLUDED.accounts_seen,
        transactions_seen = EXCLUDED.transactions_seen,
        error_count = EXCLUDED.error_count,
        error_message = EXCLUDED.error_message`,
      [
        `sync_simplefin_${input.finishedAt.replace(/[^0-9a-z]/gi, "")}`,
        "simplefin",
        input.errors.length > 0 ? "error" : "succeeded",
        input.startedAt,
        input.finishedAt,
        input.accounts.length,
        input.transactions.length,
        input.errors.length,
        simpleFinErrorsToMessage(input.errors)
      ]
    );

    for (const connection of input.providerConnections) {
      await upsertProviderConnection(db, connection);
    }

    if (input.successful && connectionIds.length > 0) {
      if (accountIds.length > 0) {
        await db.query(
          `DELETE FROM accounts
          WHERE provider_connection_id = ANY($1)
            AND NOT (id = ANY($2))`,
          [connectionIds, accountIds]
        );
      } else {
        await db.query("DELETE FROM accounts WHERE provider_connection_id = ANY($1)", [connectionIds]);
      }
    }

    for (const account of input.accounts) {
      await upsertAccount(db, account);
    }

    for (const snapshot of input.balanceSnapshots) {
      await db.query(
        `INSERT INTO account_balance_snapshots (
          id,
          account_id,
          as_of_date,
          captured_at,
          ledger_balance_minor,
          available_balance_minor,
          currency,
          source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          ledger_balance_minor = EXCLUDED.ledger_balance_minor,
          available_balance_minor = EXCLUDED.available_balance_minor,
          captured_at = EXCLUDED.captured_at`,
        [
          snapshot.id,
          snapshot.accountId,
          snapshot.asOfDate,
          snapshot.capturedAt,
          moneyToMinor(snapshot.ledgerBalance),
          snapshot.availableBalance === undefined ? null : moneyToMinor(snapshot.availableBalance),
          snapshot.currency,
          snapshot.source
        ]
      );
    }

    for (const transaction of input.transactions) {
      const overlay = existingOverlays.get(transaction.id);
      await upsertTransaction(db, mergeTransactionOverlay(transaction, overlay));
    }

    await clearDanglingTransactionPairs(db);
    await applyTransactionRulesNow(db);
    await replaceTransactionSemanticDocuments(db, {
      source: "koban",
      version: 1,
      lastSyncedAt: input.finishedAt,
      syncStartDate: new Date(input.requestStartUnix * 1000).toISOString().slice(0, 10),
      enrollmentCount: input.providerConnections.length,
      accounts: input.accounts,
      transactions: input.transactions,
      providerConnections: input.providerConnections,
      syncSummary: {
        accountCount: input.accounts.length,
        transactionCount: input.transactions.length,
        errors: []
      }
    });

    const state: Record<string, string> = {
      simplefin_last_synced_at: input.finishedAt,
      simplefin_request_start_unix: String(input.requestStartUnix),
      simplefin_request_end_unix: String(input.requestEndUnix),
      simplefin_connection_count: String(input.providerConnections.length),
      simplefin_account_count: String(input.accounts.length),
      simplefin_transaction_count: String(input.transactions.length),
      simplefin_error_count: String(input.errors.length),
      simplefin_last_errors: JSON.stringify(input.errors)
    };

    if (input.successful && input.newestPostedAt !== undefined) {
      state.simplefin_newest_posted_at = String(input.newestPostedAt);
      state.simplefin_last_successful_synced_at = input.finishedAt;
    }

    await writeSyncState(db, state);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  return {
    accountCount: input.accounts.length,
    connectionCount: input.providerConnections.length,
    errorCount: input.errors.length,
    lastSyncedAt: input.finishedAt,
    newestPostedAt: input.newestPostedAt,
    transactionCount: input.transactions.length
  };
}

async function ingestFinanceKitLedgerSnapshotNow(
  input: FinanceKitLedgerSnapshotInput
): Promise<FinanceKitLedgerSnapshotRecord> {
  const db = await getFinanceDb();
  const existingOverlays = await readTransactionOverlays(db);
  const existingTransactions = await readTransactionsByIds(db, input.transactions.map((transaction) => transaction.id));
  let transactionsAdded = 0;
  let transactionsUpdated = 0;
  let transactionsUnchanged = 0;

  await db.exec("BEGIN");
  try {
    await db.query(
      `INSERT INTO sync_runs (
        id,
        provider,
        status,
        started_at,
        finished_at,
        accounts_seen,
        transactions_seen,
        error_count,
        error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, NULL)
      ON CONFLICT (id) DO UPDATE SET
        provider = EXCLUDED.provider,
        status = EXCLUDED.status,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        accounts_seen = EXCLUDED.accounts_seen,
        transactions_seen = EXCLUDED.transactions_seen,
        error_count = EXCLUDED.error_count,
        error_message = EXCLUDED.error_message`,
      [
        `sync_financekit_${input.finishedAt.replace(/[^0-9a-z]/gi, "")}`,
        "financekit",
        "succeeded",
        input.startedAt,
        input.finishedAt,
        input.accounts.length,
        input.transactions.length
      ]
    );

    await upsertProviderConnection(db, input.providerConnection);

    for (const account of input.accounts) {
      await upsertAccount(db, account);
    }

    for (const snapshot of input.balanceSnapshots) {
      await db.query(
        `INSERT INTO account_balance_snapshots (
          id,
          account_id,
          as_of_date,
          captured_at,
          ledger_balance_minor,
          available_balance_minor,
          currency,
          source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          ledger_balance_minor = EXCLUDED.ledger_balance_minor,
          available_balance_minor = EXCLUDED.available_balance_minor,
          captured_at = EXCLUDED.captured_at`,
        [
          snapshot.id,
          snapshot.accountId,
          snapshot.asOfDate,
          snapshot.capturedAt,
          moneyToMinor(snapshot.ledgerBalance),
          snapshot.availableBalance === undefined ? null : moneyToMinor(snapshot.availableBalance),
          snapshot.currency,
          snapshot.source
        ]
      );
    }

    for (const transaction of input.transactions) {
      const nextTransaction = mergeTransactionOverlay(transaction, existingOverlays.get(transaction.id));
      const existingTransaction = existingTransactions.get(transaction.id);

      if (!existingTransaction) {
        transactionsAdded += 1;
      } else if (transactionsEqual(existingTransaction, nextTransaction)) {
        transactionsUnchanged += 1;
      } else {
        transactionsUpdated += 1;
      }

      await upsertTransaction(db, nextTransaction);
    }

    await clearDanglingTransactionPairs(db);
    await applyTransactionRulesNow(db);
    await replaceTransactionSemanticDocuments(db, {
      source: "koban",
      version: 1,
      lastSyncedAt: input.finishedAt,
      syncStartDate: input.startedAt.slice(0, 10),
      enrollmentCount: 1,
      accounts: input.accounts,
      transactions: input.transactions,
      providerConnections: [input.providerConnection],
      syncSummary: {
        accountCount: input.accounts.length,
        transactionCount: input.transactions.length,
        errors: []
      }
    });

    await writeSyncState(db, {
      financekit_account_count: String(input.accounts.length),
      financekit_device_name: input.deviceName ?? "",
      financekit_last_ingested_at: input.finishedAt,
      financekit_transaction_count: String(input.transactions.length),
      financekit_transactions_added: String(transactionsAdded),
      financekit_transactions_unchanged: String(transactionsUnchanged),
      financekit_transactions_updated: String(transactionsUpdated)
    });

    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  return {
    accountsUpserted: input.accounts.length,
    lastIngestedAt: input.finishedAt,
    transactionsAdded,
    transactionsUnchanged,
    transactionsUpdated
  };
}

export async function readFinanceDbSnapshot(): Promise<Ledger | null> {
  if (!financeDbExists()) {
    return null;
  }

  const db = await getFinanceDb();
  const [providerConnections, accounts, balanceSnapshots, transactions, syncState] = await Promise.all([
    db.query<ProviderConnectionRow>("SELECT * FROM provider_connections ORDER BY display_name, id"),
    db.query<AccountRow>("SELECT * FROM accounts ORDER BY institution_name, name, id"),
    db.query<AccountBalanceSnapshotRow>("SELECT * FROM account_balance_snapshots ORDER BY captured_at DESC, id"),
    db.query<TransactionRow>("SELECT * FROM transactions ORDER BY date DESC, id DESC"),
    db.query<SyncStateRow>("SELECT key, value FROM sync_state")
  ]);

  if (providerConnections.rows.length === 0 && accounts.rows.length === 0 && transactions.rows.length === 0) {
    return null;
  }

  const state = new Map(syncState.rows.map((row) => [row.key, row.value]));
  const lastSyncedAt = state.get("last_synced_at") ?? new Date(0).toISOString();

  return {
    source: "koban",
    version: 1,
    lastSyncedAt,
    syncStartDate: state.get("sync_start_date") ?? "",
    enrollmentCount: Number.parseInt(state.get("enrollment_count") ?? "0", 10),
    accounts: accounts.rows.map(accountFromRow),
    balanceSnapshots: balanceSnapshots.rows.map(accountBalanceSnapshotFromRow),
    transactions: transactions.rows.map(transactionFromRow),
    providerConnections: providerConnections.rows.map(providerConnectionFromRow),
    normalization:
      state.get("amount_sign_convention") === internalAmountSignConvention
        ? { amountSignConvention: internalAmountSignConvention }
        : undefined,
    syncSummary: {
      accountCount: Number.parseInt(state.get("account_count") ?? String(accounts.rows.length), 10),
      transactionCount: Number.parseInt(state.get("transaction_count") ?? String(transactions.rows.length), 10),
      errors: []
    }
  };
}

// ponytail: light shell read — accounts + counts only, no transaction rows, no semantic upkeep.
export async function readShellSnapshot(): Promise<{
  accounts: Account[];
  lastSyncedAt: string;
  reviewActionableCount: number;
  transactionCount: number;
} | null> {
  if (!financeDbExists()) {
    return null;
  }

  const db = await getFinanceDb();
  const [accounts, transactionCount, reviewActionableCount, syncState] = await Promise.all([
    db.query<AccountRow>("SELECT * FROM accounts ORDER BY institution_name, name, id"),
    countRows(db, "transactions"),
    db
      .query<{ count: number }>(`
        SELECT COUNT(*)::int AS count
        FROM transactions
        WHERE reviewed = FALSE
          AND category_id <> 'cat_transfer'
          AND (
            category_id = 'cat_other'
            OR amount_minor < 0
            OR (amount_minor > 0 AND category_id <> 'cat_income')
          )
      `)
      .then((result) => result.rows[0]?.count ?? 0),
    db.query<SyncStateRow>("SELECT key, value FROM sync_state WHERE key = 'last_synced_at'")
  ]);

  if (accounts.rows.length === 0 && transactionCount === 0) {
    return null;
  }

  return {
    accounts: accounts.rows.map(accountFromRow),
    lastSyncedAt: syncState.rows[0]?.value ?? new Date(0).toISOString(),
    reviewActionableCount,
    transactionCount
  };
}

export async function updateDbTransaction(
  transactionId: string,
  update: Partial<Pick<Transaction, "categoryId" | "notes" | "reviewed" | "tags">>
): Promise<Transaction | null> {
  let updatedTransaction: Transaction | null = null;
  await enqueueDbWrite(async () => {
    updatedTransaction = await updateDbTransactionNow(transactionId, update);
  });

  return updatedTransaction;
}

export async function ensureTransactionSemanticDocuments(ledger: Ledger): Promise<void> {
  const normalizedLedger = normalizeLedgerAmounts(ledger).ledger;
  await enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const summary = await getSemanticDocumentSummary();

    if (summary.transactionDocumentCount === normalizedLedger.transactions.length && summary.staleDocumentCount === 0) {
      return;
    }

    await replaceTransactionSemanticDocuments(db, normalizedLedger);
  });
}

async function ensureSourceItemSemanticDocuments(): Promise<void> {
  if (!financeDbExists()) {
    return;
  }

  await enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    await replaceSourceItemSemanticDocuments(db);
  });
}

async function updateDbTransactionNow(
  transactionId: string,
  update: Partial<Pick<Transaction, "categoryId" | "notes" | "reviewed" | "tags">>
): Promise<Transaction | null> {
  if (!financeDbExists()) {
    return null;
  }

  const db = await getFinanceDb();
  const existing = await db.query<TransactionRow>("SELECT * FROM transactions WHERE id = $1", [transactionId]);
  const row = existing.rows[0];

  if (!row) {
    return null;
  }

  const nextTransaction = {
    ...transactionFromRow(row),
    ...update,
    tags: update.tags ? normalizeTags(update.tags) : transactionFromRow(row).tags
  } satisfies Transaction;

  const result = await upsertTransaction(db, nextTransaction);
  const accountResult = await db.query<AccountRow>("SELECT * FROM accounts WHERE id = $1", [result.accountId]);
  const account = accountResult.rows[0] ? accountFromRow(accountResult.rows[0]) : undefined;
  const evidenceSummaries = await readTransactionEvidenceSummaries(db, transactionId);
  await upsertSemanticDocument(db, createTransactionSemanticDocument(result, account, evidenceSummaries));
  invalidateShellDataCache();

  return result;
}

export async function ensureSemanticIndex(): Promise<SemanticIndexRefreshResult> {
  const snapshot = await readFinanceDbSnapshot();

  if (snapshot) {
    await ensureTransactionSemanticDocuments(snapshot);
  }

  await ensureSourceItemSemanticDocuments();

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const modelRefresh = await ensureActiveEmbeddingModel(db);
    const activeModel = modelRefresh.activeModel;
    const documents = await db.query<SemanticDocumentRow>(
      `SELECT d.id, d.body_hash, d.body
      FROM semantic_documents d
      LEFT JOIN semantic_embeddings e
        ON e.document_id = d.id
       AND e.model_id = $1
       AND e.body_hash = d.body_hash
      WHERE e.id IS NULL
      ORDER BY d.updated_at ASC`,
      [activeModel.id]
    );
    const embeddings = await embedTexts(
      documents.rows.map((document) => document.body),
      { inputType: "document", model: activeModel }
    );

    for (const [index, document] of documents.rows.entries()) {
      await db.query("DELETE FROM semantic_embeddings WHERE document_id = $1 AND model_id = $2", [
        document.id,
        activeModel.id
      ]);
      await db.query(
        `INSERT INTO semantic_embeddings (
          id,
          document_id,
          model_id,
          embedding,
          body_hash,
          source,
          created_at
        ) VALUES ($1, $2, $3, $4::vector, $5, $6, $7)
        ON CONFLICT (document_id, model_id, body_hash) DO UPDATE SET
          embedding = EXCLUDED.embedding,
          source = EXCLUDED.source,
          created_at = EXCLUDED.created_at`,
        [
          `emb_${stableIdSuffix(`${document.id}:${activeModel.id}:${document.body_hash}`)}`,
          document.id,
          activeModel.id,
          vectorLiteral(embeddings[index] ?? []),
          document.body_hash,
          activeModel.provider,
          new Date().toISOString()
        ]
      );
    }

    return {
      ...modelRefresh,
      documentsEmbedded: documents.rows.length
    };
  });
}

export async function semanticSearchTransactions(query: string, limit = 12): Promise<SemanticSearchResult[]> {
  return semanticSearch(query, limit, ["transaction"]);
}

export async function semanticSearchFinanceResources(query: string, limit = 12): Promise<SemanticSearchResult[]> {
  return semanticSearch(query, limit, ["transaction", "source_item"]);
}

async function semanticSearch(
  query: string,
  limit: number,
  resourceTypes: Array<SemanticSearchResult["resourceType"]>
): Promise<SemanticSearchResult[]> {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length === 0 || resourceTypes.length === 0) {
    return [];
  }

  const indexRefresh = await ensureSemanticIndex();
  const queryEmbedding = (await embedTexts([trimmedQuery], {
    inputType: "query",
    model: indexRefresh.activeModel
  }))[0];

  const db = await getFinanceDb();
  const result = await db.query<SemanticResourceSearchRow>(
    `SELECT
      d.resource_type,
      d.resource_id,
      d.title,
      d.body,
      (e.embedding <=> $1::vector)::float8 AS distance
    FROM semantic_embeddings e
    JOIN semantic_documents d ON d.id = e.document_id
    WHERE e.model_id = $2
      AND d.resource_type = ANY($3::text[])
    ORDER BY e.embedding <=> $1::vector, d.updated_at DESC
    LIMIT $4`,
    [vectorLiteral(queryEmbedding), indexRefresh.activeModel.id, resourceTypes, boundedInteger(limit, 12, 50)]
  );
  const transactionIds = result.rows
    .filter((row) => row.resource_type === "transaction")
    .map((row) => row.resource_id);
  const sourceItemIds = result.rows
    .filter((row) => row.resource_type === "source_item")
    .map((row) => row.resource_id);
  const [transactionRows, sourceItemRows] = await Promise.all([
    transactionIds.length > 0
      ? db.query<TransactionRow>("SELECT * FROM transactions WHERE id = ANY($1)", [transactionIds])
      : Promise.resolve({ rows: [] as TransactionRow[] }),
    sourceItemIds.length > 0
      ? db.query<SourceItemRow>(
          `SELECT
            id,
            source_id,
            external_id,
            kind,
            occurred_at,
            title,
            summary,
            merchant_name,
            amount_minor,
            currency
          FROM source_items
          WHERE id = ANY($1)`,
          [sourceItemIds]
        )
      : Promise.resolve({ rows: [] as SourceItemRow[] })
  ]);
  const transactionById = new Map(transactionRows.rows.map((row) => [row.id, transactionFromRow(row)]));
  const sourceItemById = new Map(sourceItemRows.rows.map((row) => [row.id, sourceItemFromRow(row)]));

  return result.rows.map((row) => {
    const distance = Number(row.distance);
    return {
      body: row.body,
      distance,
      resourceId: row.resource_id,
      resourceType: row.resource_type,
      score: Math.max(0, 1 - distance),
      sourceItem: row.resource_type === "source_item" ? sourceItemById.get(row.resource_id) : undefined,
      title: row.title,
      transaction: row.resource_type === "transaction" ? transactionById.get(row.resource_id) : undefined
    };
  });
}

export async function getFinanceDbSummary() {
  if (!financeDbExists()) {
    return {
      lastSyncedAt: undefined,
      storedAccountCount: 0,
      storedTransactionCount: 0
    };
  }

  const db = await getFinanceDb();
  const [accountCount, transactionCount, syncState] = await Promise.all([
    countRows(db, "accounts"),
    countRows(db, "transactions"),
    db.query<SyncStateRow>("SELECT key, value FROM sync_state WHERE key = 'last_synced_at'")
  ]);

  return {
    lastSyncedAt: syncState.rows[0]?.value,
    storedAccountCount: accountCount,
    storedTransactionCount: transactionCount
  };
}

async function readLocalAppDataResetSummary(db: FinanceDb): Promise<LocalAppDataResetSummary> {
  const [
    accounts,
    appSyncRuns,
    evidenceLinks,
    investmentPositions,
    providerConnections,
    rules,
    schedules,
    semanticDocuments,
    semanticEmbeddings,
    sources,
    sourceItems,
    sourceSyncRuns,
    suggestions,
    syncRuns,
    transactions
  ] = await Promise.all([
    countRows(db, "accounts"),
    countRows(db, "app_sync_runs"),
    countRows(db, "transaction_evidence_links"),
    countRows(db, "investment_positions"),
    countRows(db, "provider_connections"),
    countRows(db, "transaction_rules"),
    countRows(db, "sync_schedules"),
    countRows(db, "semantic_documents"),
    countRows(db, "semantic_embeddings"),
    countRows(db, "external_sources"),
    countRows(db, "source_items"),
    countRows(db, "source_sync_runs"),
    countRows(db, "enrichment_suggestions"),
    countRows(db, "sync_runs"),
    countRows(db, "transactions")
  ]);

  return {
    accountCount: accounts,
    appSyncRunCount: appSyncRuns,
    evidenceLinkCount: evidenceLinks,
    investmentPositionCount: investmentPositions,
    providerConnectionCount: providerConnections,
    ruleCount: rules,
    scheduleCount: schedules,
    semanticDocumentCount: semanticDocuments,
    semanticEmbeddingCount: semanticEmbeddings,
    sourceCount: sources,
    sourceItemCount: sourceItems,
    sourceSyncRunCount: sourceSyncRuns,
    suggestionCount: suggestions,
    syncRunCount: syncRuns,
    transactionCount: transactions
  };
}

async function countRows(db: FinanceDb, table: string): Promise<number> {
  const result = await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return result.rows[0]?.count ?? 0;
}

export async function ensureExternalSourceCatalog(entries: ExternalSourceCatalogEntry[]): Promise<void> {
  await enqueueDbWrite(async () => {
    const db = await getFinanceDb();

    for (const entry of entries) {
      await db.query(
        `INSERT INTO external_sources (
          id,
          kind,
          display_name,
          status,
          configured,
          command
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          kind = EXCLUDED.kind,
          display_name = EXCLUDED.display_name,
          command = EXCLUDED.command`,
        [
          entry.id,
          entry.kind,
          entry.displayName,
          entry.status ?? "not_configured",
          entry.configured ?? false,
          entry.command
        ]
      );
    }
  });
}

export async function getExternalSourceStates(): Promise<Map<string, ExternalSourceState>> {
  if (!financeDbExists()) {
    return new Map();
  }

  const db = await getFinanceDb();
  const rows = await db.query<{
    error_message: string | null;
    id: string;
    last_synced_at: string | null;
    status: ExternalSourceStatus;
  }>("SELECT id, status, last_synced_at, error_message FROM external_sources");

  return new Map(
    rows.rows.map((row) => [
      row.id,
      {
        errorMessage: row.error_message ?? undefined,
        id: row.id,
        lastSyncedAt: row.last_synced_at ?? undefined,
        status: row.status
      }
    ])
  );
}

export async function recordAppSyncRun(input: AppSyncRunInput): Promise<AppSyncRunRecord> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const runId = `app_sync_${stableIdSuffix(`${input.startedAt}:${input.finishedAt}:${input.status}`)}`;

    await db.query(
      `INSERT INTO app_sync_runs (
        id,
        status,
        started_at,
        finished_at,
        financekit_status,
        plaid_status,
        snaptrade_status,
        simplefin_status,
        sources_status,
        enrichment_status,
        financekit_summary,
        plaid_summary,
        snaptrade_summary,
        simplefin_summary,
        sources_summary,
        enrichment_summary,
        error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        finished_at = EXCLUDED.finished_at,
        financekit_status = EXCLUDED.financekit_status,
        plaid_status = EXCLUDED.plaid_status,
        snaptrade_status = EXCLUDED.snaptrade_status,
        simplefin_status = EXCLUDED.simplefin_status,
        sources_status = EXCLUDED.sources_status,
        enrichment_status = EXCLUDED.enrichment_status,
        financekit_summary = EXCLUDED.financekit_summary,
        plaid_summary = EXCLUDED.plaid_summary,
        snaptrade_summary = EXCLUDED.snaptrade_summary,
        simplefin_summary = EXCLUDED.simplefin_summary,
        sources_summary = EXCLUDED.sources_summary,
        enrichment_summary = EXCLUDED.enrichment_summary,
        error_message = EXCLUDED.error_message`,
      [
        runId,
        input.status,
        input.startedAt,
        input.finishedAt,
        input.financekitStatus ?? "succeeded",
        input.plaidStatus ?? "succeeded",
        input.snaptradeStatus ?? "succeeded",
        input.simplefinStatus ?? "succeeded",
        input.sourcesStatus,
        input.enrichmentStatus,
        JSON.stringify(input.financekitSummary ?? { configured: false, skipped: true }),
        JSON.stringify(input.plaidSummary ?? { configured: false, skipped: true }),
        JSON.stringify(input.snaptradeSummary ?? { configured: false, skipped: true }),
        JSON.stringify(input.simplefinSummary ?? { configured: false, skipped: true }),
        JSON.stringify(input.sourcesSummary),
        JSON.stringify(input.enrichmentSummary),
        input.errorMessage ?? null
      ]
    );

    const providerHealth = parseAppSyncLlmProviderHealth(input.enrichmentSummary, input.finishedAt);

    if (providerHealth) {
      await writeLlmProviderHealthSnapshot(db, providerHealth, providerHealth.checkedAt);
    }

    return {
      ...input,
      id: runId
    };
  });
}

export async function getLatestAppSyncRun(): Promise<AppSyncRunRecord | null> {
  if (!financeDbExists()) {
    return null;
  }

  const db = await getFinanceDb();
  const result = await db.query<AppSyncRunRow>(
    `SELECT *
    FROM app_sync_runs
    ORDER BY started_at DESC, finished_at DESC
    LIMIT 1`
  );

  return result.rows[0] ? appSyncRunFromRow(result.rows[0]) : null;
}

export async function listAppSyncRuns(limit = 10): Promise<AppSyncRunRecord[]> {
  if (!financeDbExists()) {
    return [];
  }

  const db = await getFinanceDb();
  const cappedLimit = boundedInteger(limit, 10, 50);
  const result = await db.query<AppSyncRunRow>(
    `SELECT *
    FROM app_sync_runs
    ORDER BY started_at DESC, finished_at DESC
    LIMIT $1`,
    [cappedLimit]
  );

  return result.rows.map(appSyncRunFromRow);
}

export async function ensureAppSyncSchedule(scheduleId: SyncScheduleId = appSyncScheduleId): Promise<SyncScheduleRecord> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const now = new Date().toISOString();
    await ensureAppSyncScheduleInDb(db, now, scheduleId);
    return readAppSyncScheduleInDb(db, scheduleId);
  });
}

export async function claimAppSyncSchedule(
  scheduleId: SyncScheduleId,
  claimedBy: string,
  claimedAt = new Date().toISOString()
): Promise<boolean> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    await ensureAppSyncScheduleInDb(db, claimedAt, scheduleId);
    const staleBefore = new Date(Date.parse(claimedAt) - syncScheduleClaimTtlMs).toISOString();
    const result = await db.query<{ id: string }>(
      `UPDATE sync_schedules
      SET
        claimed_at = $3,
        claimed_by = $2,
        updated_at = $3
      WHERE id = $1
        AND enabled = TRUE
        AND next_run_at IS NOT NULL
        AND next_run_at <= $3
        AND (claimed_at IS NULL OR claimed_at < $4)
      RETURNING id`,
      [scheduleId, claimedBy, claimedAt, staleBefore]
    );

    return result.rows.length === 1;
  });
}

export async function claimAppSyncScheduleForRunNow(
  scheduleId: SyncScheduleId,
  claimedBy: string,
  claimedAt = new Date().toISOString()
): Promise<boolean> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    await ensureAppSyncScheduleInDb(db, claimedAt, scheduleId);
    const staleBefore = new Date(Date.parse(claimedAt) - syncScheduleClaimTtlMs).toISOString();
    const result = await db.query<{ id: string }>(
      `UPDATE sync_schedules
      SET
        claimed_at = $3,
        claimed_by = $2,
        updated_at = $3
      WHERE id = $1
        AND (claimed_at IS NULL OR claimed_at < $4)
      RETURNING id`,
      [scheduleId, claimedBy, claimedAt, staleBefore]
    );

    return result.rows.length === 1;
  });
}

export async function clearAppSyncScheduleClaim(
  scheduleId: SyncScheduleId,
  claimedBy: string,
  clearedAt = new Date().toISOString()
): Promise<boolean> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const result = await db.query<{ id: string }>(
      `UPDATE sync_schedules
      SET
        claimed_at = NULL,
        claimed_by = NULL,
        updated_at = $3
      WHERE id = $1
        AND claimed_by = $2
      RETURNING id`,
      [scheduleId, claimedBy, clearedAt]
    );

    return result.rows.length === 1;
  });
}

export async function refreshAppSyncScheduleClaim(
  scheduleId: SyncScheduleId,
  claimedBy: string,
  refreshedAt = new Date().toISOString()
): Promise<boolean> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const result = await db.query<{ id: string }>(
      `UPDATE sync_schedules
      SET
        claimed_at = $3,
        updated_at = $3
      WHERE id = $1
        AND claimed_by = $2
      RETURNING id`,
      [scheduleId, claimedBy, refreshedAt]
    );

    return result.rows.length === 1;
  });
}

export async function updateAppSyncSchedule(
  input: SyncScheduleUpdateInput,
  scheduleId: SyncScheduleId = appSyncScheduleId
): Promise<SyncScheduleRecord> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const now = new Date().toISOString();
    await ensureAppSyncScheduleInDb(db, now, scheduleId);
    const current = await readAppSyncScheduleInDb(db, scheduleId);
    const enabled = input.enabled ?? current.enabled;
    const intervalMinutes = normalizeSyncIntervalMinutes(input.intervalMinutes ?? current.intervalMinutes);
    const nextRunAt =
      input.nextRunAt !== undefined
        ? input.nextRunAt
        : enabled
          ? current.enabled
            ? current.nextRunAt ?? now
            : now
          : null;

    await db.query(
      `UPDATE sync_schedules
      SET
        enabled = $2,
        interval_minutes = $3,
        next_run_at = $4,
        updated_at = $5
      WHERE id = $1`,
      [scheduleId, enabled, intervalMinutes, nextRunAt, now]
    );

    return readAppSyncScheduleInDb(db, scheduleId);
  });
}

export async function recordAppSyncScheduleRun(
  run: AppSyncRunRecord,
  scheduleId: SyncScheduleId,
  claimedBy: string
): Promise<SyncScheduleRecord> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const now = new Date().toISOString();
    await ensureAppSyncScheduleInDb(db, now, scheduleId);
    const current = await readAppSyncScheduleInDb(db, scheduleId);
    const nextRunAt = current.enabled ? addMinutesIso(run.finishedAt, current.intervalMinutes) : null;

    const result = await db.query<{ id: string }>(
      `UPDATE sync_schedules
      SET
        next_run_at = $2,
        last_started_at = $3,
        last_finished_at = $4,
        last_run_id = $5,
        last_status = $6,
        last_error_message = $7,
        claimed_at = NULL,
        claimed_by = NULL,
        updated_at = $8
      WHERE id = $1
        AND claimed_by = $9
      RETURNING id`,
      [
        scheduleId,
        nextRunAt,
        run.startedAt,
        run.finishedAt,
        run.id,
        run.status,
        run.errorMessage ?? null,
        now,
        claimedBy
      ]
    );

    if (result.rows.length !== 1) {
      throw new Error(`Sync schedule ${scheduleId} claim is no longer owned by ${claimedBy}.`);
    }

    return readAppSyncScheduleInDb(db, scheduleId);
  });
}

export async function recordSourceSyncRun(input: SourceSyncRunInput): Promise<SourceSyncRunRecord> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const runId = `source_sync_${stableIdSuffix(`${input.sourceId}:${input.startedAt}:${input.finishedAt}`)}`;

    await db.exec("BEGIN");
    try {
      let itemsWritten = 0;
      const sourceItemIds: string[] = [];

      for (const item of input.items) {
        await upsertSourceItem(db, item);
        await upsertSemanticDocument(db, createSourceItemSemanticDocument(item));
        itemsWritten += 1;
        sourceItemIds.push(item.id);
      }

      const evidenceLinksSuggested =
        input.runStatus !== "error" && sourceItemIds.length > 0
          ? await matchSourceItemsToTransactionsNow(db, sourceItemIds)
          : 0;

      await db.query(
        `INSERT INTO source_sync_runs (
          id,
          source_id,
          status,
          started_at,
          finished_at,
          items_seen,
          items_written,
          error_count,
          error_message
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          finished_at = EXCLUDED.finished_at,
          items_seen = EXCLUDED.items_seen,
          items_written = EXCLUDED.items_written,
          error_count = EXCLUDED.error_count,
          error_message = EXCLUDED.error_message`,
        [
          runId,
          input.sourceId,
          input.runStatus,
          input.startedAt,
          input.finishedAt,
          input.items.length,
          itemsWritten,
          input.runStatus === "succeeded" ? 0 : 1,
          input.errorMessage ?? null
        ]
      );

      await db.query(
        `UPDATE external_sources
        SET
          status = $2,
          last_synced_at = $3,
          error_message = $4
        WHERE id = $1`,
        [input.sourceId, input.sourceStatus, input.finishedAt, input.errorMessage ?? null]
      );

      await db.exec("COMMIT");

      return {
        errorMessage: input.errorMessage,
        evidenceLinksSuggested,
        id: runId,
        itemsSeen: input.items.length,
        itemsWritten,
        runStatus: input.runStatus,
        sourceId: input.sourceId,
        sourceStatus: input.sourceStatus
      };
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  });
}

export async function refreshSourceEvidenceMatches(): Promise<SourceEvidenceRefreshResult> {
  if (!financeDbExists()) {
    return {
      evidenceLinksSuggested: 0,
      sourceItemCount: 0
    };
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const result = await db.query<{ id: string }>(
      "SELECT id FROM source_items ORDER BY updated_at DESC, id DESC"
    );
    const sourceItemIds = result.rows.map((row) => row.id);

    return {
      evidenceLinksSuggested: await matchSourceItemsToTransactionsNow(db, sourceItemIds),
      sourceItemCount: sourceItemIds.length
    };
  });
}

export async function getSourceStoreSummary(): Promise<SourceStoreSummary> {
  if (!financeDbExists()) {
    return {
      evidenceLinkCount: 0,
      externalSourceCount: 0,
      sourceItemCount: 0
    };
  }

  const db = await getFinanceDb();
  const [externalSources, sourceItems, evidenceLinks] = await Promise.all([
    db.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM external_sources"),
    db.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM source_items"),
    db.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM transaction_evidence_links")
  ]);

  return {
    evidenceLinkCount: evidenceLinks.rows[0]?.count ?? 0,
    externalSourceCount: externalSources.rows[0]?.count ?? 0,
    sourceItemCount: sourceItems.rows[0]?.count ?? 0
  };
}

export async function getSourceStoreSourceSummaries(): Promise<Map<string, SourceStoreSourceSummary>> {
  if (!financeDbExists()) {
    return new Map();
  }

  const db = await getFinanceDb();
  const [sourceItems, evidenceLinks] = await Promise.all([
    db.query<{
      last_imported_at: string | null;
      latest_occurred_at: string | null;
      source_id: string;
      source_item_count: number;
    }>(`
      SELECT
        e.id AS source_id,
        COUNT(s.id)::int AS source_item_count,
        MAX(s.updated_at) AS last_imported_at,
        MAX(s.occurred_at) AS latest_occurred_at
      FROM external_sources e
      LEFT JOIN source_items s ON s.source_id = e.id
      GROUP BY e.id
    `),
    db.query<{
      evidence_link_count: number;
      source_id: string;
    }>(`
      SELECT
        s.source_id,
        COUNT(l.source_item_id)::int AS evidence_link_count
      FROM source_items s
      JOIN transaction_evidence_links l ON l.source_item_id = s.id
      GROUP BY s.source_id
    `)
  ]);

  const evidenceCountBySource = new Map(
    evidenceLinks.rows.map((row) => [row.source_id, row.evidence_link_count])
  );

  return new Map(
    sourceItems.rows.map((row) => [
      row.source_id,
      {
        evidenceLinkCount: evidenceCountBySource.get(row.source_id) ?? 0,
        lastImportedAt: row.last_imported_at ?? undefined,
        latestOccurredAt: row.latest_occurred_at ?? undefined,
        sourceId: row.source_id,
        sourceItemCount: row.source_item_count
      }
    ])
  );
}

export async function listSourceItems({
  limit = 50,
  query,
  sourceId
}: {
  limit?: number;
  query?: string;
  sourceId?: string;
} = {}): Promise<SourceItem[]> {
  if (!financeDbExists()) {
    return [];
  }

  const db = await getFinanceDb();
  const cappedLimit = boundedInteger(limit, 50, 250);
  const values: Array<number | string> = [];
  const where: string[] = [];
  const normalizedQuery = query?.trim();

  if (sourceId) {
    values.push(sourceId);
    where.push(`source_id = $${values.length}`);
  }

  if (normalizedQuery) {
    values.push(`%${normalizedQuery}%`);
    where.push(`(
      title ILIKE $${values.length}
      OR summary ILIKE $${values.length}
      OR COALESCE(merchant_name, '') ILIKE $${values.length}
      OR external_id ILIKE $${values.length}
      OR kind ILIKE $${values.length}
    )`);
  }

  values.push(cappedLimit);
  const result = await db.query<SourceItemRow>(
    `SELECT
      id,
      source_id,
      external_id,
      kind,
      occurred_at,
      title,
      summary,
      merchant_name,
      amount_minor,
      currency
    FROM source_items
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY occurred_at DESC NULLS LAST, updated_at DESC
    LIMIT $${values.length}`,
    values
  );

  return result.rows.map(sourceItemFromRow);
}

export async function listTransactionEvidence({
  includeDismissed = false,
  transactionId
}: {
  includeDismissed?: boolean;
  transactionId: string;
}): Promise<TransactionEvidenceItem[]> {
  if (!financeDbExists()) {
    return [];
  }

  const db = await getFinanceDb();
  const result = includeDismissed
    ? await db.query<
        SourceItemRow & {
          confidence: number;
          created_at: string;
          relationship: EvidenceRelationship;
          status: TransactionEvidenceLink["status"];
          transaction_id: string;
        }
      >(
        `SELECT
          l.transaction_id,
          l.relationship,
          l.confidence,
          l.status,
          l.created_at,
          s.id,
          s.source_id,
          s.external_id,
          s.kind,
          s.occurred_at,
          s.title,
          s.summary,
          s.merchant_name,
          s.amount_minor,
          s.currency
        FROM transaction_evidence_links l
        JOIN source_items s ON s.id = l.source_item_id
        WHERE l.transaction_id = $1
        ORDER BY
          CASE l.status WHEN 'accepted' THEN 0 WHEN 'suggested' THEN 1 ELSE 2 END,
          l.confidence DESC,
          l.created_at DESC`,
        [transactionId]
      )
    : await db.query<
        SourceItemRow & {
          confidence: number;
          created_at: string;
          relationship: EvidenceRelationship;
          status: TransactionEvidenceLink["status"];
          transaction_id: string;
        }
      >(
        `SELECT
          l.transaction_id,
          l.relationship,
          l.confidence,
          l.status,
          l.created_at,
          s.id,
          s.source_id,
          s.external_id,
          s.kind,
          s.occurred_at,
          s.title,
          s.summary,
          s.merchant_name,
          s.amount_minor,
          s.currency
        FROM transaction_evidence_links l
        JOIN source_items s ON s.id = l.source_item_id
        WHERE l.transaction_id = $1
          AND l.status <> 'dismissed'
        ORDER BY
          CASE l.status WHEN 'accepted' THEN 0 WHEN 'suggested' THEN 1 ELSE 2 END,
          l.confidence DESC,
          l.created_at DESC`,
        [transactionId]
      );

  return result.rows.map((row) => ({
    confidence: Number(row.confidence),
    createdAt: row.created_at,
    relationship: row.relationship,
    sourceItem: sourceItemFromRow(row),
    status: row.status,
    transactionId: row.transaction_id
  }));
}

export async function listEvidenceLinks({
  limit = 50,
  status = "suggested"
}: {
  limit?: number;
  status?: TransactionEvidenceLink["status"] | "all";
} = {}): Promise<EvidenceReviewItem[]> {
  if (!financeDbExists()) {
    return [];
  }

  const db = await getFinanceDb();
  const cappedLimit = boundedInteger(limit, 50, 200);
  const statusFilter = status === "all" ? undefined : status;
  const result = await db.query<
    {
      evidence_confidence: number;
      evidence_created_at: string;
      evidence_relationship: EvidenceRelationship;
      evidence_status: TransactionEvidenceLink["status"];
      transaction_id: string;
    } & PrefixedTransactionRow & PrefixedSourceItemRow
  >(
    `SELECT
      l.transaction_id,
      l.relationship AS evidence_relationship,
      l.confidence AS evidence_confidence,
      l.status AS evidence_status,
      l.created_at AS evidence_created_at,
      t.id AS transaction_id_value,
      t.account_id AS transaction_account_id,
      t.provider_connection_id AS transaction_provider_connection_id,
      t.date AS transaction_date,
      t.authorized_date AS transaction_authorized_date,
      t.posted_date AS transaction_posted_date,
      t.merchant_name AS transaction_merchant_name,
      t.description AS transaction_description,
      t.amount_minor AS transaction_amount_minor,
      t.currency AS transaction_currency,
      t.category_id AS transaction_category_id,
      t.status AS transaction_status,
      t.reviewed AS transaction_reviewed,
      t.tags AS transaction_tags,
      t.notes AS transaction_notes,
      t.pending_transaction_id AS transaction_pending_transaction_id,
      s.id AS source_item_id,
      s.source_id AS source_item_source_id,
      s.external_id AS source_item_external_id,
      s.kind AS source_item_kind,
      s.occurred_at AS source_item_occurred_at,
      s.title AS source_item_title,
      s.summary AS source_item_summary,
      s.merchant_name AS source_item_merchant_name,
      s.amount_minor AS source_item_amount_minor,
      s.currency AS source_item_currency
    FROM transaction_evidence_links l
    JOIN transactions t ON t.id = l.transaction_id
    JOIN source_items s ON s.id = l.source_item_id
    WHERE ($1::text IS NULL OR l.status = $1)
    ORDER BY
      CASE l.status WHEN 'suggested' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
      l.confidence DESC,
      l.created_at DESC
    LIMIT $2`,
    [statusFilter ?? null, cappedLimit]
  );

  return result.rows.map((row) => ({
    confidence: Number(row.evidence_confidence),
    createdAt: row.evidence_created_at,
    relationship: row.evidence_relationship,
    sourceItem: sourceItemFromPrefixedRow(row),
    status: row.evidence_status,
    transaction: transactionFromPrefixedRow(row),
    transactionId: row.transaction_id
  }));
}

export async function updateTransactionEvidenceStatus({
  relationship,
  sourceItemId,
  status,
  transactionId
}: {
  relationship: EvidenceRelationship;
  sourceItemId: string;
  status: TransactionEvidenceLink["status"];
  transactionId: string;
}): Promise<TransactionEvidenceItem | null> {
  if (!financeDbExists()) {
    return null;
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const existing = await db.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1
        FROM transaction_evidence_links
        WHERE transaction_id = $1
          AND source_item_id = $2
          AND relationship = $3
      ) AS exists`,
      [transactionId, sourceItemId, relationship]
    );

    if (!existing.rows[0]?.exists) {
      return null;
    }

    await db.query(
      `UPDATE transaction_evidence_links
      SET status = $4
      WHERE transaction_id = $1
        AND source_item_id = $2
        AND relationship = $3`,
      [transactionId, sourceItemId, relationship, status]
    );
    await refreshTransactionSemanticDocument(db, transactionId);

    return (await listTransactionEvidence({ includeDismissed: true, transactionId })).find(
      (item) => item.sourceItem.id === sourceItemId && item.relationship === relationship
    ) ?? null;
  });
}

export async function createTransactionEvidenceLink({
  confidence,
  relationship,
  sourceItemId,
  status = "accepted",
  transactionId
}: TransactionEvidenceCreateInput): Promise<TransactionEvidenceItem | null> {
  if (!financeDbExists()) {
    return null;
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const transactionExists = await db.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1
        FROM transactions
        WHERE id = $1
      ) AS exists`,
      [transactionId]
    );

    if (!transactionExists.rows[0]?.exists) {
      return null;
    }

    const sourceResult = await db.query<SourceItemRow>(
      `SELECT
        id,
        source_id,
        external_id,
        kind,
        occurred_at,
        title,
        summary,
        merchant_name,
        amount_minor,
        currency
      FROM source_items
      WHERE id = $1`,
      [sourceItemId]
    );
    const sourceItem = sourceResult.rows[0] ? sourceItemFromRow(sourceResult.rows[0]) : null;
    const resolvedRelationship = relationship ?? (sourceItem ? relationshipForSourceItem(sourceItem) : null);

    if (!sourceItem || !resolvedRelationship) {
      return null;
    }

    await upsertEvidenceLink(db, {
      confidence: clampEvidenceConfidence(confidence ?? 1),
      preserveUserStatus: false,
      relationship: resolvedRelationship,
      sourceItemId: sourceItem.id,
      status,
      transactionId
    });
    await refreshTransactionSemanticDocument(db, transactionId);

    return (await listTransactionEvidence({ includeDismissed: true, transactionId })).find(
      (item) => item.sourceItem.id === sourceItem.id && item.relationship === resolvedRelationship
    ) ?? null;
  });
}

export async function listTransactionRules(): Promise<TransactionRule[]> {
  if (!financeDbExists()) {
    return [];
  }

  const db = await getFinanceDb();
  const result = await db.query<TransactionRuleRow>(
    `SELECT
      id,
      name,
      enabled,
      match_field,
      match_operator,
      pattern,
      category_id,
      tags,
      mark_reviewed,
      created_at,
      updated_at,
      last_applied_at,
      last_applied_count
    FROM transaction_rules
    ORDER BY enabled DESC, updated_at DESC, name ASC`
  );

  return result.rows.map(transactionRuleFromRow);
}

export async function getTransactionRule(ruleId: string): Promise<TransactionRule | null> {
  if (!financeDbExists()) {
    return null;
  }

  const db = await getFinanceDb();
  return getTransactionRuleById(db, ruleId);
}

export async function createTransactionRule(input: TransactionRuleInput): Promise<{
  applyResult: RuleApplyResult;
  rule: TransactionRule;
}> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const now = new Date().toISOString();
    const categoryIds = new Set((await listCategoriesInDb(db, { includeArchived: false })).map((category) => category.id));
    const validation = validateTransactionRuleCreateBody(
      {
        category_id: input.categoryId,
        enabled: input.enabled,
        mark_reviewed: input.markReviewed,
        match_field: input.matchField,
        match_operator: input.matchOperator,
        name: input.name,
        pattern: input.pattern,
        tags: input.tags ?? []
      },
      categoryIds
    );

    if (!validation.ok) {
      throw new Error(validation.error);
    }

    const normalizedInput = validation.value;
    const rule: TransactionRule = {
      categoryId: normalizedInput.categoryId,
      createdAt: now,
      enabled: normalizedInput.enabled ?? true,
      id: `rule_${stableIdSuffix(`${normalizedInput.name}:${normalizedInput.matchField}:${normalizedInput.matchOperator}:${normalizedInput.pattern}:${now}`)}`,
      lastAppliedCount: 0,
      markReviewed: normalizedInput.markReviewed ?? false,
      matchField: normalizedInput.matchField,
      matchOperator: normalizedInput.matchOperator,
      name: normalizedInput.name,
      pattern: normalizedInput.pattern,
      tags: normalizeTags(normalizedInput.tags),
      updatedAt: now
    };

    await db.exec("BEGIN");
    try {
      await upsertTransactionRule(db, rule);
      const applyResult = rule.enabled ? await applyTransactionRulesNow(db, [rule.id]) : { rulesApplied: 0, transactionsUpdated: 0 };
      await db.exec("COMMIT");

      return {
        applyResult,
        rule: (await getTransactionRuleById(db, rule.id)) ?? rule
      };
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  });
}

export async function updateTransactionRule(
  ruleId: string,
  update: Partial<Omit<TransactionRuleInput, "categoryId" | "matchField" | "matchOperator" | "pattern"> & Pick<TransactionRuleInput, "matchField" | "matchOperator" | "pattern">> & {
    categoryId?: string | null;
  }
): Promise<{
  applyResult: RuleApplyResult;
  rule: TransactionRule;
} | null> {
  if (!financeDbExists()) {
    return null;
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const existing = await getTransactionRuleById(db, ruleId);

    if (!existing) {
      return null;
    }

    const updateBody: Record<string, unknown> = {};

    if (update.categoryId !== undefined) {
      updateBody.category_id = update.categoryId;
    }

    if (update.enabled !== undefined) {
      updateBody.enabled = update.enabled;
    }

    if (update.markReviewed !== undefined) {
      updateBody.mark_reviewed = update.markReviewed;
    }

    if (update.matchField !== undefined) {
      updateBody.match_field = update.matchField;
    }

    if (update.matchOperator !== undefined) {
      updateBody.match_operator = update.matchOperator;
    }

    if (update.name !== undefined) {
      updateBody.name = update.name;
    }

    if (update.pattern !== undefined) {
      updateBody.pattern = update.pattern;
    }

    if (update.tags !== undefined) {
      updateBody.tags = update.tags;
    }

    const categoryIds = new Set((await listCategoriesInDb(db, { includeArchived: false })).map((category) => category.id));
    const validation = validateTransactionRuleUpdateBody(updateBody, categoryIds, {
      matchOperator: existing.matchOperator,
      pattern: existing.pattern
    });

    if (!validation.ok) {
      throw new Error(validation.error);
    }

    const normalizedUpdate = validation.value;

    const nextRule: TransactionRule = {
      ...existing,
      categoryId:
        normalizedUpdate.categoryId === undefined
          ? existing.categoryId
          : normalizedUpdate.categoryId === null
            ? undefined
            : normalizedUpdate.categoryId,
      enabled: normalizedUpdate.enabled ?? existing.enabled,
      markReviewed: normalizedUpdate.markReviewed ?? existing.markReviewed,
      matchField: normalizedUpdate.matchField ?? existing.matchField,
      matchOperator: normalizedUpdate.matchOperator ?? existing.matchOperator,
      name: normalizedUpdate.name ?? existing.name,
      pattern: normalizedUpdate.pattern ?? existing.pattern,
      tags: normalizedUpdate.tags !== undefined ? normalizeTags(normalizedUpdate.tags) : existing.tags,
      updatedAt: new Date().toISOString()
    };

    await db.exec("BEGIN");
    try {
      await upsertTransactionRule(db, nextRule);
      const applyResult = nextRule.enabled ? await applyTransactionRulesNow(db, [nextRule.id]) : { rulesApplied: 0, transactionsUpdated: 0 };
      await db.exec("COMMIT");

      return {
        applyResult,
        rule: (await getTransactionRuleById(db, nextRule.id)) ?? nextRule
      };
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  });
}

export async function deleteTransactionRule(ruleId: string): Promise<boolean> {
  if (!financeDbExists()) {
    return false;
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const result = await db.query<{ id: string }>("DELETE FROM transaction_rules WHERE id = $1 RETURNING id", [ruleId]);
    return result.rows.length > 0;
  });
}

export interface ProviderConnectionDeletion {
  accountCount: number;
  removed: boolean;
  transactionCount: number;
}

/* Removing a bank connection drops its provider_connections row; accounts,
   balance snapshots, transactions, and their evidence/suggestion links all
   cascade (ON DELETE CASCADE). The caller is responsible for removing the
   matching provider credentials from the credential bundle. */
export async function deleteProviderConnection(providerConnectionId: string): Promise<ProviderConnectionDeletion> {
  if (!financeDbExists()) {
    return { accountCount: 0, removed: false, transactionCount: 0 };
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const accountCount = await db.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM accounts WHERE provider_connection_id = $1",
      [providerConnectionId]
    );
    const transactionCount = await db.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM transactions WHERE provider_connection_id = $1",
      [providerConnectionId]
    );
    const result = await db.query<{ id: string }>(
      "DELETE FROM provider_connections WHERE id = $1 RETURNING id",
      [providerConnectionId]
    );

    return {
      accountCount: accountCount.rows[0]?.count ?? 0,
      removed: result.rows.length > 0,
      transactionCount: transactionCount.rows[0]?.count ?? 0
    };
  });
}

export interface ConnectionInventory {
  accounts: Account[];
  providerByConnection: Record<string, ProviderConnection["provider"]>;
  transactionCountByConnection: Record<string, number>;
}

/* Accounts + per-connection transaction counts for the Settings connections
   list. Lighter than readFinanceDbSnapshot — never loads transaction rows. */
export async function listConnectionInventory(): Promise<ConnectionInventory> {
  if (!financeDbExists()) {
    return { accounts: [], providerByConnection: {}, transactionCountByConnection: {} };
  }

  const db = await getFinanceDb();
  const [accounts, providerConnections, transactionCounts] = await Promise.all([
    db.query<AccountRow>("SELECT * FROM accounts ORDER BY institution_name, name, id"),
    db.query<Pick<ProviderConnectionRow, "id" | "provider">>("SELECT id, provider FROM provider_connections"),
    db.query<{ provider_connection_id: string; count: number }>(
      "SELECT provider_connection_id, COUNT(*)::int AS count FROM transactions GROUP BY provider_connection_id"
    )
  ]);

  const providerByConnection: Record<string, ProviderConnection["provider"]> = {};
  for (const row of providerConnections.rows) {
    providerByConnection[row.id] = row.provider;
  }

  const transactionCountByConnection: Record<string, number> = {};
  for (const row of transactionCounts.rows) {
    transactionCountByConnection[row.provider_connection_id] = row.count;
  }

  return {
    accounts: accounts.rows.map(accountFromRow),
    providerByConnection,
    transactionCountByConnection
  };
}

export async function listInvestmentPositions(accountIds?: string[]): Promise<InvestmentPosition[]> {
  if (!financeDbExists()) {
    return [];
  }

  const db = await getFinanceDb();
  const normalizedAccountIds = [...new Set((accountIds ?? []).filter((id) => id.trim().length > 0))];
  const result =
    normalizedAccountIds.length > 0
      ? await db.query<InvestmentPositionRow>(
          `SELECT *
          FROM investment_positions
          WHERE account_id = ANY($1)
          ORDER BY symbol, id`,
          [normalizedAccountIds]
        )
      : await db.query<InvestmentPositionRow>("SELECT * FROM investment_positions ORDER BY symbol, id");

  return result.rows.map(investmentPositionFromRow);
}

export async function applyTransactionRules(ruleIds?: string[]): Promise<RuleApplyResult> {
  if (!financeDbExists()) {
    return {
      rulesApplied: 0,
      transactionsUpdated: 0
    };
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    return applyTransactionRulesNow(db, ruleIds);
  });
}

export interface RuleMatchPatternSpec {
  matchField: TransactionRuleMatchField;
  matchOperator: TransactionRuleMatchOperator;
  pattern: string;
}

export interface BulkCategorizeByMatchInput extends RuleMatchPatternSpec {
  categoryId: string;
}

export interface BulkCategorizeByMatchResult {
  transactionsUpdated: number;
  updatedTransactionIds: string[];
}

function ephemeralRuleFromSpec(spec: RuleMatchPatternSpec, categoryId?: string): TransactionRule {
  return {
    id: "__ephemeral__",
    name: "__ephemeral__",
    enabled: true,
    matchField: spec.matchField,
    matchOperator: spec.matchOperator,
    pattern: spec.pattern,
    categoryId,
    tags: [],
    markReviewed: false,
    createdAt: "",
    updatedAt: "",
    lastAppliedCount: 0
  };
}

/**
 * Read-only parity matcher shared by the rules preview endpoint. Runs a
 * transaction through the exact same matcher the rules engine uses when it
 * applies a rule, so preview/bulk results can never drift from what a real
 * rule would touch.
 */
export function transactionMatchesRulePattern(transaction: Transaction, spec: RuleMatchPatternSpec): boolean {
  return transactionMatchesRule(transaction, ephemeralRuleFromSpec(spec));
}

/**
 * Recategorizes every transaction that matches the given {field, operator,
 * pattern} spec WITHOUT persisting a rule. Uses the same engine matcher as
 * applyTransactionRulesNow so behavior is identical to a `contains` rule.
 */
export async function bulkCategorizeTransactionsByMatch(
  input: BulkCategorizeByMatchInput
): Promise<BulkCategorizeByMatchResult> {
  if (!financeDbExists()) {
    return { transactionsUpdated: 0, updatedTransactionIds: [] };
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const rule = ephemeralRuleFromSpec(input, input.categoryId);
    const transactionResult = await db.query<TransactionRow>("SELECT * FROM transactions ORDER BY date DESC, id DESC");
    const transactions = transactionResult.rows.map(transactionFromRow);
    const updatedTransactionIds: string[] = [];

    for (const transaction of transactions) {
      if (transaction.categoryId === input.categoryId) {
        continue;
      }

      if (!transactionMatchesRule(transaction, rule)) {
        continue;
      }

      await upsertTransaction(db, { ...transaction, categoryId: input.categoryId });
      updatedTransactionIds.push(transaction.id);
    }

    for (const transactionId of updatedTransactionIds) {
      await refreshTransactionSemanticDocument(db, transactionId);
    }

    if (updatedTransactionIds.length > 0) {
      invalidateShellDataCache();
    }

    return { transactionsUpdated: updatedTransactionIds.length, updatedTransactionIds };
  });
}

export async function listEnrichmentSuggestions({
  limit = 50,
  status = "pending"
}: {
  limit?: number;
  status?: EnrichmentSuggestionStatus | "all";
} = {}): Promise<EnrichmentSuggestion[]> {
  if (!financeDbExists()) {
    return [];
  }

  const db = await getFinanceDb();
  const cappedLimit = boundedInteger(limit, 50, 200);
  const result =
    status === "all"
      ? await db.query<EnrichmentSuggestionRow>(
          `SELECT *
          FROM enrichment_suggestions
          ORDER BY
            CASE status WHEN 'pending' THEN 0 WHEN 'applied' THEN 1 ELSE 2 END,
            confidence DESC,
            updated_at DESC
          LIMIT $1`,
          [cappedLimit]
        )
      : await db.query<EnrichmentSuggestionRow>(
          `SELECT *
          FROM enrichment_suggestions
          WHERE status = $1
          ORDER BY confidence DESC, updated_at DESC
          LIMIT $2`,
          [status, cappedLimit]
        );

  return result.rows.map(enrichmentSuggestionFromRow);
}

export async function listEnrichmentSuggestionItems({
  limit = 50,
  status = "pending"
}: {
  limit?: number;
  status?: EnrichmentSuggestionStatus | "all";
} = {}): Promise<EnrichmentSuggestionItem[]> {
  const suggestions = await listEnrichmentSuggestions({ limit, status });

  if (suggestions.length === 0 || !financeDbExists()) {
    return suggestions.map((suggestion) => ({ suggestion }));
  }

  const transactionIds = suggestions.flatMap((suggestion) => (suggestion.transactionId ? [suggestion.transactionId] : []));

  if (transactionIds.length === 0) {
    return suggestions.map((suggestion) => ({ suggestion }));
  }

  const db = await getFinanceDb();
  const result = await db.query<TransactionRow>("SELECT * FROM transactions WHERE id = ANY($1)", [transactionIds]);
  const transactionById = new Map(result.rows.map((row) => [row.id, transactionFromRow(row)]));

  return suggestions.map((suggestion) => ({
    suggestion,
    transaction: suggestion.transactionId ? transactionById.get(suggestion.transactionId) : undefined
  }));
}

export async function runInternalTransferPairMatching(): Promise<InternalTransferPairMatchRunSummary> {
  if (!financeDbExists()) {
    return emptyInternalTransferPairMatchRunSummary;
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    return runInternalTransferPairMatchingNow(db);
  });
}

export async function generateEnrichmentSuggestionsWithLlm(
  limit = 100,
  dependencies: FinanceDbLlmEnrichmentDependencies
): Promise<EnrichmentRunResult> {
  if (!financeDbExists()) {
    return {
      generatedAt: new Date().toISOString(),
      pairMatcher: emptyInternalTransferPairMatchRunSummary,
      pendingSuggestions: 0,
      provider: {
        completed: false,
        provider: await dependencies.getProviderStatus(),
        suggestionsAccepted: 0,
        suggestionsRejected: 0,
        suggestionsSeen: 0
      },
      suggestionsCreated: 0,
      suggestionsSeen: 0
    };
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const cappedLimit = boundedInteger(limit, 100, 100);
    const pairMatcher = await runInternalTransferPairMatchingNow(db);
    const transactionRows = await db.query<TransactionRow>("SELECT * FROM transactions ORDER BY date DESC, id DESC");
    const transactions = transactionRows.rows.map(transactionFromRow);
    const ruleRows = await db.query<TransactionRuleRow>(
      `SELECT
        id,
        name,
        enabled,
        match_field,
        match_operator,
        pattern,
        category_id,
        tags,
        mark_reviewed,
        created_at,
        updated_at,
        last_applied_at,
        last_applied_count
      FROM transaction_rules`
    );
    const existingRules = ruleRows.rows.map(transactionRuleFromRow);
    const evidenceRows = await db.query<{
      accepted_count: number;
      suggested_count: number;
      transaction_id: string;
    }>(
      `SELECT
        transaction_id,
        COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted_count,
        COUNT(*) FILTER (WHERE status = 'suggested')::int AS suggested_count
      FROM transaction_evidence_links
      GROUP BY transaction_id`
    );
    const evidenceByTransactionId = new Map(evidenceRows.rows.map((row) => [row.transaction_id, row]));
    const llmEvidenceRows = await db.query<{
      confidence: number;
      relationship: EvidenceRelationship;
      status: TransactionEvidenceLink["status"];
      summary: string;
      title: string;
      transaction_id: string;
    }>(
      `SELECT
        l.transaction_id,
        l.confidence,
        l.relationship,
        l.status,
        s.title,
        s.summary
      FROM transaction_evidence_links l
      JOIN source_items s ON s.id = l.source_item_id
      WHERE l.status = 'accepted'
        OR (l.status = 'suggested' AND l.confidence >= 0.74)
      ORDER BY
        l.transaction_id,
        CASE l.status WHEN 'accepted' THEN 0 ELSE 1 END,
        l.confidence DESC,
        l.created_at DESC`
    );
    const llmEvidenceByTransactionId = groupLlmEvidenceByTransactionId(llmEvidenceRows.rows);
    const llmRun = await dependencies.generateLlmEnrichmentSuggestions({
      evidenceByTransactionId: llmEvidenceByTransactionId,
      existingRules,
      limit: Math.min(cappedLimit, 50),
      transactions
    });
    const localCandidates = buildLocalEnrichmentSuggestionInputs({
      evidenceByTransactionId,
      existingRules,
      limit: cappedLimit,
      transactions
    });
    const candidates = dedupeEnrichmentSuggestionInputs([...llmRun.suggestions, ...localCandidates]).slice(0, cappedLimit);
    const now = new Date().toISOString();
    const candidateIdsBySource = groupSuggestionIdsBySource(candidates);

    if (!candidateIdsBySource.has("local_enrichment_v1")) {
      candidateIdsBySource.set("local_enrichment_v1", []);
    }

    if (llmRun.completed && llmRun.source && !candidateIdsBySource.has(llmRun.source)) {
      candidateIdsBySource.set(llmRun.source, []);
    }

    let suggestionsCreated = 0;

    await db.exec("BEGIN");
    try {
      for (const candidate of candidates) {
        const result = await upsertEnrichmentSuggestion(db, candidate, now);
        suggestionsCreated += result ? 1 : 0;
      }

      for (const [source, candidateIds] of candidateIdsBySource) {
        if (candidateIds.length > 0) {
          await db.query(
            `DELETE FROM enrichment_suggestions
            WHERE source = $1
              AND status = 'pending'
              AND NOT (id = ANY($2))`,
            [source, candidateIds]
          );
        } else {
          await db.query(
            `DELETE FROM enrichment_suggestions
            WHERE source = $1
              AND status = 'pending'`,
            [source]
          );
        }
      }

      await writeLlmProviderHealthSnapshot(db, llmRun.provider, now);

      const pendingResult = await db.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM enrichment_suggestions WHERE status = 'pending'"
      );
      await db.exec("COMMIT");

      return {
        generatedAt: now,
        pairMatcher,
        pendingSuggestions: pendingResult.rows[0]?.count ?? 0,
        provider: {
          completed: llmRun.completed,
          errorMessage: llmRun.errorMessage,
          provider: llmRun.provider,
          source: llmRun.source,
          suggestionsAccepted: llmRun.suggestionsAccepted,
          suggestionsRejected: llmRun.suggestionsRejected,
          suggestionsSeen: llmRun.suggestionsSeen
        },
        suggestionsCreated,
        suggestionsSeen: candidates.length
      };
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  });
}

async function runInternalTransferPairMatchingNow(db: FinanceDb): Promise<InternalTransferPairMatchRunSummary> {
  const transactionRows = await db.query<TransactionRow>("SELECT * FROM transactions ORDER BY date DESC, id DESC");
  const accountRows = await db.query<AccountRow>("SELECT * FROM accounts");
  const accounts = accountRows.rows.map(accountFromRow);
  const transactions = transactionRows.rows.map(transactionFromRow);
  const plan = buildInternalTransferPairMatchPlan({ accounts, transactions });

  // The pair matcher owns any transaction that has an opposite-side candidate
  // (auto or pending). One-sided marking only handles transactions with no
  // connected counterpart at all, so the two never fight over the same row.
  const pairedTransactionIds = new Set(plan.candidatePairs.flatMap((pair) => pair.transactionIds));
  const oneSidedPlan = buildOneSidedInternalTransferPlan({
    accounts,
    transactions,
    excludeTransactionIds: pairedTransactionIds
  });

  const suggestions = [...plan.autoApplySuggestions, ...plan.pendingSuggestions];
  const suggestionIds = suggestions.map((suggestion) => suggestion.id);
  const oneSidedSuggestionIds = oneSidedPlan.autoApplySuggestions.map((suggestion) => suggestion.id);
  const now = new Date().toISOString();

  await db.exec("BEGIN");
  try {
    for (const suggestion of suggestions) {
      await upsertEnrichmentSuggestion(db, suggestion, now);
    }
    for (const suggestion of oneSidedPlan.autoApplySuggestions) {
      await upsertEnrichmentSuggestion(db, suggestion, now);
    }

    await prunePendingSuggestionsForSource(db, internalTransferPairMatcherSource, suggestionIds);
    await prunePendingSuggestionsForSource(db, internalTransferHeuristicSource, oneSidedSuggestionIds);

    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  let autoAppliedPairs = 0;
  let autoAppliedSuggestions = 0;
  let linkedPairs = 0;

  for (const pair of plan.autoApplyPairs) {
    const pairSuggestions = plan.autoApplySuggestions.filter((suggestion) =>
      pair.transactionIds.includes(suggestion.transactionId)
    );
    let appliedForPair = 0;

    for (const suggestion of pairSuggestions) {
      const result = await applyEnrichmentSuggestionNow(db, suggestion.id);

      if (result) {
        appliedForPair += 1;
        autoAppliedSuggestions += 1;
      }
    }

    if (appliedForPair > 0) {
      autoAppliedPairs += 1;
      // Hard-link the two counterparts (Copilot's `internal_tx_match`) so each
      // side knows its match after both were marked `cat_transfer`.
      const linked = await linkInternalTransferCounterparts(
        db,
        pair.positiveTransactionId,
        pair.negativeTransactionId
      );
      if (linked) {
        linkedPairs += 1;
      }
    }
  }

  let autoAppliedOneSided = 0;
  for (const suggestion of oneSidedPlan.autoApplySuggestions) {
    const result = await applyEnrichmentSuggestionNow(db, suggestion.id);
    if (result) {
      autoAppliedOneSided += 1;
    }
  }

  return {
    autoAppliedPairs,
    autoAppliedSuggestions,
    candidatePairs: plan.candidatePairs.length,
    queuedPairs: plan.pendingPairs.length,
    queuedSuggestions: plan.pendingSuggestions.length,
    linkedPairs,
    autoAppliedOneSided
  };
}

/** Delete stale pending suggestions for a source, keeping only the current run's ids. */
async function prunePendingSuggestionsForSource(db: FinanceDb, source: string, keepIds: string[]): Promise<void> {
  if (keepIds.length > 0) {
    await db.query(
      `DELETE FROM enrichment_suggestions
      WHERE source = $1
        AND status = 'pending'
        AND NOT (id = ANY($2))`,
      [source, keepIds]
    );
  } else {
    await db.query(
      `DELETE FROM enrichment_suggestions
      WHERE source = $1
        AND status = 'pending'`,
      [source]
    );
  }
}

/**
 * Write the hard `paired_transaction_id` link on both counterparts. Only fills a
 * link that is empty or already points at the same counterpart, so an existing
 * (possibly user-confirmed) link is never silently repointed. Returns whether a
 * fresh link was written.
 */
async function linkInternalTransferCounterparts(db: FinanceDb, left: string, right: string): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    `UPDATE transactions AS t
    SET paired_transaction_id = c.counterpart
    FROM (VALUES ($1::text, $2::text), ($2::text, $1::text)) AS c(id, counterpart)
    WHERE t.id = c.id
      AND (t.paired_transaction_id IS NULL OR t.paired_transaction_id = c.counterpart)
      AND t.paired_transaction_id IS DISTINCT FROM c.counterpart
    RETURNING t.id`,
    [left, right]
  );

  return result.rows.length > 0;
}

export async function applyEnrichmentSuggestion(suggestionId: string): Promise<SuggestionApplyResult | null> {
  if (!financeDbExists()) {
    return null;
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    return applyEnrichmentSuggestionNow(db, suggestionId);
  });
}

export async function reviewEnrichmentSuggestionsBatch({
  action,
  suggestionIds
}: {
  action: "accept" | "dismiss";
  suggestionIds: string[];
}): Promise<EnrichmentSuggestionBatchResult> {
  if (!financeDbExists()) {
    return {
      applied: [],
      failed: suggestionIds.map((id) => ({
        error: "Suggestion not found or already resolved.",
        id
      }))
    };
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const applied: EnrichmentSuggestionBatchItem[] = [];
    const failed: EnrichmentSuggestionBatchResult["failed"] = [];

    for (const id of suggestionIds) {
      try {
        const result =
          action === "accept"
            ? await applyEnrichmentSuggestionNow(db, id)
            : await dismissEnrichmentSuggestionNow(db, id).then((suggestion) =>
                suggestion
                  ? {
                      suggestion
                    }
                  : null
              );

        if (!result) {
          failed.push({
            error: "Suggestion not found or already resolved.",
            id
          });
          continue;
        }

        applied.push({
          id,
          ...result
        });
      } catch (error) {
        failed.push({
          error: error instanceof Error ? error.message : "Unable to update suggestion.",
          id
        });
      }
    }

    return {
      applied,
      failed
    };
  });
}

async function applyEnrichmentSuggestionNow(db: FinanceDb, suggestionId: string): Promise<SuggestionApplyResult | null> {
  const existing = await getEnrichmentSuggestionById(db, suggestionId);

  if (!existing || existing.status !== "pending") {
    return null;
  }

  const now = new Date().toISOString();
  let transaction: Transaction | undefined;
  let rule: TransactionRule | undefined;

  await db.exec("BEGIN");
  try {
    if (existing.action === "create_rule") {
      if (!existing.ruleName || !existing.ruleMatchField || !existing.ruleMatchOperator || !existing.rulePattern) {
        throw new Error("Suggestion is missing rule details.");
      }

      const nextRule: TransactionRule = {
        categoryId: existing.categoryId,
        createdAt: now,
        enabled: true,
        id: `rule_${stableIdSuffix(`${existing.id}:${existing.ruleName}:${existing.rulePattern}`)}`,
        lastAppliedCount: 0,
        markReviewed: existing.markReviewed,
        matchField: existing.ruleMatchField,
        matchOperator: existing.ruleMatchOperator,
        name: existing.ruleName,
        pattern: existing.rulePattern,
        tags: existing.tags,
        updatedAt: now
      };

      await upsertTransactionRule(db, nextRule);
      await applyTransactionRulesNow(db, [nextRule.id]);
      rule = (await getTransactionRuleById(db, nextRule.id)) ?? nextRule;
    } else {
      if (!existing.transactionId) {
        throw new Error("Suggestion is missing a transaction id.");
      }

      const rowResult = await db.query<TransactionRow>("SELECT * FROM transactions WHERE id = $1", [
        existing.transactionId
      ]);
      const row = rowResult.rows[0];

      if (!row) {
        throw new Error("Suggested transaction was not found.");
      }

      const currentTransaction = transactionFromRow(row);
      const nextTransaction: Transaction = {
        ...currentTransaction,
        categoryId: existing.action === "set_category" && existing.categoryId ? existing.categoryId : currentTransaction.categoryId,
        reviewed: existing.action === "mark_reviewed" || existing.markReviewed ? true : currentTransaction.reviewed,
        tags: existing.action === "add_tags" ? normalizeTags([...currentTransaction.tags, ...existing.tags]) : currentTransaction.tags
      };

      transaction = await upsertTransaction(db, nextTransaction);
      await refreshTransactionSemanticDocument(db, nextTransaction.id);
    }

    await db.query(
      `UPDATE enrichment_suggestions
      SET status = 'applied',
        applied_at = $2,
        updated_at = $2
      WHERE id = $1`,
      [suggestionId, now]
    );
    await db.exec("COMMIT");

    return {
      rule,
      suggestion: (await getEnrichmentSuggestionById(db, suggestionId)) ?? existing,
      transaction
    };
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

export async function dismissEnrichmentSuggestion(suggestionId: string): Promise<EnrichmentSuggestion | null> {
  if (!financeDbExists()) {
    return null;
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    return dismissEnrichmentSuggestionNow(db, suggestionId);
  });
}

async function dismissEnrichmentSuggestionNow(db: FinanceDb, suggestionId: string): Promise<EnrichmentSuggestion | null> {
  const now = new Date().toISOString();
  const result = await db.query<EnrichmentSuggestionRow>(
    `UPDATE enrichment_suggestions
    SET status = 'dismissed',
      updated_at = $2
    WHERE id = $1
      AND status = 'pending'
    RETURNING *`,
    [suggestionId, now]
  );

  return result.rows[0] ? enrichmentSuggestionFromRow(result.rows[0]) : null;
}

export async function createTransactionContextNote({
  body,
  transactionId
}: {
  body: string;
  transactionId: string;
}): Promise<ContextNoteResult | null> {
  const trimmedBody = body.trim();

  if (trimmedBody.length === 0 || !financeDbExists()) {
    return null;
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const existing = await db.query<TransactionRow>("SELECT * FROM transactions WHERE id = $1", [transactionId]);
    const row = existing.rows[0];

    if (!row) {
      return null;
    }

    const now = new Date().toISOString();
    const externalId = `context_${stableIdSuffix(`${transactionId}:${now}:${trimmedBody}`)}`;
    const sourceItem: SourceItemInput = {
      externalId,
      id: sourceItemId("source_user_note", externalId),
      kind: "context_note",
      occurredAt: now,
      sourceId: "source_user_note",
      summary: trimmedBody,
      title: `Note for ${row.merchant_name}`
    };

    await db.exec("BEGIN");
    try {
      await ensureUserNoteSource(db, now);
      await upsertSourceItem(db, sourceItem);
      await upsertSemanticDocument(db, createSourceItemSemanticDocument(sourceItem));
      await upsertEvidenceLink(db, {
        confidence: 1,
        relationship: "user_context",
        sourceItemId: sourceItem.id,
        status: "accepted",
        transactionId
      });

      await refreshTransactionSemanticDocument(db, transactionId);

      await db.exec("COMMIT");

      return {
        sourceItem
      };
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  });
}

export async function createTransactionVoiceNote({
  transcript,
  transactionId
}: {
  transcript: string;
  transactionId: string;
}): Promise<VoiceNoteResult | null> {
  const trimmedTranscript = transcript.trim();

  if (trimmedTranscript.length === 0 || !financeDbExists()) {
    return null;
  }

  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    const existing = await db.query<TransactionRow>("SELECT * FROM transactions WHERE id = $1", [transactionId]);
    const row = existing.rows[0];

    if (!row) {
      return null;
    }

    const now = new Date().toISOString();
    const externalId = `voice_${stableIdSuffix(`${transactionId}:${now}:${trimmedTranscript}`)}`;
    const sourceItem: SourceItemInput = {
      externalId,
      id: sourceItemId("source_voice_note", externalId),
      kind: "voice_transcript",
      occurredAt: now,
      sourceId: "source_voice_note",
      summary: trimmedTranscript,
      title: `Voice note for ${row.merchant_name}`
    };

    await db.exec("BEGIN");
    try {
      await ensureVoiceNoteSource(db, now);
      await upsertSourceItem(db, sourceItem);
      await upsertSemanticDocument(db, createSourceItemSemanticDocument(sourceItem));
      await upsertEvidenceLink(db, {
        confidence: 1,
        relationship: "user_context",
        sourceItemId: sourceItem.id,
        status: "accepted",
        transactionId
      });

      await refreshTransactionSemanticDocument(db, transactionId);

      await db.exec("COMMIT");

      return {
        sourceItem
      };
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  });
}

export async function getSemanticDocumentSummary() {
  if (!financeDbExists()) {
    return {
      sourceItemDocumentCount: 0,
      sourceItemEmbeddingCount: 0,
      transactionDocumentCount: 0,
      transactionEmbeddingCount: 0,
      staleDocumentCount: 0
    };
  }

  const db = await getFinanceDb();
  const result = await db.query<{ source_item_count: number; stale_count: number; transaction_count: number }>(
    `SELECT
      COUNT(*) FILTER (WHERE resource_type = 'transaction')::int AS transaction_count,
      COUNT(*) FILTER (WHERE resource_type = 'source_item')::int AS source_item_count,
      COUNT(*) FILTER (WHERE stale_at IS NOT NULL)::int AS stale_count
    FROM semantic_documents`
  );

  const embeddingSummary = await getSemanticEmbeddingSummary();

  return {
    sourceItemDocumentCount: result.rows[0]?.source_item_count ?? 0,
    sourceItemEmbeddingCount: embeddingSummary.sourceItemEmbeddingCount,
    transactionDocumentCount: result.rows[0]?.transaction_count ?? 0,
    transactionEmbeddingCount: embeddingSummary.transactionEmbeddingCount,
    staleDocumentCount: result.rows[0]?.stale_count ?? 0
  };
}

export async function listTransactionSemanticDocumentsForTests(): Promise<
  Array<{ bodyHash: string; resourceId: string; updatedAt: string }>
> {
  if (!financeDbExists()) {
    return [];
  }

  const db = await getFinanceDb();
  const result = await db.query<{ body_hash: string; resource_id: string; updated_at: string }>(
    `SELECT resource_id, body_hash, updated_at
    FROM semantic_documents
    WHERE resource_type = 'transaction'
    ORDER BY resource_id ASC`
  );

  return result.rows.map((row) => ({
    bodyHash: row.body_hash,
    resourceId: row.resource_id,
    updatedAt: row.updated_at
  }));
}

async function getSemanticEmbeddingSummary() {
  if (!financeDbExists()) {
    return {
      sourceItemEmbeddingCount: 0,
      transactionEmbeddingCount: 0
    };
  }

  const db = await getFinanceDb();
  const activeModel = activeEmbeddingModel();
  const result = await db.query<{ source_item_count: number; transaction_count: number }>(
    `SELECT
      COUNT(*) FILTER (WHERE d.resource_type = 'transaction')::int AS transaction_count,
      COUNT(*) FILTER (WHERE d.resource_type = 'source_item')::int AS source_item_count
    FROM semantic_embeddings e
    JOIN semantic_documents d ON d.id = e.document_id
    WHERE e.model_id = $1
      AND e.body_hash = d.body_hash`,
    [activeModel.id]
  );

  return {
    sourceItemEmbeddingCount: result.rows[0]?.source_item_count ?? 0,
    transactionEmbeddingCount: result.rows[0]?.transaction_count ?? 0
  };
}

export async function closeFinanceDbForTests(): Promise<void> {
  const state = getFinanceDbState();
  await state.writeQueue.catch(() => undefined);
  categoryRegistrySeeded = false;
  if (!state.promise) {
    return;
  }

  const db = await state.promise;
  await db.close();
  state.promise = null;
  state.recoveryEvent = null;
  state.writeQueue = Promise.resolve();
}

export function getFinanceDbWriteQueueForTests(): Promise<void> {
  return getFinanceDbState().writeQueue;
}

export function enqueueDbWriteForTests<T>(operation: () => Promise<T>): Promise<T> {
  return enqueueDbWrite(operation);
}

export async function readSyncStateValue(key: string): Promise<string | undefined> {
  if (!financeDbExists()) {
    return undefined;
  }

  const db = await getFinanceDb();
  const result = await db.query<SyncStateRow>("SELECT value FROM sync_state WHERE key = $1", [key]);
  return result.rows[0]?.value;
}

export async function writeSyncStateValue(key: string, value: string): Promise<void> {
  await enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    await writeSyncState(db, { [key]: value });
  });
}

/**
 * Serialize a sync-state read/modify/write across app instances. The row lock is
 * held until the callback's replacement value is committed.
 */
export async function withLockedSyncStateValue<T>(
  key: string,
  operation: (value: string | undefined) => Promise<{ result: T; value: string }>
): Promise<T> {
  return enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    await db.exec("BEGIN");
    try {
      await db.query(
        `INSERT INTO sync_state (key, value)
        VALUES ($1, '')
        ON CONFLICT (key) DO NOTHING`,
        [key]
      );
      const current = await db.query<SyncStateRow>(
        "SELECT key, value FROM sync_state WHERE key = $1 FOR UPDATE",
        [key]
      );
      const update = await operation(current.rows[0]?.value || undefined);
      await writeSyncState(db, { [key]: update.value });
      await db.exec("COMMIT");
      return update.result;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  });
}

export async function deleteSyncStateValue(key: string): Promise<void> {
  await enqueueDbWrite(async () => {
    const db = await getFinanceDb();
    await db.query("DELETE FROM sync_state WHERE key = $1", [key]);
  });
}

function enqueueDbWrite<T>(operation: () => Promise<T>): Promise<T> {
  const state = getFinanceDbState();
  // Every write invalidates the read caches — the queue is the only mutation
  // path, so this guarantees no page ever renders pre-write ledger data.
  const scopedOperation = () =>
    runInDbWriteScope(operation).finally(() => {
      invalidateShellDataCache();
    });
  const nextOperation = state.writeQueue.then(scopedOperation, scopedOperation);
  state.writeQueue = nextOperation.then(
    () => undefined,
    () => undefined
  );
  return nextOperation;
}

async function getFinanceDb(): Promise<FinanceDb> {
  const state = getFinanceDbState();
  if (!state.promise) {
    state.promise = createFinanceDb();
  }

  return state.promise;
}

async function createFinanceDb(): Promise<FinanceDb> {
  const env = readWorkspaceEnv();

  if (env.DATABASE_URL) {
    return openMigratedFinanceDb(PgFinanceDbDriver.open(env.DATABASE_URL));
  }

  const dbPath = getFinanceDbPath();

  try {
    return await openMigratedFinanceDb(await openPgliteFinanceDb(dbPath));
  } catch (error) {
    if (dbPath === ":memory:" || hasActivePglitePostmaster(dbPath) || !isRecoverablePgliteStartupError(error)) {
      throw error;
    }

    const originalPath = quarantinePgliteDirectory(dbPath);
    getFinanceDbState().recoveryEvent = {
      originalPath,
      recoveredAt: new Date().toISOString()
    };
    return openMigratedFinanceDb(await openPgliteFinanceDb(dbPath));
  }
}

async function openMigratedFinanceDb(db: FinanceDb): Promise<FinanceDb> {
  try {
    await runMigrations(db);
    return db;
  } catch (error) {
    await db.close().catch(() => undefined);
    throw error;
  }
}

async function runMigrations(db: FinanceDb): Promise<void> {
  const embeddingModel = activeEmbeddingModel();

  await db.exec(`
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_connections (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL,
      configured BOOLEAN NOT NULL,
      last_synced_at TEXT,
      stale_after TEXT,
      error_message TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      accounts_seen INTEGER NOT NULL DEFAULT 0,
      transactions_seen INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_run_items (
      id TEXT PRIMARY KEY,
      sync_run_id TEXT NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      provider_resource_id TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL,
      name TEXT NOT NULL,
      institution_name TEXT NOT NULL,
      type TEXT NOT NULL,
      mask TEXT,
      currency TEXT NOT NULL,
      current_balance_minor INTEGER NOT NULL,
      available_balance_minor INTEGER,
      included_in_net_worth BOOLEAN NOT NULL,
      last_updated_at TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS account_balance_snapshots (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      as_of_date TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      ledger_balance_minor INTEGER NOT NULL,
      available_balance_minor INTEGER,
      currency TEXT NOT NULL,
      source TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS investment_positions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      description TEXT NOT NULL,
      units REAL NOT NULL,
      price REAL,
      cost_basis REAL,
      currency TEXT NOT NULL,
      market_value_minor INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS investment_positions_account_idx ON investment_positions(account_id);

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      authorized_date TEXT,
      posted_date TEXT,
      merchant_name TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      category_id TEXT NOT NULL,
      status TEXT NOT NULL,
      reviewed BOOLEAN NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      notes TEXT,
      pending_transaction_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date DESC);
    CREATE INDEX IF NOT EXISTS transactions_account_date_idx ON transactions(account_id, date DESC);
    CREATE INDEX IF NOT EXISTS transactions_category_idx ON transactions(category_id);

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      color TEXT NOT NULL,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS categories_archived_sort_idx ON categories(archived, sort_order);

    CREATE TABLE IF NOT EXISTS tag_registry (
      name TEXT PRIMARY KEY,
      color TEXT,
      kind TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS financial_goals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT,
      target_amount_minor INTEGER,
      state TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transaction_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      match_field TEXT NOT NULL,
      match_operator TEXT NOT NULL,
      pattern TEXT NOT NULL,
      category_id TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      mark_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_applied_at TEXT,
      last_applied_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS transaction_rules_enabled_idx ON transaction_rules(enabled);

    CREATE TABLE IF NOT EXISTS enrichment_suggestions (
      id TEXT PRIMARY KEY,
      transaction_id TEXT REFERENCES transactions(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      category_id TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      rule_name TEXT,
      rule_match_field TEXT,
      rule_match_operator TEXT,
      rule_pattern TEXT,
      mark_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      applied_at TEXT
    );

    CREATE INDEX IF NOT EXISTS enrichment_suggestions_status_idx ON enrichment_suggestions(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS enrichment_suggestions_transaction_idx ON enrichment_suggestions(transaction_id);

    CREATE TABLE IF NOT EXISTS external_sources (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL,
      configured BOOLEAN NOT NULL DEFAULT FALSE,
      command TEXT,
      last_synced_at TEXT,
      cursor TEXT,
      error_message TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS source_sync_runs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES external_sources(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      items_seen INTEGER NOT NULL DEFAULT 0,
      items_written INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS app_sync_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      financekit_status TEXT NOT NULL DEFAULT 'succeeded',
      plaid_status TEXT NOT NULL DEFAULT 'succeeded',
      snaptrade_status TEXT NOT NULL DEFAULT 'succeeded',
      simplefin_status TEXT NOT NULL DEFAULT 'succeeded',
      sources_status TEXT NOT NULL,
      enrichment_status TEXT NOT NULL,
      financekit_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      plaid_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      snaptrade_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      simplefin_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      sources_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      enrichment_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_schedules (
      id TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      interval_minutes INTEGER NOT NULL,
      next_run_at TEXT,
      claimed_at TEXT,
      claimed_by TEXT,
      last_started_at TEXT,
      last_finished_at TEXT,
      last_run_id TEXT,
      last_status TEXT,
      last_error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_items (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES external_sources(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      occurred_at TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      merchant_name TEXT,
      amount_minor INTEGER,
      currency TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (source_id, external_id)
    );

    CREATE TABLE IF NOT EXISTS transaction_evidence_links (
      transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      source_item_id TEXT NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (transaction_id, source_item_id, relationship)
    );

    CREATE INDEX IF NOT EXISTS source_items_source_occurred_idx ON source_items(source_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS source_items_kind_idx ON source_items(kind);
    CREATE INDEX IF NOT EXISTS app_sync_runs_started_idx ON app_sync_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS sync_schedules_next_run_idx ON sync_schedules(enabled, next_run_at);
    CREATE INDEX IF NOT EXISTS transaction_evidence_links_transaction_idx ON transaction_evidence_links(transaction_id);
    CREATE INDEX IF NOT EXISTS transaction_evidence_links_source_item_idx ON transaction_evidence_links(source_item_id);

    CREATE TABLE IF NOT EXISTS embedding_models (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      distance_metric TEXT NOT NULL,
      created_at TEXT NOT NULL,
      retired_at TEXT
    );

    CREATE TABLE IF NOT EXISTS semantic_documents (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      body TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      stale_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (resource_type, resource_id)
    );

    CREATE TABLE IF NOT EXISTS semantic_embeddings (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES semantic_documents(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL REFERENCES embedding_models(id) ON DELETE CASCADE,
      embedding vector(${embeddingModel.dims}) NOT NULL,
      body_hash TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (document_id, model_id, body_hash)
    );

    CREATE INDEX IF NOT EXISTS semantic_documents_resource_idx ON semantic_documents(resource_type, resource_id);
  `);

  await db.exec(`
    ALTER TABLE app_sync_runs
      ADD COLUMN IF NOT EXISTS financekit_status TEXT NOT NULL DEFAULT 'succeeded';
    ALTER TABLE app_sync_runs
      ADD COLUMN IF NOT EXISTS financekit_summary JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE app_sync_runs
      ADD COLUMN IF NOT EXISTS plaid_status TEXT NOT NULL DEFAULT 'succeeded';
    ALTER TABLE app_sync_runs
      ADD COLUMN IF NOT EXISTS plaid_summary JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE app_sync_runs
      ADD COLUMN IF NOT EXISTS snaptrade_status TEXT NOT NULL DEFAULT 'succeeded';
    ALTER TABLE app_sync_runs
      ADD COLUMN IF NOT EXISTS snaptrade_summary JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE app_sync_runs
      ADD COLUMN IF NOT EXISTS simplefin_status TEXT NOT NULL DEFAULT 'succeeded';
    ALTER TABLE app_sync_runs
      ADD COLUMN IF NOT EXISTS simplefin_summary JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE app_sync_runs
      DROP COLUMN IF EXISTS teller_status;
    ALTER TABLE app_sync_runs
      DROP COLUMN IF EXISTS teller_summary;
    ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS financial_goal_id TEXT;
    CREATE INDEX IF NOT EXISTS transactions_financial_goal_idx ON transactions(financial_goal_id);
    ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS paired_transaction_id TEXT;
    CREATE INDEX IF NOT EXISTS transactions_paired_idx ON transactions(paired_transaction_id);
    ALTER TABLE tag_registry
      ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'user';
    ALTER TABLE investment_positions
      ADD COLUMN IF NOT EXISTS cost_basis REAL;
    ALTER TABLE sync_schedules
      ADD COLUMN IF NOT EXISTS claimed_at TEXT;
    ALTER TABLE sync_schedules
      ADD COLUMN IF NOT EXISTS claimed_by TEXT;
  `);

  await db.exec(`
    UPDATE transactions
    SET financial_goal_id = NULL
    WHERE financial_goal_id IS NOT NULL
      AND financial_goal_id NOT IN (SELECT id FROM financial_goals);
  `);
  await clearDanglingTransactionPairs(db);

  if (db.dialect === "postgres") {
    await db.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'transactions_financial_goal_fk'
        ) THEN
          ALTER TABLE transactions
          ADD CONSTRAINT transactions_financial_goal_fk
          FOREIGN KEY (financial_goal_id)
          REFERENCES financial_goals(id)
          ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'transactions_paired_transaction_fk'
        ) THEN
          ALTER TABLE transactions
          ADD CONSTRAINT transactions_paired_transaction_fk
          FOREIGN KEY (paired_transaction_id)
          REFERENCES transactions(id)
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  if (db.dialect === "postgres") {
    await db.exec(`
      CREATE INDEX IF NOT EXISTS semantic_embeddings_embedding_hnsw_idx
      ON semantic_embeddings USING hnsw (embedding vector_cosine_ops);
    `);
  }

  await ensureCategoryRegistrySeeded(db);
  await sanitizeStoredSourceItemCurrencies(db);
  await backfillTagRegistryKinds(db);
}

async function clearDanglingTransactionPairs(db: FinanceDb): Promise<void> {
  await db.query(
    `UPDATE transactions
    SET paired_transaction_id = NULL
    WHERE paired_transaction_id IS NOT NULL
      AND paired_transaction_id NOT IN (SELECT id FROM transactions)`
  );
}

async function sanitizeStoredSourceItemCurrencies(db: FinanceDb): Promise<void> {
  const rows = await db.query<{ currency: string | null; id: string }>(
    "SELECT id, currency FROM source_items WHERE currency IS NOT NULL"
  );
  const changedIds: string[] = [];

  for (const row of rows.rows) {
    const normalizedCurrency = normalizeCurrencyCode(row.currency) ?? null;

    if (row.currency === normalizedCurrency) {
      continue;
    }

    await db.query("UPDATE source_items SET currency = $1 WHERE id = $2", [normalizedCurrency, row.id]);
    changedIds.push(row.id);
  }

  if (changedIds.length === 0) {
    return;
  }

  await db.query(
    `UPDATE semantic_documents
    SET stale_at = COALESCE(stale_at, $2)
    WHERE resource_type = 'source_item'
      AND resource_id = ANY($1)`,
    [changedIds, new Date().toISOString()]
  );
}

/**
 * Exact adapter names sync writers use as a bare tag (`simplefin`, `plaid`,
 * `financekit`, `snaptrade`) or as a namespace prefix (`snaptrade:dividend`).
 * Any tag name containing `:` is also treated as a machine/namespaced tag —
 * real user-typed tags don't use that syntax. Everything else is a `user`
 * tag: something a person typed (manual tag, rule action, tag popover
 * "Create ..."). This is the single source of truth for tag `kind` — it's
 * applied uniformly at every write site (registry backfill, tag-registry
 * auto-registration on transaction upsert, and explicit tag-color upserts)
 * rather than trusting each call site to say which "kind" it meant.
 */
const SOURCE_ADAPTER_TAG_NAMES = new Set(["simplefin", "plaid", "snaptrade", "financekit"]);

function classifyTagKind(name: string): "source" | "user" {
  const normalized = name.trim().toLowerCase();

  if (!normalized) {
    return "user";
  }

  if (normalized.startsWith("copilot:") || normalized.includes(":")) {
    return "source";
  }

  return SOURCE_ADAPTER_TAG_NAMES.has(normalized) ? "source" : "user";
}

/**
 * One-time-effective migration step, safe to re-run on every boot:
 * 1. Reclassifies any existing `tag_registry` row whose stored `kind` no
 *    longer matches the deterministic name-based rule (covers rows created
 *    before the `kind` column existed, which all default to `'user'`).
 * 2. Discovers tag names that only ever appeared inside `transactions.tags`
 *    and never got an explicit registry row (provider tags written by sync
 *    before this migration landed never called `upsertTagStyle`), and
 *    registers them now so the user-facing tag popover filters them out
 *    immediately instead of waiting for the next sync to re-touch them.
 */
async function backfillTagRegistryKinds(db: FinanceDb): Promise<{ discovered: number; reclassified: number }> {
  const existingRows = await db.query<{ kind: string; name: string }>("SELECT name, kind FROM tag_registry");
  const mismatched = existingRows.rows.filter((row) => row.kind !== classifyTagKind(row.name));

  for (const row of mismatched) {
    await db.query("UPDATE tag_registry SET kind = $1 WHERE name = $2", [classifyTagKind(row.name), row.name]);
  }

  const usedNames = await db.query<{ name: string }>(
    "SELECT DISTINCT jsonb_array_elements_text(tags) AS name FROM transactions"
  );
  const timestamp = new Date().toISOString();
  let discovered = 0;

  for (const usedName of usedNames.rows) {
    const tagName = normalizeTagName(usedName.name);

    if (!tagName) {
      continue;
    }

    const inserted = await db.query(
      `INSERT INTO tag_registry (name, color, kind, created_at, updated_at)
      VALUES ($1, NULL, $2, $3, $3)
      ON CONFLICT (name) DO NOTHING
      RETURNING name`,
      [tagName, classifyTagKind(tagName), timestamp]
    );

    if (inserted.rows.length > 0) {
      discovered += 1;
    }
  }

  return { discovered, reclassified: mismatched.length };
}

/**
 * Auto-registers every tag name on a transaction into `tag_registry` (kind
 * classified from the name, color left unset) so sync-written provider tags
 * and user-written tags alike always have a registry row by the time the
 * write that touched them returns — the UI never has to fall back to
 * guessing a tag's kind. Uses `DO NOTHING` so it never clobbers a
 * previously-assigned color or (deterministically identical) kind.
 */
async function registerTagRegistryEntries(db: FinanceDb, tags: string[]): Promise<void> {
  if (tags.length === 0) {
    return;
  }

  const timestamp = new Date().toISOString();

  for (const tag of tags) {
    const tagName = normalizeTagName(tag);

    if (!tagName) {
      continue;
    }

    await db.query(
      `INSERT INTO tag_registry (name, color, kind, created_at, updated_at)
      VALUES ($1, NULL, $2, $3, $3)
      ON CONFLICT (name) DO NOTHING`,
      [tagName, classifyTagKind(tagName), timestamp]
    );
  }
}

async function ensureCategoryRegistrySeeded(db: FinanceDb): Promise<void> {
  if (categoryRegistrySeeded) {
    return;
  }

  const timestamp = new Date().toISOString();

  for (const category of appCategories) {
    await db.query(
      `INSERT INTO categories (
        id,
        name,
        emoji,
        color,
        archived,
        sort_order,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, FALSE, $5, $6, $6)
      ON CONFLICT (id) DO NOTHING`,
      [category.id, category.name, category.emoji, category.color, category.sortOrder, timestamp]
    );
  }

  categoryRegistrySeeded = true;
}

async function listCategoriesInDb(
  db: FinanceDb,
  {
    includeArchived
  }: {
    includeArchived: boolean;
  }
): Promise<Category[]> {
  await ensureCategoryRegistrySeeded(db);
  const result = includeArchived
    ? await db.query<CategoryRegistryRow>("SELECT * FROM categories ORDER BY sort_order, lower(name), id")
    : await db.query<CategoryRegistryRow>(
        "SELECT * FROM categories WHERE archived = FALSE ORDER BY sort_order, lower(name), id"
      );

  return result.rows.map(categoryFromRow);
}

async function getCategoryInDb(db: FinanceDb, categoryId: string): Promise<Category | null> {
  await ensureCategoryRegistrySeeded(db);
  const result = await db.query<CategoryRegistryRow>("SELECT * FROM categories WHERE id = $1", [categoryId]);
  return result.rows[0] ? categoryFromRow(result.rows[0]) : null;
}

async function upsertCategoryRegistryRow(db: FinanceDb, category: Category): Promise<void> {
  await db.query(
    `INSERT INTO categories (
      id,
      name,
      emoji,
      color,
      archived,
      sort_order,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      emoji = EXCLUDED.emoji,
      color = EXCLUDED.color,
      archived = EXCLUDED.archived,
      sort_order = EXCLUDED.sort_order,
      updated_at = EXCLUDED.updated_at`,
    [
      category.id,
      category.name,
      category.emoji,
      category.color,
      category.archived,
      category.sortOrder,
      category.createdAt ?? new Date().toISOString(),
      category.updatedAt ?? new Date().toISOString()
    ]
  );
}

function categoryFromRow(row: CategoryRegistryRow): Category {
  const builtIn = appCategories.find((category) => category.id === row.id);

  return {
    archived: row.archived,
    budgetAmount: builtIn?.budgetAmount,
    color: normalizeRegistryColor(row.color) ?? neutralCategoryColor,
    createdAt: row.created_at,
    emoji: normalizeEmoji(row.emoji) ?? inferCategoryEmoji(row.name, neutralCategoryEmoji),
    icon: builtIn?.icon ?? "circle",
    id: row.id,
    name: row.name,
    parentId: builtIn?.parentId,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at
  };
}

function tagStyleFromRow(row: TagRegistryRow): TagStyle {
  return {
    color: row.color ?? undefined,
    createdAt: row.created_at,
    kind: row.kind === "source" ? "source" : "user",
    name: row.name,
    updatedAt: row.updated_at
  };
}

async function readTransactionOverlays(db: FinanceDb): Promise<Map<string, TransactionOverlayRow>> {
  const hasTransactions = await db.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'transactions') AS exists"
  );

  if (!hasTransactions.rows[0]?.exists) {
    return new Map();
  }

  const rows = await db.query<TransactionOverlayRow>(
    "SELECT id, category_id, reviewed, tags, notes, financial_goal_id, paired_transaction_id FROM transactions"
  );
  return new Map(rows.rows.map((row) => [row.id, row]));
}

async function readTransactionsByIds(db: FinanceDb, ids: string[]): Promise<Map<string, Transaction>> {
  const uniqueIds = [...new Set(ids)];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const rows = await db.query<TransactionRow>("SELECT * FROM transactions WHERE id = ANY($1)", [uniqueIds]);
  return new Map(rows.rows.map((row) => {
    const transaction = transactionFromRow(row);
    return [transaction.id, transaction];
  }));
}

async function upsertProviderConnection(db: FinanceDb, connection: ProviderConnection): Promise<void> {
  await db.query(
    `INSERT INTO provider_connections (
      id,
      provider,
      display_name,
      status,
      configured,
      last_synced_at,
      stale_after,
      error_message
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (id) DO UPDATE SET
      provider = EXCLUDED.provider,
      display_name = EXCLUDED.display_name,
      status = EXCLUDED.status,
      configured = EXCLUDED.configured,
      last_synced_at = EXCLUDED.last_synced_at,
      stale_after = EXCLUDED.stale_after,
      error_message = EXCLUDED.error_message`,
    [
      connection.id,
      connection.provider,
      connection.displayName,
      connection.status,
      connection.configured,
      connection.lastSyncedAt ?? null,
      connection.staleAfter ?? null,
      connection.errorMessage ?? null
    ]
  );
}

async function upsertAccount(db: FinanceDb, account: Account): Promise<void> {
  await db.query(
    `INSERT INTO accounts (
      id,
      provider_connection_id,
      group_id,
      name,
      institution_name,
      type,
      mask,
      currency,
      current_balance_minor,
      available_balance_minor,
      included_in_net_worth,
      last_updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (id) DO UPDATE SET
      provider_connection_id = EXCLUDED.provider_connection_id,
      group_id = EXCLUDED.group_id,
      name = EXCLUDED.name,
      institution_name = EXCLUDED.institution_name,
      type = EXCLUDED.type,
      mask = EXCLUDED.mask,
      currency = EXCLUDED.currency,
      current_balance_minor = EXCLUDED.current_balance_minor,
      available_balance_minor = EXCLUDED.available_balance_minor,
      included_in_net_worth = EXCLUDED.included_in_net_worth,
      last_updated_at = EXCLUDED.last_updated_at`,
    [
      account.id,
      account.providerConnectionId,
      account.groupId,
      account.name,
      account.institutionName,
      account.type,
      account.mask ?? null,
      account.currency,
      moneyToMinor(account.currentBalance),
      account.availableBalance === undefined ? null : moneyToMinor(account.availableBalance),
      account.includedInNetWorth,
      account.lastUpdatedAt
    ]
  );
}

async function upsertInvestmentPosition(db: FinanceDb, position: InvestmentPosition): Promise<void> {
  await db.query(
    `INSERT INTO investment_positions (
      id,
      account_id,
      symbol,
      description,
      units,
      price,
      cost_basis,
      currency,
      market_value_minor
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (id) DO UPDATE SET
      account_id = EXCLUDED.account_id,
      symbol = EXCLUDED.symbol,
      description = EXCLUDED.description,
      units = EXCLUDED.units,
      price = EXCLUDED.price,
      cost_basis = EXCLUDED.cost_basis,
      currency = EXCLUDED.currency,
      market_value_minor = EXCLUDED.market_value_minor`,
    [
      position.id,
      position.accountId,
      position.symbol,
      position.description,
      position.units,
      position.price ?? null,
      position.costBasis ?? null,
      position.currency,
      moneyToMinor(position.marketValue)
    ]
  );
}

async function upsertTransaction(db: FinanceDb, transaction: Transaction): Promise<Transaction> {
  const tags = normalizeTags(transaction.tags);
  await registerTagRegistryEntries(db, tags);

  const result = await db.query<TransactionRow>(
    `INSERT INTO transactions (
      id,
      account_id,
      provider_connection_id,
      date,
      authorized_date,
      posted_date,
      merchant_name,
      description,
      amount_minor,
      currency,
      category_id,
      status,
      reviewed,
      tags,
      notes,
      pending_transaction_id,
      financial_goal_id,
      paired_transaction_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18)
    ON CONFLICT (id) DO UPDATE SET
      account_id = EXCLUDED.account_id,
      provider_connection_id = EXCLUDED.provider_connection_id,
      date = EXCLUDED.date,
      authorized_date = EXCLUDED.authorized_date,
      posted_date = EXCLUDED.posted_date,
      merchant_name = EXCLUDED.merchant_name,
      description = EXCLUDED.description,
      amount_minor = EXCLUDED.amount_minor,
      currency = EXCLUDED.currency,
      category_id = EXCLUDED.category_id,
      status = EXCLUDED.status,
      reviewed = EXCLUDED.reviewed,
      tags = EXCLUDED.tags,
      notes = EXCLUDED.notes,
      pending_transaction_id = EXCLUDED.pending_transaction_id,
      financial_goal_id = EXCLUDED.financial_goal_id,
      paired_transaction_id = EXCLUDED.paired_transaction_id
    RETURNING *`,
    [
      transaction.id,
      transaction.accountId,
      transaction.providerConnectionId,
      transaction.date,
      transaction.authorizedDate ?? null,
      transaction.postedDate ?? null,
      transaction.merchantName,
      transaction.description,
      moneyToMinor(transaction.amount),
      transaction.currency,
      transaction.categoryId,
      transaction.status,
      transaction.reviewed,
      JSON.stringify(tags),
      transaction.notes ?? null,
      transaction.pendingTransactionId ?? null,
      transaction.financialGoalId ?? null,
      transaction.pairedTransactionId ?? null
    ]
  );

  return transactionFromRow(result.rows[0]);
}

async function ensureUserNoteSource(db: FinanceDb, timestamp: string): Promise<void> {
  await db.query(
    `INSERT INTO external_sources (
      id,
      kind,
      display_name,
      status,
      configured,
      command,
      last_synced_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      configured = EXCLUDED.configured,
      last_synced_at = EXCLUDED.last_synced_at,
      error_message = NULL`,
    ["source_user_note", "user_note", "User notes", "connected", true, "in_app_context_note", timestamp]
  );
}

async function ensureVoiceNoteSource(db: FinanceDb, timestamp: string): Promise<void> {
  await db.query(
    `INSERT INTO external_sources (
      id,
      kind,
      display_name,
      status,
      configured,
      command,
      last_synced_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      configured = EXCLUDED.configured,
      last_synced_at = EXCLUDED.last_synced_at,
      error_message = NULL`,
    ["source_voice_note", "voice_note", "Voice notes", "connected", true, "browser_speech_recognition", timestamp]
  );
}

async function upsertSourceItem(db: FinanceDb, item: SourceItemInput): Promise<void> {
  await db.query(
    `INSERT INTO source_items (
      id,
      source_id,
      external_id,
      kind,
      occurred_at,
      title,
      summary,
      merchant_name,
      amount_minor,
      currency,
      metadata,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $12)
    ON CONFLICT (source_id, external_id) DO UPDATE SET
      kind = EXCLUDED.kind,
      occurred_at = EXCLUDED.occurred_at,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      merchant_name = EXCLUDED.merchant_name,
      amount_minor = EXCLUDED.amount_minor,
      currency = EXCLUDED.currency,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at`,
    [
      item.id,
      item.sourceId,
      item.externalId,
      item.kind,
      item.occurredAt ?? null,
      item.title,
      item.summary,
      item.merchantName ?? null,
      item.amount === undefined ? null : moneyToMinor(item.amount),
      normalizeCurrencyCode(item.currency) ?? null,
      JSON.stringify(item.metadata ?? {}),
      new Date().toISOString()
    ]
  );
}

async function upsertTransactionRule(db: FinanceDb, rule: TransactionRule): Promise<void> {
  await db.query(
    `INSERT INTO transaction_rules (
      id,
      name,
      enabled,
      match_field,
      match_operator,
      pattern,
      category_id,
      tags,
      mark_reviewed,
      created_at,
      updated_at,
      last_applied_at,
      last_applied_count
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      enabled = EXCLUDED.enabled,
      match_field = EXCLUDED.match_field,
      match_operator = EXCLUDED.match_operator,
      pattern = EXCLUDED.pattern,
      category_id = EXCLUDED.category_id,
      tags = EXCLUDED.tags,
      mark_reviewed = EXCLUDED.mark_reviewed,
      updated_at = EXCLUDED.updated_at,
      last_applied_at = EXCLUDED.last_applied_at,
      last_applied_count = EXCLUDED.last_applied_count`,
    [
      rule.id,
      rule.name,
      rule.enabled,
      rule.matchField,
      rule.matchOperator,
      rule.pattern,
      rule.categoryId ?? null,
      JSON.stringify(normalizeTags(rule.tags)),
      rule.markReviewed,
      rule.createdAt,
      rule.updatedAt,
      rule.lastAppliedAt ?? null,
      rule.lastAppliedCount
    ]
  );
}

async function getTransactionRuleById(db: FinanceDb, ruleId: string): Promise<TransactionRule | null> {
  const result = await db.query<TransactionRuleRow>(
    `SELECT
      id,
      name,
      enabled,
      match_field,
      match_operator,
      pattern,
      category_id,
      tags,
      mark_reviewed,
      created_at,
      updated_at,
      last_applied_at,
      last_applied_count
    FROM transaction_rules
    WHERE id = $1`,
    [ruleId]
  );

  return result.rows[0] ? transactionRuleFromRow(result.rows[0]) : null;
}

async function getEnrichmentSuggestionById(
  db: FinanceDb,
  suggestionId: string
): Promise<EnrichmentSuggestion | null> {
  const result = await db.query<EnrichmentSuggestionRow>("SELECT * FROM enrichment_suggestions WHERE id = $1", [
    suggestionId
  ]);

  return result.rows[0] ? enrichmentSuggestionFromRow(result.rows[0]) : null;
}

async function upsertEnrichmentSuggestion(
  db: FinanceDb,
  suggestion: EnrichmentSuggestionInput,
  timestamp: string
): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO enrichment_suggestions (
      id,
      transaction_id,
      action,
      status,
      confidence,
      category_id,
      tags,
      rule_name,
      rule_match_field,
      rule_match_operator,
      rule_pattern,
      mark_reviewed,
      reason,
      source,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, 'pending', $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $14)
    ON CONFLICT (id) DO UPDATE SET
      transaction_id = CASE
        WHEN enrichment_suggestions.status = 'pending' THEN EXCLUDED.transaction_id
        ELSE enrichment_suggestions.transaction_id
      END,
      action = CASE WHEN enrichment_suggestions.status = 'pending' THEN EXCLUDED.action ELSE enrichment_suggestions.action END,
      confidence = CASE WHEN enrichment_suggestions.status = 'pending' THEN EXCLUDED.confidence ELSE enrichment_suggestions.confidence END,
      category_id = CASE WHEN enrichment_suggestions.status = 'pending' THEN EXCLUDED.category_id ELSE enrichment_suggestions.category_id END,
      tags = CASE WHEN enrichment_suggestions.status = 'pending' THEN EXCLUDED.tags ELSE enrichment_suggestions.tags END,
      rule_name = CASE WHEN enrichment_suggestions.status = 'pending' THEN EXCLUDED.rule_name ELSE enrichment_suggestions.rule_name END,
      rule_match_field = CASE WHEN enrichment_suggestions.status = 'pending' THEN EXCLUDED.rule_match_field ELSE enrichment_suggestions.rule_match_field END,
      rule_match_operator = CASE WHEN enrichment_suggestions.status = 'pending' THEN EXCLUDED.rule_match_operator ELSE enrichment_suggestions.rule_match_operator END,
      rule_pattern = CASE WHEN enrichment_suggestions.status = 'pending' THEN EXCLUDED.rule_pattern ELSE enrichment_suggestions.rule_pattern END,
      mark_reviewed = CASE WHEN enrichment_suggestions.status = 'pending' THEN EXCLUDED.mark_reviewed ELSE enrichment_suggestions.mark_reviewed END,
      reason = CASE WHEN enrichment_suggestions.status = 'pending' THEN EXCLUDED.reason ELSE enrichment_suggestions.reason END,
      source = CASE WHEN enrichment_suggestions.status = 'pending' THEN EXCLUDED.source ELSE enrichment_suggestions.source END,
      updated_at = CASE WHEN enrichment_suggestions.status = 'pending' THEN EXCLUDED.updated_at ELSE enrichment_suggestions.updated_at END
    RETURNING id`,
    [
      suggestion.id,
      suggestion.transactionId ?? null,
      suggestion.action,
      suggestion.confidence,
      suggestion.categoryId ?? null,
      JSON.stringify(normalizeTags(suggestion.tags ?? [])),
      suggestion.ruleName ?? null,
      suggestion.ruleMatchField ?? null,
      suggestion.ruleMatchOperator ?? null,
      suggestion.rulePattern ?? null,
      suggestion.markReviewed ?? false,
      suggestion.reason,
      suggestion.source,
      timestamp
    ]
  );

  return result.rows.length > 0;
}

async function upsertEvidenceLink(
  db: FinanceDb,
  link: {
    confidence: number;
    preserveUserStatus?: boolean;
    relationship: EvidenceRelationship;
    sourceItemId: string;
    status: "suggested" | "accepted" | "dismissed";
    transactionId: string;
  }
): Promise<TransactionEvidenceLink["status"]> {
  const result = await db.query<{ status: TransactionEvidenceLink["status"] }>(
    `INSERT INTO transaction_evidence_links (
      transaction_id,
      source_item_id,
      relationship,
      confidence,
      status,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (transaction_id, source_item_id, relationship) DO UPDATE SET
      confidence = EXCLUDED.confidence,
      status = CASE
        WHEN $7::boolean
          AND transaction_evidence_links.status IN ('accepted', 'dismissed')
          THEN transaction_evidence_links.status
        ELSE EXCLUDED.status
      END
    RETURNING status`,
    [
      link.transactionId,
      link.sourceItemId,
      link.relationship,
      link.confidence,
      link.status,
      new Date().toISOString(),
      link.preserveUserStatus ?? false
    ]
  );

  return result.rows[0]?.status ?? link.status;
}

async function matchSourceItemsToTransactionsNow(db: FinanceDb, sourceItemIds: string[]): Promise<number> {
  if (sourceItemIds.length === 0) {
    return 0;
  }

  const [sourceItems, transactions] = await Promise.all([
    db.query<SourceItemMatchRow>(
      `SELECT
        id,
        source_id,
        external_id,
        kind,
        occurred_at,
        title,
        summary,
        merchant_name,
        amount_minor,
        currency,
        updated_at
      FROM source_items
      WHERE id = ANY($1)`,
      [sourceItemIds]
    ),
    db.query<TransactionRow>("SELECT * FROM transactions ORDER BY date DESC, id DESC")
  ]);
  const acceptedLinks = await db.query<{ source_item_id: string; transaction_id: string }>(
    `SELECT source_item_id, transaction_id
    FROM transaction_evidence_links
    WHERE source_item_id = ANY($1)
      AND status = 'accepted'`,
    [sourceItemIds]
  );
  const acceptedBySourceItem = new Map(
    acceptedLinks.rows.map((row) => [row.source_item_id, row.transaction_id])
  );
  const transactionRows = transactions.rows.map(transactionFromRow);
  const affectedTransactionIds = new Set<string>();
  let suggestedCount = 0;

  for (const row of sourceItems.rows) {
    const sourceItem = sourceItemFromRow(row);
    const acceptedTransactionId = acceptedBySourceItem.get(sourceItem.id);

    if (acceptedTransactionId) {
      const staleResult = await db.query<{ transaction_id: string }>(
        `DELETE FROM transaction_evidence_links
        WHERE source_item_id = $1
          AND status = 'suggested'
        RETURNING transaction_id`,
        [sourceItem.id]
      );
      staleResult.rows.forEach((staleRow) => affectedTransactionIds.add(staleRow.transaction_id));
      affectedTransactionIds.add(acceptedTransactionId);
      continue;
    }

    const relationship = relationshipForSourceItem(sourceItem);

    if (!relationship) {
      continue;
    }

    const match = findBestEvidenceMatch(sourceItem, transactionRows);

    if (!match) {
      const staleResult = await db.query<{ transaction_id: string }>(
        `DELETE FROM transaction_evidence_links
        WHERE source_item_id = $1
          AND relationship = $2
          AND status = 'suggested'
        RETURNING transaction_id`,
        [sourceItem.id, relationship]
      );
      staleResult.rows.forEach((staleRow) => affectedTransactionIds.add(staleRow.transaction_id));
      continue;
    }

    const staleResult = await db.query<{ transaction_id: string }>(
      `DELETE FROM transaction_evidence_links
      WHERE source_item_id = $1
        AND relationship = $2
        AND transaction_id <> $3
        AND status = 'suggested'
      RETURNING transaction_id`,
      [sourceItem.id, match.relationship, match.transactionId]
    );
    staleResult.rows.forEach((staleRow) => affectedTransactionIds.add(staleRow.transaction_id));

    const status = await upsertEvidenceLink(db, {
      confidence: match.confidence,
      preserveUserStatus: true,
      relationship: match.relationship,
      sourceItemId: sourceItem.id,
      status: "suggested",
      transactionId: match.transactionId
    });
    affectedTransactionIds.add(match.transactionId);
    if (status === "suggested") {
      suggestedCount += 1;
    }
  }

  for (const transactionId of affectedTransactionIds) {
    await refreshTransactionSemanticDocument(db, transactionId);
  }

  return suggestedCount;
}

async function applyTransactionRulesNow(db: FinanceDb, ruleIds?: string[]): Promise<RuleApplyResult> {
  const rulesResult = ruleIds?.length
    ? await db.query<TransactionRuleRow>(
        `SELECT
          id,
          name,
          enabled,
          match_field,
          match_operator,
          pattern,
          category_id,
          tags,
          mark_reviewed,
          created_at,
          updated_at,
          last_applied_at,
          last_applied_count
        FROM transaction_rules
        WHERE enabled = TRUE
          AND id = ANY($1)
        ORDER BY updated_at ASC`,
        [ruleIds]
      )
    : await db.query<TransactionRuleRow>(
        `SELECT
          id,
          name,
          enabled,
          match_field,
          match_operator,
          pattern,
          category_id,
          tags,
          mark_reviewed,
          created_at,
          updated_at,
          last_applied_at,
          last_applied_count
        FROM transaction_rules
        WHERE enabled = TRUE
        ORDER BY updated_at ASC`
      );
  const rules = rulesResult.rows.map(transactionRuleFromRow);

  if (rules.length === 0) {
    return {
      rulesApplied: 0,
      transactionsUpdated: 0
    };
  }

  const transactionResult = await db.query<TransactionRow>("SELECT * FROM transactions ORDER BY date DESC, id DESC");
  const transactions = transactionResult.rows.map(transactionFromRow);
  const changedTransactionIds = new Set<string>();
  const matchCountByRuleId = new Map(rules.map((rule) => [rule.id, 0]));

  for (const transaction of transactions) {
    let nextTransaction = transaction;
    let changed = false;

    for (const rule of rules) {
      if (!transactionMatchesRule(transaction, rule)) {
        continue;
      }

      matchCountByRuleId.set(rule.id, (matchCountByRuleId.get(rule.id) ?? 0) + 1);
      const withRule = applyRuleToTransaction(nextTransaction, rule);

      if (!transactionsEqualForRuleActions(nextTransaction, withRule)) {
        nextTransaction = withRule;
        changed = true;
      }
    }

    if (changed) {
      await upsertTransaction(db, nextTransaction);
      changedTransactionIds.add(transaction.id);
    }
  }

  const appliedAt = new Date().toISOString();

  for (const rule of rules) {
    await db.query(
      `UPDATE transaction_rules
      SET
        last_applied_at = $2,
        last_applied_count = $3,
        updated_at = updated_at
      WHERE id = $1`,
      [rule.id, appliedAt, matchCountByRuleId.get(rule.id) ?? 0]
    );
  }

  for (const transactionId of changedTransactionIds) {
    await refreshTransactionSemanticDocument(db, transactionId);
  }

  return {
    rulesApplied: rules.length,
    transactionsUpdated: changedTransactionIds.size
  };
}

function buildLocalEnrichmentSuggestionInputs({
  evidenceByTransactionId,
  existingRules,
  limit,
  transactions
}: {
  evidenceByTransactionId: Map<string, { accepted_count: number; suggested_count: number; transaction_id: string }>;
  existingRules: TransactionRule[];
  limit: number;
  transactions: Transaction[];
}): EnrichmentSuggestionInput[] {
  const suggestions: EnrichmentSuggestionInput[] = [];
  const actionableTransactions = transactions.filter(isReviewActionableTransaction);
  const merchantGroups = groupTransactionsByMerchant(actionableTransactions);
  const existingRulePatterns = new Set(
    existingRules
      .filter((rule) => rule.matchField === "merchant_name" || rule.matchField === "merchant_or_description")
      .map((rule) => normalizeRuleText(rule.pattern))
  );

  for (const transaction of actionableTransactions) {
    if (suggestions.length >= limit) {
      break;
    }

    const text = `${transaction.merchantName} ${transaction.description}`;
    const keywordCategory = inferCategoryFromText(text);
    const merchantGroup = merchantGroups.get(normalizeMerchantForSuggestion(transaction.merchantName)) ?? [];
    const evidence = evidenceByTransactionId.get(transaction.id);

    if (
      keywordCategory &&
      transaction.categoryId !== keywordCategory.categoryId &&
      transaction.categoryId === "cat_other"
    ) {
      suggestions.push(
        createSuggestionInput({
          action: "set_category",
          categoryId: keywordCategory.categoryId,
          confidence: keywordCategory.confidence,
          reason: keywordCategory.reason,
          transactionId: transaction.id
        })
      );
    }

    if (merchantGroup.length >= 3 && !transaction.tags.includes("recurring")) {
      suggestions.push(
        createSuggestionInput({
          action: "add_tags",
          confidence: 0.72,
          reason: `${transaction.merchantName} appears ${merchantGroup.length.toLocaleString()} times in the local ledger.`,
          tags: ["recurring"],
          transactionId: transaction.id
        })
      );
    }

    if ((evidence?.accepted_count ?? 0) > 0 && !transaction.reviewed) {
      suggestions.push(
        createSuggestionInput({
          action: "mark_reviewed",
          confidence: 0.84,
          markReviewed: true,
          reason: "Accepted source evidence is already linked to this transaction.",
          transactionId: transaction.id
        })
      );
    }

    if (suggestions.length >= limit) {
      break;
    }
  }

  for (const [merchantKey, merchantGroup] of merchantGroups) {
    if (suggestions.length >= limit || merchantGroup.length < 3 || existingRulePatterns.has(merchantKey)) {
      continue;
    }

    const sample = merchantGroup[0];
    const commonCategory = mostCommonNonOtherCategory(merchantGroup) ?? inferCategoryFromText(sample.merchantName)?.categoryId;

    if (!commonCategory) {
      continue;
    }

    suggestions.push(
      createSuggestionInput({
        action: "create_rule",
        categoryId: commonCategory,
        confidence: Math.min(0.9, 0.62 + merchantGroup.length * 0.03),
        reason: `${sample.merchantName} has ${merchantGroup.length.toLocaleString()} matching transactions and no local rule yet.`,
        ruleMatchField: "merchant_name",
        ruleMatchOperator: "contains",
        ruleName: `${sample.merchantName} cleanup`,
        rulePattern: sample.merchantName,
        tags: merchantGroup.length >= 3 ? ["recurring"] : [],
        transactionId: sample.id
      })
    );
  }

  return suggestions
    .filter((suggestion, index, allSuggestions) => allSuggestions.findIndex((candidate) => candidate.id === suggestion.id) === index)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, limit);
}

function createSuggestionInput(input: Omit<EnrichmentSuggestionInput, "id" | "source">): EnrichmentSuggestionInput {
  const stableParts = [
    input.action,
    input.transactionId ?? "",
    input.categoryId ?? "",
    input.tags?.join(",") ?? "",
    input.rulePattern ?? "",
    input.reason
  ].join(":");

  return {
    ...input,
    id: `sug_${stableIdSuffix(stableParts)}`,
    source: "local_enrichment_v1"
  };
}

function groupTransactionsByMerchant(transactions: Transaction[]): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>();

  for (const transaction of transactions) {
    const key = normalizeMerchantForSuggestion(transaction.merchantName);

    if (!key) {
      continue;
    }

    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }

  return groups;
}

function inferCategoryFromText(text: string): { categoryId: string; confidence: number; reason: string } | null {
  const normalized = normalizeRuleText(text);

  if (isLikelyTransferLikeTransaction({ description: text })) {
    return {
      categoryId: "cat_transfer",
      confidence: 0.82,
      reason: "Local enrichment recognized an internal transfer or card-payment pattern."
    };
  }

  if (isLikelyIncomeTransaction({ description: text })) {
    return {
      categoryId: "cat_income",
      confidence: 0.84,
      reason: "Local enrichment recognized payroll or income text."
    };
  }

  if (isLikelyGroceryTransaction({ description: text })) {
    return {
      categoryId: "cat_food",
      confidence: 0.8,
      reason: "Local enrichment recognized a grocery merchant."
    };
  }

  const checks: Array<{ categoryId: string; confidence: number; keywords: string[]; label: string }> = [
    { categoryId: "cat_software", confidence: 0.82, keywords: ["openai", "google", "github", "figma", "deepseek", "railway", "vercel", "anthropic", "cursor"], label: "software or AI merchant" },
    { categoryId: "cat_shopping", confidence: 0.8, keywords: ["amazon", "amzn", "target", "apple", "costco"], label: "retail merchant" },
    { categoryId: "cat_food", confidence: 0.78, keywords: ["uber eats", "doordash", "restaurant", "cafe", "kitchen", "haveli", "sourboys"], label: "food merchant" },
    { categoryId: "cat_transportation", confidence: 0.77, keywords: ["uber", "lyft", "parking", "car wash", "geico"], label: "transportation merchant" },
    { categoryId: "cat_travel", confidence: 0.78, keywords: ["airbnb", "hotel", "booking", "flight", "delta", "united"], label: "travel merchant" }
  ];

  for (const check of checks) {
    if (check.keywords.some((keyword) => normalized.includes(keyword))) {
      return {
        categoryId: check.categoryId,
        confidence: check.confidence,
        reason: `Local enrichment recognized a ${check.label}.`
      };
    }
  }

  return null;
}

function mostCommonNonOtherCategory(transactions: Transaction[]): string | undefined {
  const categoryCounts = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.categoryId === "cat_other") {
      continue;
    }

    categoryCounts.set(transaction.categoryId, (categoryCounts.get(transaction.categoryId) ?? 0) + 1);
  }

  const [categoryId, count] = Array.from(categoryCounts.entries()).sort((left, right) => right[1] - left[1])[0] ?? [];
  return count && count >= Math.max(2, Math.ceil(transactions.length * 0.5)) ? categoryId : undefined;
}

function normalizeMerchantForSuggestion(merchant: string): string {
  return normalizeRuleText(merchant)
    .replace(/\b\d{3,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeEnrichmentSuggestionInputs(candidates: EnrichmentSuggestionInput[]): EnrichmentSuggestionInput[] {
  const bestByTarget = new Map<string, EnrichmentSuggestionInput>();

  for (const candidate of candidates) {
    const key = enrichmentSuggestionTargetKey(candidate);
    const existing = bestByTarget.get(key);

    if (!existing || compareSuggestionQuality(candidate, existing) > 0) {
      bestByTarget.set(key, candidate);
    }
  }

  return Array.from(bestByTarget.values()).sort((left, right) => compareSuggestionQuality(right, left));
}

function enrichmentSuggestionTargetKey(candidate: EnrichmentSuggestionInput): string {
  switch (candidate.action) {
    case "set_category":
      return ["set_category", candidate.transactionId ?? "", candidate.categoryId ?? ""].join(":");
    case "add_tags":
      return ["add_tags", candidate.transactionId ?? "", normalizeTags(candidate.tags ?? []).sort().join(",")].join(":");
    case "mark_reviewed":
      return ["mark_reviewed", candidate.transactionId ?? ""].join(":");
    case "create_rule":
      return [
        "create_rule",
        candidate.ruleMatchField ?? "",
        candidate.ruleMatchOperator ?? "",
        normalizeRuleText(candidate.rulePattern ?? ""),
        candidate.categoryId ?? "",
        normalizeTags(candidate.tags ?? []).sort().join(","),
        candidate.markReviewed ? "reviewed" : ""
      ].join(":");
    default:
      return candidate.id;
  }
}

function compareSuggestionQuality(left: EnrichmentSuggestionInput, right: EnrichmentSuggestionInput): number {
  const confidenceDelta = left.confidence - right.confidence;

  if (Math.abs(confidenceDelta) > 0.0001) {
    return confidenceDelta;
  }

  return suggestionSourcePriority(left.source) - suggestionSourcePriority(right.source);
}

function suggestionSourcePriority(source: string): number {
  if (source.startsWith("llm:")) {
    return 2;
  }

  return source === "local_enrichment_v1" ? 1 : 0;
}

function groupSuggestionIdsBySource(candidates: EnrichmentSuggestionInput[]): Map<string, string[]> {
  const result = new Map<string, string[]>();

  for (const candidate of candidates) {
    result.set(candidate.source, [...(result.get(candidate.source) ?? []), candidate.id]);
  }

  return result;
}

function groupLlmEvidenceByTransactionId(
  rows: Array<{
    confidence: number;
    relationship: EvidenceRelationship;
    status: TransactionEvidenceLink["status"];
    summary: string;
    title: string;
    transaction_id: string;
  }>
): Map<string, FinanceDbLlmEvidenceSummary[]> {
  const result = new Map<string, FinanceDbLlmEvidenceSummary[]>();

  for (const row of rows) {
    result.set(row.transaction_id, [
      ...(result.get(row.transaction_id) ?? []),
      {
        confidence: Number(row.confidence),
        relationship: row.relationship,
        status: row.status,
        summary: row.summary,
        title: row.title
      }
    ]);
  }

  return result;
}

async function writeSyncState(db: FinanceDb, state: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(state)) {
    await db.query(
      `INSERT INTO sync_state (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    );
  }
}

async function writeLlmProviderHealthSnapshot(
  db: FinanceDb,
  provider: FinanceDbLlmProviderStatus,
  checkedAt: string
): Promise<void> {
  await writeSyncState(db, {
    [llmProviderHealthStateKey]: JSON.stringify({
      baseUrl: provider.baseUrl,
      checkedAt,
      configured: provider.configured,
      errorMessage: provider.errorMessage,
      model: provider.model,
      provider: provider.provider,
      status: provider.status,
      timeoutMs: provider.timeoutMs
    } satisfies LlmProviderHealthSnapshot)
  });
}

async function readPersistedLlmProviderHealth(db: FinanceDb): Promise<LlmProviderHealthSnapshot | null> {
  const result = await db.query<SyncStateRow>("SELECT key, value FROM sync_state WHERE key = $1", [
    llmProviderHealthStateKey
  ]);

  return parseLlmProviderHealthSnapshot(result.rows[0]?.value);
}

async function readLatestAppSyncLlmProviderHealth(db: FinanceDb): Promise<LlmProviderHealthSnapshot | null> {
  const result = await db.query<{ enrichment_summary: unknown; finished_at: string }>(
    `SELECT enrichment_summary, finished_at
    FROM app_sync_runs
    WHERE enrichment_status = 'succeeded'
    ORDER BY finished_at DESC, started_at DESC
    LIMIT 5`
  );

  for (const row of result.rows) {
    const provider = parseAppSyncLlmProviderHealth(parseJsonRecord(row.enrichment_summary), row.finished_at);

    if (provider) {
      return provider;
    }
  }

  return null;
}

function parseAppSyncLlmProviderHealth(
  enrichmentSummary: Record<string, unknown>,
  fallbackCheckedAt: string
): LlmProviderHealthSnapshot | null {
  const providerSummary = parseJsonRecord(enrichmentSummary.provider);
  return parseLlmProviderHealthSnapshot(providerSummary.provider, fallbackCheckedAt);
}

function parseLlmProviderHealthSnapshot(
  value: unknown,
  fallbackCheckedAt = new Date(0).toISOString()
): LlmProviderHealthSnapshot | null {
  const record = parseJsonRecord(value);
  const status = parseExternalSourceStatus(record.status);
  const provider = record.provider;
  const timeoutMs = typeof record.timeoutMs === "number" && Number.isFinite(record.timeoutMs)
    ? record.timeoutMs
    : 20_000;

  if (!status || (provider !== "none" && provider !== "ollama" && provider !== "openai_compatible")) {
    return null;
  }

  return {
    baseUrl: typeof record.baseUrl === "string" ? record.baseUrl : undefined,
    checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : fallbackCheckedAt,
    configured: record.configured === true,
    errorMessage: typeof record.errorMessage === "string" ? record.errorMessage : undefined,
    model: typeof record.model === "string" ? record.model : undefined,
    provider,
    status,
    timeoutMs
  };
}

function parseExternalSourceStatus(value: unknown): ExternalSourceStatus | null {
  return value === "not_configured" ||
    value === "connected" ||
    value === "syncing" ||
    value === "stale" ||
    value === "error"
    ? value
    : null;
}

function sameConfiguredLlmProvider(left: FinanceDbLlmProviderStatus, right: FinanceDbLlmProviderStatus): boolean {
  return left.provider === right.provider &&
    left.model === right.model &&
    (left.baseUrl ?? "") === (right.baseUrl ?? "");
}

async function replaceTransactionSemanticDocuments(db: FinanceDb, ledger: Ledger): Promise<void> {
  const currentAccounts = await db.query<AccountRow>("SELECT * FROM accounts");
  const accountById = new Map([
    ...ledger.accounts.map((account) => [account.id, account] as const),
    ...currentAccounts.rows.map((row) => {
      const account = accountFromRow(row);
      return [account.id, account] as const;
    })
  ]);
  const currentTransactions = await db.query<TransactionRow>("SELECT * FROM transactions ORDER BY date DESC, id DESC");
  const transactions = currentTransactions.rows.map(transactionFromRow);
  const transactionIds = new Set(transactions.map((transaction) => transaction.id));

  if (transactions.length === 0) {
    await db.query("DELETE FROM semantic_documents WHERE resource_type = 'transaction'");
    return;
  }

  const transactionIdList = [...transactionIds];
  const evidenceSummariesByTransactionId = await readTransactionEvidenceSummariesForIds(db, transactionIdList);
  const existingDocuments = await db.query<{ body_hash: string; resource_id: string }>(
    `SELECT resource_id, body_hash
    FROM semantic_documents
    WHERE resource_type = 'transaction'
      AND resource_id = ANY($1)`,
    [transactionIdList]
  );
  const existingHashByTransactionId = new Map(
    existingDocuments.rows.map((row) => [row.resource_id, row.body_hash] as const)
  );

  for (const transaction of transactions) {
    const document = createTransactionSemanticDocument(
      transaction,
      accountById.get(transaction.accountId),
      evidenceSummariesByTransactionId.get(transaction.id) ?? []
    );

    if (existingHashByTransactionId.get(transaction.id) !== document.bodyHash) {
      await upsertSemanticDocument(db, document);
    }
  }

  await db.query(
    `DELETE FROM semantic_documents
    WHERE resource_type = 'transaction'
      AND NOT (resource_id = ANY($1))`,
    [transactionIdList]
  );
}

async function replaceSourceItemSemanticDocuments(db: FinanceDb): Promise<void> {
  const currentSourceItems = await db.query<SourceItemRow>(
    `SELECT
      id,
      source_id,
      external_id,
      kind,
      occurred_at,
      title,
      summary,
      merchant_name,
      amount_minor,
      currency
    FROM source_items
    ORDER BY occurred_at DESC NULLS LAST, updated_at DESC`
  );
  const sourceItemIds = new Set<string>();

  for (const sourceItem of currentSourceItems.rows.map(sourceItemFromRow)) {
    sourceItemIds.add(sourceItem.id);
    await upsertSemanticDocument(db, createSourceItemSemanticDocument(sourceItem));
  }

  if (sourceItemIds.size === 0) {
    await db.query("DELETE FROM semantic_documents WHERE resource_type = 'source_item'");
    return;
  }

  await db.query(
    `DELETE FROM semantic_documents
    WHERE resource_type = 'source_item'
      AND NOT (resource_id = ANY($1))`,
    [[...sourceItemIds]]
  );
}

async function refreshTransactionSemanticDocument(db: FinanceDb, transactionId: string): Promise<void> {
  const transactionResult = await db.query<TransactionRow>("SELECT * FROM transactions WHERE id = $1", [transactionId]);
  const transactionRow = transactionResult.rows[0];

  if (!transactionRow) {
    return;
  }

  const transaction = transactionFromRow(transactionRow);
  const accountResult = await db.query<AccountRow>("SELECT * FROM accounts WHERE id = $1", [transaction.accountId]);
  const account = accountResult.rows[0] ? accountFromRow(accountResult.rows[0]) : undefined;
  const evidenceSummaries = await readTransactionEvidenceSummaries(db, transactionId);
  await upsertSemanticDocument(db, createTransactionSemanticDocument(transaction, account, evidenceSummaries));
}

async function readTransactionEvidenceSummaries(db: FinanceDb, transactionId: string): Promise<EvidenceSummaryRow[]> {
  const result = await db.query<EvidenceSummaryRow>(
    `SELECT
      l.confidence,
      l.relationship,
      l.status,
      s.title,
      s.summary
    FROM transaction_evidence_links l
    JOIN source_items s ON s.id = l.source_item_id
    WHERE l.transaction_id = $1
      AND (
        l.status = 'accepted'
        OR (l.status = 'suggested' AND l.confidence >= 0.74)
      )
    ORDER BY
      CASE l.status WHEN 'accepted' THEN 0 ELSE 1 END,
      l.confidence DESC,
      l.created_at DESC
    LIMIT 8`,
    [transactionId]
  );

  return result.rows;
}

async function readTransactionEvidenceSummariesForIds(
  db: FinanceDb,
  transactionIds: string[]
): Promise<Map<string, EvidenceSummaryRow[]>> {
  if (transactionIds.length === 0) {
    return new Map();
  }

  const result = await db.query<EvidenceSummaryBatchRow>(
    `SELECT transaction_id, confidence, relationship, status, title, summary
    FROM (
      SELECT
        l.transaction_id,
        l.confidence,
        l.relationship,
        l.status,
        s.title,
        s.summary,
        ROW_NUMBER() OVER (
          PARTITION BY l.transaction_id
          ORDER BY
            CASE l.status WHEN 'accepted' THEN 0 ELSE 1 END,
            l.confidence DESC,
            l.created_at DESC
        ) AS evidence_rank
      FROM transaction_evidence_links l
      JOIN source_items s ON s.id = l.source_item_id
      WHERE l.transaction_id = ANY($1)
        AND (
          l.status = 'accepted'
          OR (l.status = 'suggested' AND l.confidence >= 0.74)
        )
    ) ranked
    WHERE evidence_rank <= 8
    ORDER BY transaction_id ASC, evidence_rank ASC`,
    [transactionIds]
  );
  const summariesByTransactionId = new Map<string, EvidenceSummaryRow[]>();

  for (const row of result.rows) {
    const summaries = summariesByTransactionId.get(row.transaction_id) ?? [];
    summaries.push({
      confidence: row.confidence,
      relationship: row.relationship,
      status: row.status,
      summary: row.summary,
      title: row.title
    });
    summariesByTransactionId.set(row.transaction_id, summaries);
  }

  return summariesByTransactionId;
}

async function upsertSemanticDocument(db: FinanceDb, document: SemanticDocumentRecord): Promise<void> {
  await db.query(
    `INSERT INTO semantic_documents (
      id,
      resource_type,
      resource_id,
      title,
      body_hash,
      body,
      metadata,
      stale_at,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NULL, $8, $8)
    ON CONFLICT (resource_type, resource_id) DO UPDATE SET
      title = EXCLUDED.title,
      body_hash = EXCLUDED.body_hash,
      body = EXCLUDED.body,
      metadata = EXCLUDED.metadata,
      stale_at = CASE
        WHEN semantic_documents.body_hash = EXCLUDED.body_hash THEN semantic_documents.stale_at
        ELSE NULL
      END,
      updated_at = EXCLUDED.updated_at`,
    [
      document.id,
      document.resourceType,
      document.resourceId,
      document.title,
      document.bodyHash,
      document.body,
      JSON.stringify(document.metadata),
      document.updatedAt
    ]
  );
}

function createTransactionSemanticDocument(
  transaction: Transaction,
  account: Account | undefined,
  evidenceSummaries: EvidenceSummaryRow[] = []
): SemanticDocumentRecord {
  const category = appCategories.find((candidate) => candidate.id === transaction.categoryId);
  const lines = [
    `Transaction: ${transaction.merchantName}`,
    `Date: ${transaction.date}`,
    `Amount: ${transaction.amount.toFixed(2)} ${transaction.currency}`,
    `Direction: ${transaction.amount < 0 ? "outflow" : "inflow"}`,
    `Status: ${transaction.status}`,
    `Description: ${transaction.description}`,
    `Category: ${category?.name ?? transaction.categoryId}`,
    account ? `Account: ${account.name} at ${account.institutionName}` : undefined,
    transaction.tags.length > 0 ? `Tags: ${transaction.tags.join(", ")}` : undefined,
    transaction.notes ? `User note: ${transaction.notes}` : undefined,
    ...evidenceSummaries.map(
      (evidence) =>
        `Evidence ${evidence.status} (${evidence.relationship}, ${Math.round(evidence.confidence * 100)}%): ${evidence.title} - ${evidence.summary}`
    ),
    transaction.reviewed ? "Review state: reviewed" : "Review state: needs review"
  ].filter((line): line is string => Boolean(line));
  const body = lines.join("\n");

  return {
    id: `doc_transaction_${stableIdSuffix(transaction.id)}`,
    resourceType: "transaction",
    resourceId: transaction.id,
    title: transaction.merchantName,
    body,
    bodyHash: hashText(body),
    metadata: {
      accountId: transaction.accountId,
      amount: transaction.amount,
      categoryId: transaction.categoryId,
      date: transaction.date,
      providerConnectionId: transaction.providerConnectionId,
      status: transaction.status,
      evidenceCount: evidenceSummaries.length,
      tags: transaction.tags
    },
    updatedAt: new Date().toISOString()
  };
}

function createSourceItemSemanticDocument(sourceItem: SourceItem): SemanticDocumentRecord {
  const lines = [
    `Source item: ${sourceItem.title}`,
    `Kind: ${sourceItem.kind}`,
    `Source: ${sourceItem.sourceId}`,
    sourceItem.occurredAt ? `Occurred at: ${sourceItem.occurredAt}` : undefined,
    sourceItem.amount === undefined
      ? undefined
      : `Amount: ${sourceItem.amount.toFixed(2)}${sourceItem.currency ? ` ${sourceItem.currency}` : ""}`,
    sourceItem.merchantName ? `Merchant: ${sourceItem.merchantName}` : undefined,
    `Summary: ${sourceItem.summary}`
  ].filter((line): line is string => Boolean(line));
  const body = lines.join("\n");

  return {
    id: `doc_source_item_${stableIdSuffix(sourceItem.id)}`,
    resourceType: "source_item",
    resourceId: sourceItem.id,
    title: sourceItem.title,
    body,
    bodyHash: hashText(body),
    metadata: {
      externalId: sourceItem.externalId,
      kind: sourceItem.kind,
      sourceId: sourceItem.sourceId,
      occurredAt: sourceItem.occurredAt,
      merchantName: sourceItem.merchantName
    },
    updatedAt: new Date().toISOString()
  };
}

async function ensureActiveEmbeddingModel(
  db: FinanceDb,
  activeModel: EmbeddingModelInfo = activeEmbeddingModel()
): Promise<Omit<SemanticIndexRefreshResult, "documentsEmbedded">> {
  const registeredModels = await db.query<EmbeddingModelRow>(
    `SELECT id, provider, model, dimensions, retired_at
    FROM embedding_models
    WHERE retired_at IS NULL
    ORDER BY created_at DESC, id`
  );
  const matchingActiveModel =
    registeredModels.rows.length === 1 &&
    registeredModels.rows[0]?.id === activeModel.id &&
    registeredModels.rows[0]?.dimensions === activeModel.dims;
  const currentVectorDimensions = await readSemanticEmbeddingVectorDimensions(db);
  const embeddingCount = await countRows(db, "semantic_embeddings");
  const modelChanged =
    (registeredModels.rows.length === 0 ? embeddingCount > 0 : !matchingActiveModel) ||
    (currentVectorDimensions !== null && currentVectorDimensions !== activeModel.dims);
  const previousModelIds = modelChanged ? registeredModels.rows.map((row) => row.id) : [];

  if (modelChanged) {
    await recreateSemanticEmbeddingStorage(db, activeModel.dims);
  } else {
    await createSemanticEmbeddingStorage(db, activeModel.dims);
  }

  const now = new Date().toISOString();

  await db.query(
    `UPDATE embedding_models
    SET retired_at = COALESCE(retired_at, $2)
    WHERE id <> $1
      AND retired_at IS NULL`,
    [activeModel.id, now]
  );
  await db.query(
    `INSERT INTO embedding_models (
      id,
      provider,
      model,
      dimensions,
      distance_metric,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE SET
      provider = EXCLUDED.provider,
      model = EXCLUDED.model,
      dimensions = EXCLUDED.dimensions,
      distance_metric = EXCLUDED.distance_metric,
      retired_at = NULL`,
    [
      activeModel.id,
      activeModel.provider,
      activeModel.model,
      activeModel.dims,
      "cosine",
      now
    ]
  );

  return {
    activeModel,
    modelChanged,
    previousModelIds
  };
}

async function readSemanticEmbeddingVectorDimensions(db: FinanceDb): Promise<number | null> {
  const result = await db.query<{ formatted_type: string | null }>(
    `SELECT format_type(a.atttypid, a.atttypmod) AS formatted_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'semantic_embeddings'
      AND n.nspname = 'public'
      AND a.attname = 'embedding'
      AND NOT a.attisdropped
    LIMIT 1`
  );
  const formattedType = result.rows[0]?.formatted_type;
  const match = formattedType?.match(/^vector\((\d+)\)$/);

  return match ? Number.parseInt(match[1], 10) : null;
}

async function recreateSemanticEmbeddingStorage(db: FinanceDb, dimensions: number): Promise<void> {
  await db.exec(`
    DROP INDEX IF EXISTS semantic_embeddings_embedding_hnsw_idx;
    DROP TABLE IF EXISTS semantic_embeddings;
  `);
  await createSemanticEmbeddingStorage(db, dimensions);
}

async function createSemanticEmbeddingStorage(db: FinanceDb, dimensions: number): Promise<void> {
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new Error(`Invalid semantic embedding dimensions: ${dimensions}`);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_embeddings (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES semantic_documents(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL REFERENCES embedding_models(id) ON DELETE CASCADE,
      embedding vector(${dimensions}) NOT NULL,
      body_hash TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (document_id, model_id, body_hash)
    );
  `);

  if (db.dialect === "postgres") {
    await db.exec(`
      CREATE INDEX IF NOT EXISTS semantic_embeddings_embedding_hnsw_idx
      ON semantic_embeddings USING hnsw (embedding vector_cosine_ops);
    `);
  }
}

function providerConnectionFromRow(row: ProviderConnectionRow): ProviderConnection {
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.display_name,
    status: row.status,
    configured: row.configured,
    lastSyncedAt: row.last_synced_at ?? undefined,
    staleAfter: row.stale_after ?? undefined,
    errorMessage: row.error_message ?? undefined
  };
}

function accountBalanceSnapshotFromRow(row: AccountBalanceSnapshotRow): AccountBalanceSnapshot {
  return {
    id: row.id,
    accountId: row.account_id,
    asOfDate: row.as_of_date,
    capturedAt: row.captured_at,
    ledgerBalance: minorToMoney(row.ledger_balance_minor),
    availableBalance: row.available_balance_minor === null ? undefined : minorToMoney(row.available_balance_minor),
    currency: row.currency,
    source: row.source
  };
}

function accountFromRow(row: AccountRow): Account {
  return {
    id: row.id,
    providerConnectionId: row.provider_connection_id,
    groupId: row.group_id,
    name: row.name,
    institutionName: row.institution_name,
    type: row.type,
    mask: row.mask ?? undefined,
    currency: row.currency,
    currentBalance: minorToMoney(row.current_balance_minor),
    availableBalance: row.available_balance_minor === null ? undefined : minorToMoney(row.available_balance_minor),
    includedInNetWorth: row.included_in_net_worth,
    lastUpdatedAt: row.last_updated_at
  };
}

function investmentPositionFromRow(row: InvestmentPositionRow): InvestmentPosition {
  return {
    id: row.id,
    accountId: row.account_id,
    symbol: row.symbol,
    description: row.description,
    units: Number(row.units),
    price: row.price === null ? undefined : Number(row.price),
    costBasis: row.cost_basis === null || row.cost_basis === undefined ? undefined : Number(row.cost_basis),
    currency: row.currency,
    marketValue: minorToMoney(row.market_value_minor)
  };
}

function createLedgerBalanceSnapshots(ledger: Ledger): AccountBalanceSnapshot[] {
  const providedSnapshots = ledger.balanceSnapshots ?? [];
  const accountIdsWithSnapshots = new Set(providedSnapshots.map((snapshot) => snapshot.accountId));
  const missingSnapshots = ledger.accounts
    .filter((account) => !accountIdsWithSnapshots.has(account.id))
    .map((account) => ({
      id: `${account.id}_${ledger.lastSyncedAt.slice(0, 10)}`,
      accountId: account.id,
      asOfDate: ledger.lastSyncedAt.slice(0, 10),
      capturedAt: ledger.lastSyncedAt,
      ledgerBalance: account.currentBalance,
      availableBalance: account.availableBalance,
      currency: account.currency,
      source: "koban"
    }));

  return [...providedSnapshots, ...missingSnapshots];
}

function transactionFromRow(row: TransactionRow): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    providerConnectionId: row.provider_connection_id,
    date: row.date,
    authorizedDate: row.authorized_date ?? undefined,
    postedDate: row.posted_date ?? undefined,
    merchantName: row.merchant_name,
    description: row.description,
    amount: minorToMoney(row.amount_minor),
    currency: row.currency,
    categoryId: row.category_id,
    status: row.status,
    reviewed: row.reviewed,
    tags: normalizeTags(parseTags(row.tags)),
    notes: row.notes ?? undefined,
    pendingTransactionId: row.pending_transaction_id ?? undefined,
    financialGoalId: row.financial_goal_id ?? undefined,
    pairedTransactionId: row.paired_transaction_id ?? undefined
  };
}

function sourceItemFromRow(row: SourceItemRow): SourceItem {
  return {
    amount: row.amount_minor === null ? undefined : minorToMoney(row.amount_minor),
    currency: normalizeCurrencyCode(row.currency) ?? undefined,
    externalId: row.external_id,
    id: row.id,
    kind: row.kind,
    merchantName: row.merchant_name ?? undefined,
    occurredAt: row.occurred_at ?? undefined,
    sourceId: row.source_id,
    summary: row.summary,
    title: row.title
  };
}

function transactionFromPrefixedRow(row: PrefixedTransactionRow): Transaction {
  return transactionFromRow({
    account_id: row.transaction_account_id,
    amount_minor: row.transaction_amount_minor,
    authorized_date: row.transaction_authorized_date,
    category_id: row.transaction_category_id,
    currency: row.transaction_currency,
    date: row.transaction_date,
    description: row.transaction_description,
    id: row.transaction_id_value,
    merchant_name: row.transaction_merchant_name,
    notes: row.transaction_notes,
    pending_transaction_id: row.transaction_pending_transaction_id,
    posted_date: row.transaction_posted_date,
    provider_connection_id: row.transaction_provider_connection_id,
    reviewed: row.transaction_reviewed,
    status: row.transaction_status,
    tags: row.transaction_tags,
    financial_goal_id: null,
    paired_transaction_id: null
  });
}

function sourceItemFromPrefixedRow(row: PrefixedSourceItemRow): SourceItem {
  return sourceItemFromRow({
    amount_minor: row.source_item_amount_minor,
    currency: row.source_item_currency,
    external_id: row.source_item_external_id,
    id: row.source_item_id,
    kind: row.source_item_kind,
    merchant_name: row.source_item_merchant_name,
    occurred_at: row.source_item_occurred_at,
    source_id: row.source_item_source_id,
    summary: row.source_item_summary,
    title: row.source_item_title
  });
}

function transactionRuleFromRow(row: TransactionRuleRow): TransactionRule {
  return {
    categoryId: row.category_id ?? undefined,
    createdAt: row.created_at,
    enabled: row.enabled,
    id: row.id,
    lastAppliedAt: row.last_applied_at ?? undefined,
    lastAppliedCount: row.last_applied_count,
    markReviewed: row.mark_reviewed,
    matchField: row.match_field,
    matchOperator: row.match_operator,
    name: row.name,
    pattern: row.pattern,
    tags: normalizeTags(parseTags(row.tags)),
    updatedAt: row.updated_at
  };
}

function enrichmentSuggestionFromRow(row: EnrichmentSuggestionRow): EnrichmentSuggestion {
  return {
    action: row.action,
    appliedAt: row.applied_at ?? undefined,
    categoryId: row.category_id ?? undefined,
    confidence: Number(row.confidence),
    createdAt: row.created_at,
    id: row.id,
    markReviewed: row.mark_reviewed,
    reason: row.reason,
    ruleMatchField: row.rule_match_field ?? undefined,
    ruleMatchOperator: row.rule_match_operator ?? undefined,
    ruleName: row.rule_name ?? undefined,
    rulePattern: row.rule_pattern ?? undefined,
    source: row.source,
    status: row.status,
    tags: normalizeTags(parseTags(row.tags)),
    transactionId: row.transaction_id ?? undefined,
    updatedAt: row.updated_at
  };
}

function appSyncRunFromRow(row: AppSyncRunRow): AppSyncRunRecord {
  return {
    enrichmentStatus: row.enrichment_status,
    enrichmentSummary: parseJsonRecord(row.enrichment_summary),
    errorMessage: row.error_message ?? undefined,
    finishedAt: row.finished_at,
    financekitStatus: row.financekit_status ?? "succeeded",
    financekitSummary: parseJsonRecord(row.financekit_summary ?? { configured: false, skipped: true }),
    id: row.id,
    plaidStatus: row.plaid_status ?? "succeeded",
    plaidSummary: parseJsonRecord(row.plaid_summary ?? { configured: false, skipped: true }),
    sourcesStatus: row.sources_status,
    sourcesSummary: parseJsonRecord(row.sources_summary),
    simplefinStatus: row.simplefin_status ?? "succeeded",
    simplefinSummary: parseJsonRecord(row.simplefin_summary ?? { configured: false, skipped: true }),
    snaptradeStatus: row.snaptrade_status ?? "succeeded",
    snaptradeSummary: parseJsonRecord(row.snaptrade_summary ?? { configured: false, skipped: true }),
    startedAt: row.started_at,
    status: row.status
  };
}

async function ensureAppSyncScheduleInDb(
  db: FinanceDb,
  timestamp: string,
  scheduleId: SyncScheduleId = appSyncScheduleId
): Promise<void> {
  await db.query(
    `INSERT INTO sync_schedules (
      id,
      enabled,
      interval_minutes,
      next_run_at,
      created_at,
      updated_at
    ) VALUES ($1, FALSE, $2, NULL, $3, $3)
    ON CONFLICT (id) DO NOTHING`,
    [scheduleId, syncScheduleDefaults[scheduleId].intervalMinutes, timestamp]
  );
}

async function readAppSyncScheduleInDb(
  db: FinanceDb,
  scheduleId: SyncScheduleId = appSyncScheduleId
): Promise<SyncScheduleRecord> {
  const result = await db.query<SyncScheduleRow>("SELECT * FROM sync_schedules WHERE id = $1", [scheduleId]);
  const row = result.rows[0];

  if (!row) {
    throw new Error(`Sync schedule ${scheduleId} is missing.`);
  }

  return syncScheduleFromRow(row);
}

function syncScheduleFromRow(row: SyncScheduleRow): SyncScheduleRecord {
  return {
    claimedAt: row.claimed_at ?? undefined,
    claimedBy: row.claimed_by ?? undefined,
    createdAt: row.created_at,
    enabled: row.enabled,
    id: row.id,
    intervalMinutes: row.interval_minutes,
    lastErrorMessage: row.last_error_message ?? undefined,
    lastFinishedAt: row.last_finished_at ?? undefined,
    lastRunId: row.last_run_id ?? undefined,
    lastStartedAt: row.last_started_at ?? undefined,
    lastStatus: row.last_status ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    updatedAt: row.updated_at
  };
}

function mergeTransactionOverlay(transaction: Transaction, overlay: TransactionOverlayRow | undefined): Transaction {
  if (!overlay) {
    return transaction;
  }

  const overlayTags = normalizeTags(parseTags(overlay.tags));
  const shouldUseProviderInferredCategory =
    transaction.categoryId !== "cat_other" &&
    !overlay.reviewed &&
    !overlay.notes &&
    overlayTags.every((tag) => classifyTagKind(tag) === "source") &&
    (overlay.category_id === "cat_other" ||
      (transaction.categoryId === "cat_transfer" &&
        overlay.category_id !== "cat_transfer" &&
        isLikelyTransferLikeTransaction({
          description: transaction.description,
          merchantName: transaction.merchantName
        })) ||
      (transaction.categoryId === "cat_food" &&
        overlay.category_id === "cat_software" &&
        isLikelyGroceryTransaction({
          description: transaction.description,
          merchantName: transaction.merchantName
        })));

  return {
    ...transaction,
    categoryId: shouldUseProviderInferredCategory ? transaction.categoryId : overlay.category_id,
    reviewed: overlay.reviewed,
    tags: overlayTags,
    notes: overlay.notes ?? undefined,
    // Goal assignment is a pure user overlay; providers never set it, so always
    // carry the existing assignment forward across resync.
    financialGoalId: overlay.financial_goal_id ?? undefined,
    // The internal-transfer counterpart link is derived, not provider-owned;
    // carry it forward so a resync never severs a hard-linked pair.
    pairedTransactionId: overlay.paired_transaction_id ?? undefined
  };
}

function transactionsEqual(left: Transaction, right: Transaction): boolean {
  return (
    left.id === right.id &&
    left.accountId === right.accountId &&
    left.providerConnectionId === right.providerConnectionId &&
    left.date === right.date &&
    left.authorizedDate === right.authorizedDate &&
    left.postedDate === right.postedDate &&
    left.merchantName === right.merchantName &&
    left.description === right.description &&
    moneyToMinor(left.amount) === moneyToMinor(right.amount) &&
    left.currency === right.currency &&
    left.categoryId === right.categoryId &&
    left.status === right.status &&
    left.reviewed === right.reviewed &&
    left.notes === right.notes &&
    left.pendingTransactionId === right.pendingTransactionId &&
    normalizeTags(left.tags).join("\u0000") === normalizeTags(right.tags).join("\u0000")
  );
}

function simpleFinErrorsToMessage(errors: unknown[]): string | null {
  if (errors.length === 0) {
    return null;
  }

  return errors
    .map((error) => {
      if (typeof error === "string") {
        return error;
      }

      if (error && typeof error === "object") {
        const record = error as Record<string, unknown>;
        const code = typeof record.code === "string" ? record.code : undefined;
        const message =
          typeof record.message === "string"
            ? record.message
            : typeof record.msg === "string"
              ? record.msg
              : undefined;
        return [code, message].filter(Boolean).join(": ") || JSON.stringify(error);
      }

      return String(error);
    })
    .join("\n");
}

function transactionMatchesRule(transaction: Transaction, rule: TransactionRule): boolean {
  const rawPattern = normalizeRuleRegexText(rule.pattern);

  if (!rawPattern) {
    return false;
  }

  if (rule.matchOperator === "regex") {
    const regex = compileTransactionRuleRegex(rawPattern);

    if (!regex) {
      return false;
    }

    return ruleMatchCandidates(transaction, rule.matchField)
      .map(normalizeRuleRegexText)
      // ponytail: static rejector + input cap; worker-timebox if a linear-time engine is ever needed.
      .some((candidate) => regex.test(candidate.slice(0, maxRegexRuleCandidateLength)));
  }

  const pattern = normalizeRuleText(rawPattern);
  const candidates = ruleMatchCandidates(transaction, rule.matchField).map(normalizeRuleText);

  if (rule.matchOperator === "equals") {
    return candidates.some((candidate) => candidate === pattern);
  }

  return candidates.some((candidate) => candidate.includes(pattern));
}

export function compileTransactionRuleRegex(pattern: string): RegExp | undefined {
  if (isLikelyCatastrophicRegex(pattern)) {
    return undefined;
  }

  try {
    // Regex rules are run against normalized merchant/description fields only, keeping match input bounded.
    return new RegExp(pattern, "iu");
  } catch {
    return undefined;
  }
}

function normalizeRuleRegexText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function ruleMatchCandidates(transaction: Transaction, field: TransactionRuleMatchField): string[] {
  switch (field) {
    case "merchant_name":
      return [transaction.merchantName];
    case "description":
      return [transaction.description];
    case "merchant_or_description":
      return [transaction.merchantName, transaction.description];
  }
}

function applyRuleToTransaction(transaction: Transaction, rule: TransactionRule): Transaction {
  return {
    ...transaction,
    categoryId: rule.categoryId ?? transaction.categoryId,
    reviewed: rule.markReviewed ? true : transaction.reviewed,
    tags: normalizeTags([...transaction.tags, ...rule.tags])
  };
}

function transactionsEqualForRuleActions(left: Transaction, right: Transaction): boolean {
  return (
    left.categoryId === right.categoryId &&
    left.reviewed === right.reviewed &&
    left.tags.length === right.tags.length &&
    left.tags.every((tag, index) => tag === right.tags[index])
  );
}

function normalizeRuleText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findBestEvidenceMatch(
  sourceItem: SourceItem,
  transactions: Transaction[]
): { confidence: number; relationship: EvidenceRelationship; transactionId: string } | null {
  const relationship = relationshipForSourceItem(sourceItem);

  if (!relationship) {
    return null;
  }

  let best: { confidence: number; relationship: EvidenceRelationship; transactionId: string } | null = null;

  for (const transaction of transactions) {
    const confidence = scoreEvidenceMatch(sourceItem, transaction, relationship);

    if (!best || confidence > best.confidence) {
      best = {
        confidence,
        relationship,
        transactionId: transaction.id
      };
    }
  }

  if (!best || best.confidence < evidenceMatchThreshold(relationship)) {
    return null;
  }

  return {
    ...best,
    confidence: Math.round(best.confidence * 1000) / 1000
  };
}

function relationshipForSourceItem(sourceItem: SourceItem): EvidenceRelationship | null {
  switch (sourceItem.kind) {
    case "email":
    case "receipt":
      return "receipt";
    case "order":
      return "order";
    case "grocery_order":
    case "calendar_event":
      return "merchant_context";
    case "travel_booking":
    case "travel_listing":
      return "travel_context";
    case "context_note":
    case "voice_transcript":
      return "user_context";
    default:
      return null;
  }
}

function evidenceMatchThreshold(relationship: EvidenceRelationship): number {
  switch (relationship) {
    case "merchant_context":
      return 0.44;
    case "travel_context":
      return 0.48;
    default:
      return 0.56;
  }
}

function clampEvidenceConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(0, Math.min(1, value));
}

function scoreEvidenceMatch(
  sourceItem: SourceItem,
  transaction: Transaction,
  relationship: EvidenceRelationship
): number {
  const dateScore = scoreDateProximity(sourceItem.occurredAt, transaction.date);
  const amountScore = scoreAmountProximity(sourceItem.amount, transaction.amount);
  const textScore = scoreTextOverlap(sourceItem, transaction);
  const sourceKindScore = scoreSourceKindSignal(sourceItem, transaction, relationship);

  if (textScore + sourceKindScore < 0.18 && amountScore < 0.26) {
    return 0;
  }

  if (!sourceItem.occurredAt && sourceItem.amount === undefined && textScore + sourceKindScore < 0.3) {
    return 0;
  }

  return Math.min(0.99, dateScore + amountScore + textScore + sourceKindScore);
}

function scoreDateProximity(sourceDate: string | undefined, transactionDate: string): number {
  const dayDistance = absoluteDayDistance(sourceDate, transactionDate);

  if (dayDistance === null) {
    return 0;
  }

  if (dayDistance === 0) {
    return 0.32;
  }

  if (dayDistance <= 1) {
    return 0.29;
  }

  if (dayDistance <= 3) {
    return 0.22;
  }

  if (dayDistance <= 7) {
    return 0.14;
  }

  if (dayDistance <= 30) {
    return 0.06;
  }

  return 0;
}

function scoreAmountProximity(sourceAmount: number | undefined, transactionAmount: number): number {
  if (sourceAmount === undefined) {
    return 0;
  }

  const sourceAbs = Math.abs(sourceAmount);
  const transactionAbs = Math.abs(transactionAmount);
  const difference = Math.abs(sourceAbs - transactionAbs);
  const relativeDifference = transactionAbs === 0 ? difference : difference / transactionAbs;

  if (difference <= 0.01) {
    return 0.34;
  }

  if (difference <= 0.5) {
    return 0.3;
  }

  if (difference <= 1) {
    return 0.26;
  }

  if (difference <= 5 || relativeDifference <= 0.05) {
    return 0.14;
  }

  return 0;
}

function scoreTextOverlap(sourceItem: SourceItem, transaction: Transaction): number {
  const sourceTokens = tokenizeEvidenceText(
    [sourceItem.title, sourceItem.summary, sourceItem.merchantName].filter(Boolean).join(" ")
  );
  const transactionTokens = tokenizeEvidenceText(`${transaction.merchantName} ${transaction.description}`);

  if (sourceTokens.size === 0 || transactionTokens.size === 0) {
    return 0;
  }

  const merchantTokens = tokenizeEvidenceText(transaction.merchantName);
  const sourceMerchantTokens = tokenizeEvidenceText(sourceItem.merchantName ?? "");
  const merchantCoverage = tokenCoverage(merchantTokens, sourceTokens);
  const sourceMerchantCoverage = tokenCoverage(sourceMerchantTokens, transactionTokens);
  const intersectionSize = [...sourceTokens].filter((token) => transactionTokens.has(token)).length;
  const unionSize = new Set([...sourceTokens, ...transactionTokens]).size;
  const jaccard = unionSize === 0 ? 0 : intersectionSize / unionSize;
  const compactSource = compactEvidenceText(`${sourceItem.title} ${sourceItem.summary} ${sourceItem.merchantName ?? ""}`);
  const compactMerchant = compactEvidenceText(transaction.merchantName);
  let score = 0;

  if (compactMerchant.length >= 4 && compactSource.includes(compactMerchant)) {
    score += 0.24;
  } else {
    score += merchantCoverage * 0.18;
  }

  score += sourceMerchantCoverage * 0.12;
  score += Math.min(0.12, jaccard * 0.28);

  return Math.min(0.32, score);
}

function scoreSourceKindSignal(
  sourceItem: SourceItem,
  transaction: Transaction,
  relationship: EvidenceRelationship
): number {
  const sourceTokens = tokenizeEvidenceText(`${sourceItem.title} ${sourceItem.summary} ${sourceItem.merchantName ?? ""}`);
  const transactionTokens = tokenizeEvidenceText(`${transaction.merchantName} ${transaction.description}`);

  if (relationship === "travel_context") {
    const transactionIsTravel = hasAnyToken(transactionTokens, ["airbnb", "booking", "hotel", "lodging", "vrbo"]);
    const sourceIsTravel = hasAnyToken(sourceTokens, ["airbnb", "booking", "host", "listing", "lodging", "travel", "vrbo"]);
    return transactionIsTravel && sourceIsTravel ? 0.16 : 0;
  }

  if (sourceItem.kind === "grocery_order") {
    const transactionIsGrocery = hasAnyToken(transactionTokens, [
      "aldi",
      "costco",
      "grocery",
      "instacart",
      "kroger",
      "market",
      "qfc",
      "safeway",
      "sprouts",
      "target",
      "trader",
      "walmart",
      "whole",
      "wholefoods"
    ]);
    const sourceMerchantTokens = tokenizeEvidenceText(sourceItem.merchantName ?? "");
    const retailerCoverage = tokenCoverage(sourceMerchantTokens, transactionTokens);
    return transactionIsGrocery || retailerCoverage > 0 ? 0.2 : 0;
  }

  if (sourceItem.kind === "order") {
    const transactionIsAmazon = hasAnyToken(transactionTokens, ["amazon", "amzn", "prime"]);
    const sourceIsAmazon = hasAnyToken(sourceTokens, ["amazon", "amzn", "order", "shipment"]);
    return transactionIsAmazon && sourceIsAmazon ? 0.14 : 0;
  }

  if (sourceItem.kind === "email" && hasAnyToken(sourceTokens, ["invoice", "receipt"])) {
    return 0.06;
  }

  return 0;
}

function tokenizeEvidenceText(text: string): Set<string> {
  const stopWords = new Set([
    "and",
    "com",
    "for",
    "from",
    "inc",
    "last",
    "llc",
    "order",
    "payment",
    "purchase",
    "purchased",
    "receipt",
    "retailer",
    "the",
    "www",
    "your"
  ]);

  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stopWords.has(token))
  );
}

function compactEvidenceText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function tokenCoverage(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  return [...left].filter((token) => right.has(token)).length / left.size;
}

function hasAnyToken(tokens: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => tokens.has(candidate));
}

function absoluteDayDistance(sourceDate: string | undefined, transactionDate: string): number | null {
  if (!sourceDate) {
    return null;
  }

  const sourceTime = Date.parse(`${sourceDate.slice(0, 10)}T12:00:00Z`);
  const transactionTime = Date.parse(`${transactionDate}T12:00:00Z`);

  if (!Number.isFinite(sourceTime) || !Number.isFinite(transactionTime)) {
    return null;
  }

  return Math.abs(Math.round((transactionTime - sourceTime) / 86_400_000));
}

function normalizeCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

function normalizeEmoji(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, 16);
}

/**
 * Lenient read-path hydration: accepts palette tokens or any structurally
 * valid CSS color (see `isValidCssColor`), silently drops anything else. Used
 * when reading rows back out of the DB, where the value was already
 * validated at write time (via `assertValidRegistryColorInput` below) — this
 * stays non-throwing so a legacy/corrupted row can never take down
 * `listCategories`, it just falls back to the caller's default color.
 */
function normalizeRegistryColor(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  return isCategoryColor(trimmed) || isValidCssColor(trimmed) ? trimmed : undefined;
}

/**
 * Write-path validation for user-supplied category/tag colors. Empty/absent
 * input is not an error — callers treat `undefined` as "keep the existing
 * color" (update) or "auto-assign one" (create). A non-empty value that
 * fails the `isValidCssColor` trust-boundary check IS an error: it throws so
 * the API route's existing try/catch surfaces a 400, instead of the old
 * behavior of silently discarding the picked color and keeping the previous
 * one — which is what made the palette-only picker restriction look like a
 * persistence bug in the first place.
 */
function assertValidRegistryColorInput(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (isCategoryColor(trimmed) || isValidCssColor(trimmed)) {
    return trimmed;
  }

  throw new Error(`Invalid category color value: "${trimmed}".`);
}

function normalizeSortOrder(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(100_000, Math.round(value)));
}

function normalizeTagName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 64);
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((tag) => (typeof tag === "string" ? [tag] : []));
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.flatMap((tag) => (typeof tag === "string" ? [tag] : [])) : [];
    } catch {
      return [];
    }
  }

  return [];
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  return {};
}

function normalizeSyncIntervalMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    return 240;
  }

  return Math.min(Math.max(Math.round(value), 15), 10_080);
}

function boundedInteger(value: number, defaultValue: number, maxValue: number): number {
  const parsed = Number.isFinite(value) ? value : defaultValue;
  return Math.min(Math.max(Math.trunc(parsed), 1), maxValue);
}

function addMinutesIso(timestamp: string, minutes: number): string {
  const parsed = Date.parse(timestamp);
  const base = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(base + normalizeSyncIntervalMinutes(minutes) * 60_000).toISOString();
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .slice(0, 20)
    )
  );
}

function replaceTagName(tags: string[], oldName: string, newName: string): string[] {
  const oldKey = oldName.toLowerCase();
  const seen = new Set<string>();
  const renamed: string[] = [];

  for (const tag of tags) {
    const candidate = tag.toLowerCase() === oldKey ? newName : tag;
    const key = candidate.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    renamed.push(candidate);
  }

  return renamed;
}

function moneyToMinor(value: number): number {
  return Math.round(value * 100);
}

function minorToMoney(value: number): number {
  return Math.round(value) / 100;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableIdSuffix(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 24);
}

function sourceItemId(sourceId: string, externalId: string): string {
  return `src_item_${stableIdSuffix(`${sourceId}:${externalId}`)}`;
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => value.toFixed(6)).join(",")}]`;
}
