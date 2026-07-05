export type CurrencyCode = string;

export type ProviderId = "teller" | "manual";

export type ProviderStatus =
  | "not_configured"
  | "connected"
  | "syncing"
  | "stale"
  | "error";

export interface ProviderConnection {
  id: string;
  provider: ProviderId;
  displayName: string;
  status: ProviderStatus;
  configured: boolean;
  lastSyncedAt?: string;
  staleAfter?: string;
  errorMessage?: string;
}

export type AccountType =
  | "checking"
  | "savings"
  | "credit_card"
  | "investment"
  | "loan"
  | "cash";

export interface Account {
  id: string;
  providerConnectionId: string;
  groupId: string;
  name: string;
  institutionName: string;
  type: AccountType;
  mask?: string;
  currency: CurrencyCode;
  currentBalance: number;
  availableBalance?: number;
  includedInNetWorth: boolean;
  lastUpdatedAt: string;
}

export interface AccountGroup {
  id: string;
  name: string;
  description?: string;
  accountIds: string[];
  currency: CurrencyCode;
  totalBalance: number;
  includedInNetWorth: boolean;
  sortOrder: number;
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
  icon: string;
  color: string;
  budgetAmount?: number;
  sortOrder: number;
}

export type TransactionStatus = "pending" | "posted";

export interface Transaction {
  id: string;
  accountId: string;
  providerConnectionId: string;
  date: string;
  authorizedDate?: string;
  postedDate?: string;
  merchantName: string;
  description: string;
  amount: number;
  currency: CurrencyCode;
  categoryId: string;
  status: TransactionStatus;
  reviewed: boolean;
  tags: string[];
  notes?: string;
  pendingTransactionId?: string;
}

export type RecurringCadence =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "annual";

export type RecurringStatus = "active" | "paused" | "watching";

export interface RecurringItem {
  id: string;
  name: string;
  categoryId: string;
  accountId?: string;
  cadence: RecurringCadence;
  amount: number;
  averageAmount: number;
  currency: CurrencyCode;
  nextDate: string;
  lastChargedAt?: string;
  status: RecurringStatus;
}

export interface DashboardTopCategory {
  categoryId: string;
  amount: number;
  transactionCount: number;
  budgetAmount?: number;
}

export interface DashboardSummary {
  asOf: string;
  currency: CurrencyCode;
  netWorth: number;
  cashBalance: number;
  creditBalance: number;
  monthlyIncome: number;
  monthlySpending: number;
  transactionsToReview: number;
  pendingTransactionCount: number;
  topCategories: DashboardTopCategory[];
  upcomingRecurringIds: string[];
  providerConnectionIds: string[];
}

export type ExternalSourceKind =
  | "gmail"
  | "outlook_email"
  | "amazon_orders"
  | "instacart"
  | "airbnb"
  | "user_note"
  | "voice_note";

export type ExternalSourceStatus = "not_configured" | "connected" | "syncing" | "stale" | "error";

export interface ExternalSource {
  id: string;
  kind: ExternalSourceKind;
  displayName: string;
  status: ExternalSourceStatus;
  configured: boolean;
  command?: string;
  lastSyncedAt?: string;
  cursor?: string;
}

export type SourceItemKind =
  | "email"
  | "receipt"
  | "order"
  | "grocery_order"
  | "calendar_event"
  | "travel_listing"
  | "travel_booking"
  | "context_note"
  | "voice_transcript";

export interface SourceItem {
  id: string;
  sourceId: string;
  externalId: string;
  kind: SourceItemKind;
  occurredAt?: string;
  title: string;
  summary: string;
  merchantName?: string;
  amount?: number;
  currency?: CurrencyCode;
}

export type EvidenceRelationship = "receipt" | "order" | "merchant_context" | "travel_context" | "user_context";

export interface TransactionEvidenceLink {
  transactionId: string;
  sourceItemId: string;
  relationship: EvidenceRelationship;
  confidence: number;
  status: "suggested" | "accepted" | "dismissed";
  createdAt: string;
}

export type TransactionRuleMatchField = "merchant_name" | "description" | "merchant_or_description";
export type TransactionRuleMatchOperator = "contains" | "equals" | "regex";

export interface TransactionRule {
  id: string;
  name: string;
  enabled: boolean;
  matchField: TransactionRuleMatchField;
  matchOperator: TransactionRuleMatchOperator;
  pattern: string;
  categoryId?: string;
  tags: string[];
  markReviewed: boolean;
  createdAt: string;
  updatedAt: string;
  lastAppliedAt?: string;
  lastAppliedCount: number;
}

export type EnrichmentSuggestionAction = "set_category" | "add_tags" | "mark_reviewed" | "create_rule";
export type EnrichmentSuggestionStatus = "pending" | "applied" | "dismissed";

export interface EnrichmentSuggestion {
  id: string;
  transactionId?: string;
  action: EnrichmentSuggestionAction;
  status: EnrichmentSuggestionStatus;
  confidence: number;
  categoryId?: string;
  tags: string[];
  ruleName?: string;
  ruleMatchField?: TransactionRuleMatchField;
  ruleMatchOperator?: TransactionRuleMatchOperator;
  rulePattern?: string;
  markReviewed: boolean;
  reason: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
}
