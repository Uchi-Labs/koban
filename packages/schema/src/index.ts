export type CurrencyCode = string;

export type ProviderId = "snaptrade" | "simplefin" | "plaid" | "financekit" | "copilot" | "manual";

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

export interface InvestmentPosition {
  id: string;
  accountId: string;
  symbol: string;
  description: string;
  units: number;
  price?: number;
  /**
   * Average purchase price *per share/unit* (SnapTrade `AccountPosition.cost_basis`,
   * which is per-unit for equities and per-contract for options — not the total book
   * cost of the lot). Multiply by `units` for the position's total cost basis. Absent
   * when the provider does not report it or the position predates cost-basis capture.
   */
  costBasis?: number;
  currency: CurrencyCode;
  marketValue: number;
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
  emoji?: string;
  color: string;
  archived?: boolean;
  budgetAmount?: number;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * `user` — a tag a person created or applied (manual tag, rule action, tag
 * popover "Create ..."). `source` — a machine tag a sync adapter attaches to
 * a transaction (`simplefin`, `plaid`, `snaptrade`, ...). Source
 * tags stay on the transaction and remain searchable/filterable; UI surfaces
 * that list "tags to apply" (row chips, add-tags popover) show `user` tags
 * only, while the transaction inspector still exposes `source` tags, muted
 * and clearly secondary.
 */
export type TagKind = "user" | "source";

export interface TagStyle {
  name: string;
  color?: string;
  kind: TagKind;
  createdAt?: string;
  updatedAt?: string;
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
  /** User overlay: the goal this transaction is assigned to (Copilot mirrors `financial_goal_id` on the transaction). Survives provider resync. */
  financialGoalId?: string;
  /**
   * The counterpart transaction this one is hard-linked to as an internal
   * transfer (Copilot's `internal_tx_match`): the credit-card payment credit ↔
   * the bank debit. Set by the pair matcher; survives provider resync.
   */
  pairedTransactionId?: string;
}

export type FinancialGoalState = "active" | "archived";

export interface FinancialGoal {
  id: string;
  name: string;
  emoji?: string;
  /** Optional target in minor units (cents). */
  targetAmountMinor?: number;
  state: FinancialGoalState;
  createdAt: string;
  updatedAt: string;
}

export interface AgentConversation {
  id: string;
  title: string;
  autoTitled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AgentConversationRole = "user" | "assistant";

export interface AgentConversationTurn {
  id: string;
  conversationId: string;
  role: AgentConversationRole;
  content: string;
  meta?: unknown;
  createdAt: string;
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
  /** The most recent charge, positive. Differs from averageAmount after a price change. */
  lastAmount?: number;
  /** The price before the latest change, positive, when the price changed and has held since. */
  previousAmount?: number;
  /** Date of the first charge at the current price, when the price changed. */
  priceChangedAt?: string;
  /** How many charges the pattern was read from. */
  chargeCount?: number;
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
  | "icloud_mail"
  | "gmail"
  | "outlook_email"
  | "amazon_orders"
  | "instacart"
  | "airbnb"
  | "shop_orders"
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

/**
 * One line of an itemized receipt, order, or invoice, as the context source states it.
 * Amounts are positive prices paid, in the source item's currency.
 */
export interface SourceItemLine {
  name: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  sku?: string;
}

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
  /** Itemized lines, when the source provides them. Absent means the source did not say. */
  lines?: SourceItemLine[];
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
