"use client";

import type { Category, SourceItemLine, TagStyle } from "@ai-finances/schema";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  Ban,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  Download,
  RefreshCw,
  Eraser,
  Flag,
  Link2,
  Mic,
  Pencil,
  Plus,
  Search,
  Shapes,
  Tag,
  Target,
  X
} from "lucide-react";
import { useSyncControls } from "@/components/sync-provider";
import Link from "next/link";
import { toast } from "sonner";
import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Amount } from "@/components/amount";
import { ItemizedLines } from "@/components/itemized-lines";
import { CategoryPill } from "@/components/category-pill";
import { CategoryPicker } from "@/components/ui/category-picker";
import { VoiceWaveform } from "@/components/ui/voice-waveform";
import { showCategoryChangedCard } from "@/components/category-changed-card";
import { NewRuleDialog } from "@/components/new-rule-dialog";
import { deriveRuleMatchValue } from "@/lib/rule-match";
import { TagChip } from "@/components/tag-chip";
import { tagStyleMap } from "@/components/tag-style-map";
import { TransactionTagPopover, type TagOption } from "@/components/transaction-tag-popover";
import { TransactionGoalPopover, type FinancialGoal } from "@/components/transaction-goal-popover";
import { ExpandableActionBar } from "@/components/motion/expandable-action-bar";
import { OverflowActions } from "@/components/motion/overflow-actions";
import { RangeSlider } from "@/components/motion/range-slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { EmptyState } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Card as IconiqCard, CardContent as IconiqCardContent } from "@/components/ui/iconiq-card";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SwipeableRow, useCoarsePointer } from "@/components/ui/swipeable-list";
import { StatefulButton, type ButtonState } from "@/components/ui/stateful-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { AvatarHoverGroup, AvatarHoverItem, TextSwap } from "@/components/ui/motion-recipes";
import { normalizeCurrencyCode } from "@/lib/currency";
import { BloomColorPicker } from "@/components/ui/bloom-color-picker";
import { runInputClearDissolve } from "@/lib/transitions";
import { isReviewActionableTransaction } from "@/lib/transaction-classification";
import { playClose, playOpen, playSelect, playSuccess } from "@/lib/ui-sound";
import { cn } from "@/lib/utils";
import type { TransactionView } from "@/lib/view-models";

interface TransactionEvidenceView {
  confidence: number;
  createdAt?: string;
  relationship: string;
  sourceItem: {
    amount?: number;
    currency?: string;
    id: string;
    kind: string;
    lines?: SourceItemLine[];
    merchantName?: string;
    occurredAt?: string;
    summary: string;
    title: string;
  };
  status: "accepted" | "dismissed" | "suggested";
}

interface TagStyleApiResponse {
  color?: string | null;
  created_at?: string;
  error?: string;
  kind?: string;
  name?: string;
  updated_at?: string;
}

interface TransactionEvidenceApiResponse {
  data: Array<{
    confidence: number;
    created_at?: string;
    relationship: string;
    source_item: {
      amount?: number | null;
      currency?: string | null;
      id: string;
      kind: string;
      lines?: Array<{ amount: number | null; category_id?: string | null; name: string; quantity: number | null; sku: string | null; unit_price: number | null }> | null;
      merchant_name?: string;
      occurred_at?: string;
      summary: string;
      title: string;
    };
    status: TransactionEvidenceView["status"];
  }>;
}

interface SourceItemSearchView {
  amount?: number;
  currency?: string;
  id: string;
  kind: string;
  merchantName?: string;
  occurredAt?: string;
  sourceId: string;
  summary: string;
  title: string;
}

interface DraftValueState {
  transactionId: string;
  value: string;
}

interface LinkEvidenceSearchState {
  loading: boolean;
  query: string;
  results: SourceItemSearchView[];
  searched: boolean;
  transactionId: string;
}

interface VoiceRecordingState {
  recording: boolean;
  transactionId: string;
}

const EMPTY_SOURCE_ITEM_SEARCH_RESULTS: SourceItemSearchView[] = [];

interface SourceItemsApiResponse {
  data: Array<{
    amount?: number | null;
    currency?: string | null;
    id: string;
    kind: string;
    merchant_name?: string;
    occurred_at?: string;
    source_id: string;
    summary: string;
    title: string;
  }>;
}

interface TransactionApiCategory {
  archived?: boolean;
  budget_amount?: number;
  color?: string;
  emoji?: string;
  icon?: string;
  id: string;
  name: string;
  parent_id?: string;
  sort_order?: number;
}

interface TransactionApiItem {
  account_id: string;
  account_name: string;
  amount: number;
  authorized_date?: string;
  category?: TransactionApiCategory;
  category_id: string;
  currency: string;
  date: string;
  description: string;
  financial_goal_id: string | null;
  id: string;
  merchant_name: string;
  needs_review: boolean;
  notes?: string;
  object: "transaction";
  paired_transaction_id?: string | null;
  pending_transaction_id?: string;
  posted_date?: string;
  provider_connection_id: string;
  reviewed: boolean;
  status: "pending" | "posted";
  tags: string[];
}

interface TransactionsApiResponse {
  data: TransactionApiItem[];
  has_more: boolean;
  object: "list";
  total_count?: number;
}

interface TransactionWindowResult {
  hasMore: boolean;
  rows: TransactionView[];
  totalCount?: number;
}

interface TransactionWindowState {
  error: string;
  filterKey: string;
  hasMore: boolean;
  loading: boolean;
  rows: TransactionView[];
  totalCount?: number;
}

interface TransactionWindowRequest {
  accountId?: string;
  categoryId: string;
  limit: number;
  maxAmount: string;
  minAmount: string;
  query: string;
  referenceDate?: string;
  reviewFilter: TransactionReviewFilter;
  signal?: AbortSignal;
  startingAfter?: string;
}

interface TransactionGroupItem {
  key: string;
  label?: string;
  transaction?: TransactionView;
  type: "header" | "row";
}

interface TransactionPatchApiResponse {
  category?: { color?: string; icon?: string; id?: string; name?: string; sort_order?: number };
  category_id?: string;
  error?: string;
  reviewed?: boolean;
  tags?: string[];
  transaction?: {
    categoryId?: string;
    reviewed?: boolean;
    tags?: string[];
  };
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike | undefined;
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type TransactionReviewFilter = "actionable" | "all" | "reviewed";
type TransactionTab = "all" | "review";

const REVIEW_FILTER_ITEMS = [
  { label: "All review states", value: "all" },
  { label: "Needs review", value: "actionable" },
  { label: "Reviewed", value: "reviewed" }
] satisfies Array<{ label: string; value: TransactionReviewFilter }>;

const transactionLongDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  weekday: "long",
  year: "numeric"
});

interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

interface TransactionsViewProps {
  categories: Category[];
  initialAccountId?: string;
  initialCategoryId?: string;
  initialMaxAmount?: string;
  initialMinAmount?: string;
  initialQuery?: string;
  initialReviewFilter?: TransactionReviewFilter;
  initialSelectedTransactionId?: string;
  initialTab?: TransactionTab;
  reviewTotalCount?: number;
  reviewTransactions?: TransactionView[];
  reviewTransactionsHasMore?: boolean;
  tagStyles?: TagStyle[];
  transactionWindowSize?: number;
  transactions: TransactionView[];
  transactionsHasMore?: boolean;
  windowed?: boolean;
}

export function TransactionsView(props: TransactionsViewProps) {
  const model = useTransactionsViewModel(props);
  return <TransactionsViewLayout model={model} />;
}

function resetButtonState(setState: (state: ButtonState) => void) {
  window.setTimeout(() => setState("idle"), 1400);
}

// The inspector column needs the workspace itself to be wide, not the window:
// a docked finance agent can leave a large window with a narrow workspace.
// Matches the @5xl/workspace (64rem) container query on the layout below.
const INSPECTOR_COLUMN_MIN_WIDTH = 1024;

function useCompactWorkspace() {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const workspace = document.querySelector<HTMLElement>('[data-testid="transactions-page"]');
    if (!workspace) {
      return;
    }

    // A zero width means the workspace isn't laid out yet, not that it's narrow.
    const update = () => {
      const width = workspace.getBoundingClientRect().width;
      setCompact(width > 0 && width < INSPECTOR_COLUMN_MIN_WIDTH);
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  return compact;
}

async function loadGoalDirectory() {
  const response = await fetch("/api/v1/goals", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`goals_unavailable_${response.status}`);
  }
  const body = (await response.json()) as {
    data?: Array<{ emoji?: string; id: string; name: string; state?: string; target_amount_cents?: number }>;
  };
  return new Map((body.data ?? []).map((goal) => [goal.id, { ...goal } satisfies FinancialGoal]));
}

async function loadAiSuggestionState() {
  const response = await fetch("/api/v1/enrichment/provider", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`enrichment_provider_unavailable_${response.status}`);
  }
  return (await response.json()) as { configured?: boolean; error_message?: string };
}

function useTransactionsViewModel({
  categories,
  initialAccountId,
  initialCategoryId,
  initialMaxAmount,
  initialMinAmount,
  initialQuery,
  initialReviewFilter = "all",
  initialSelectedTransactionId,
  initialTab = "all",
  reviewTotalCount: initialReviewTotalCount,
  reviewTransactions: initialReviewTransactions,
  reviewTransactionsHasMore = false,
  tagStyles: initialTagStyles = [],
  transactionWindowSize = 200,
  transactions,
  transactionsHasMore = false,
  windowed = false
}: TransactionsViewProps) {
  const [tab, setTab] = useState<TransactionTab>(initialTab);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? "all");
  const [reviewFilter, setReviewFilter] = useState<TransactionReviewFilter>(initialReviewFilter);
  const [minAmount, setMinAmount] = useState(initialMinAmount ?? "");
  const [maxAmount, setMaxAmount] = useState(initialMaxAmount ?? "");
  const accountId = initialAccountId;
  const allRowsFilterKey = transactionWindowFilterKey({
    accountId,
    categoryId,
    maxAmount,
    minAmount,
    query,
    reviewFilter
  });
  const reviewRowsFilterKey = transactionWindowFilterKey({
    accountId,
    categoryId,
    maxAmount,
    minAmount,
    query,
    reviewFilter: "actionable"
  });
  const [transactionWindow, setTransactionWindow] = useState<TransactionWindowState>(() => ({
    error: "",
    filterKey: allRowsFilterKey,
    hasMore: transactionsHasMore,
    loading: false,
    rows: transactions
  }));
  const [reviewWindow, setReviewWindow] = useState<TransactionWindowState>(() => ({
    error: "",
    filterKey: reviewRowsFilterKey,
    hasMore: reviewTransactionsHasMore,
    loading: false,
    rows: initialReviewTransactions ?? transactions.filter(isReviewActionableTransaction),
    totalCount: initialReviewTotalCount
  }));
  const rows = transactionWindow.rows;
  const rowsHasMore = transactionWindow.hasMore;
  const rowsLoading = transactionWindow.loading;
  const rowsError = transactionWindow.error;
  const reviewRows = reviewWindow.rows;
  const reviewRowsHasMore = reviewWindow.hasMore;
  const reviewRowsLoading = reviewWindow.loading;
  const reviewRowsError = reviewWindow.error;
  const amountRangeMax = useMemo(() => p95AmountRangeMax(rows), [rows]);
  const rowsAreCurrent = !windowed || transactionWindow.filterKey === allRowsFilterKey;
  const reviewRowsAreCurrent = !windowed || reviewWindow.filterKey === reviewRowsFilterKey;

  function updateRows(updater: (currentRows: TransactionView[]) => TransactionView[]) {
    setTransactionWindow((currentWindow) => ({
      ...currentWindow,
      rows: updater(currentWindow.rows)
    }));
    setReviewWindow((currentWindow) => {
      const nextRows = updater(currentWindow.rows).filter(isReviewActionableTransaction);
      const removed = currentWindow.rows.length - nextRows.length;
      return {
        ...currentWindow,
        rows: nextRows,
        totalCount:
          currentWindow.totalCount === undefined
            ? undefined
            : Math.max(0, currentWindow.totalCount - Math.max(0, removed))
      };
    });
  }

  function updateRowsOptimistically(updater: (currentRows: TransactionView[]) => TransactionView[]) {
    setTransactionWindow((currentWindow) => ({
      ...currentWindow,
      rows: updater(currentWindow.rows)
    }));
    setReviewWindow((currentWindow) => ({
      ...currentWindow,
      rows: updater(currentWindow.rows)
    }));
  }

  const initialSelectedTransaction =
    transactions.find((transaction) => transaction.id === initialSelectedTransactionId) ??
    transactions.find((transaction) =>
      transactionMatchesInitialFilters(transaction, {
        accountId,
        categoryId: initialCategoryId,
        query: initialQuery,
        reviewFilter: initialReviewFilter
      })
    ) ?? transactions[0];
  const [selectedId, setSelectedId] = useState(initialSelectedTransaction?.id ?? "");
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<string>>(() => new Set());
  const [inspectorOpen, setInspectorOpen] = useState(transactions.length > 0);
  // The desktop pane shows the first row by default; the phone sheet covers the
  // list, so it waits for a row tap or a deep-linked transaction.
  const [inspectorRequested, setInspectorRequested] = useState(Boolean(initialSelectedTransactionId));
  const [inspectorFocusTarget, setInspectorFocusTarget] = useState<"category" | "tag" | null>(null);
  const [newRuleContext, setNewRuleContext] = useState<{ category: Category; merchant: string } | null>(null);
  const [evidenceItems, setEvidenceItems] = useState<TransactionEvidenceView[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [inspectorMessage, setInspectorMessage] = useState("");
  const [noteSaveState, setNoteSaveState] = useState<ButtonState>("idle");
  const [reviewToggleState, setReviewToggleState] = useState<ButtonState>("idle");
  const [linkEvidenceState, setLinkEvidenceState] = useState<LinkEvidenceSearchState>(() => ({
    loading: false,
    query: "",
    results: EMPTY_SOURCE_ITEM_SEARCH_RESULTS,
    searched: false,
    transactionId: initialSelectedTransaction?.id ?? ""
  }));
  const [noteDraftState, setNoteDraftState] = useState<DraftValueState>(() => ({
    transactionId: initialSelectedTransaction?.id ?? "",
    value: initialSelectedTransaction?.notes ?? ""
  }));
  const [tagDraftState, setTagDraftState] = useState<DraftValueState>(() => ({
    transactionId: initialSelectedTransaction?.id ?? "",
    value: ""
  }));
  const [voiceDraftState, setVoiceDraftState] = useState<DraftValueState>(() => ({
    transactionId: initialSelectedTransaction?.id ?? "",
    value: ""
  }));
  const [voiceStatusState, setVoiceStatusState] = useState<DraftValueState>(() => ({
    transactionId: initialSelectedTransaction?.id ?? "",
    value: ""
  }));
  const [voiceRecordingState, setVoiceRecordingState] = useState<VoiceRecordingState>(() => ({
    recording: false,
    transactionId: initialSelectedTransaction?.id ?? ""
  }));
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceTransactionIdRef = useRef("");

  // Review tab state.
  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(() => new Set());
  const [reviewBusy, setReviewBusy] = useState(false);
  const [bulkReviewState, setBulkReviewState] = useState<ButtonState>("idle");
  const [bulkMutationBusy, setBulkMutationBusy] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const { showToast, updateToast } = useToast();
  const [tagStyles, setTagStyles] = useState<TagStyle[]>(initialTagStyles);
  // Per-transaction goal assignment overlay for THIS session: a value of `null`
  // means the user explicitly unassigned during this session (must win over the
  // server-hydrated `goalsById` lookup below); an absent key means "trust the
  // server" (`transaction.financialGoalId` resolved through `goalsById`).
  const [goalByTxId, setGoalByTxId] = useState<Map<string, FinancialGoal | null>>(() => new Map());
  // Full goal directory (id -> goal), hydrated once so rows can resolve the
  // `financial_goal_id` persisted on each transaction into a name/emoji without
  // the API needing to inline the whole goal object on every transaction.
  const [goalsById, setGoalsById] = useState<Map<string, FinancialGoal>>(() => new Map());

  // Hydrate the goal directory once so rows carrying a persisted
  // `financialGoalId` (from SSR or a windowed re-fetch) can resolve to a
  // name/emoji immediately — this is what makes goal assignment survive a
  // hard reload instead of only living in the local `goalByTxId` overlay.
  useEffect(() => {
    let active = true;

    loadGoalDirectory()
      .then((directory) => {
        if (!active) {
          return;
        }
        setGoalsById(directory);
      })
      .catch(() => {
        // Goals sync still pending or offline — rows fall back to showing no
        // goal pill until the next successful hydration.
      });

    return () => {
      active = false;
    };
  }, []);

  // AI "Suggest" affordance in the CategoryPicker's New category modal needs to
  // know whether an LLM provider is actually configured — mirrors how
  // app/categories/page.tsx sources `aiProvider.configured` /
  // `aiProvider.errorMessage` from `getEffectiveLlmEnrichmentStatus()`, but via
  // the client-fetchable /api/v1/enrichment/provider route since this is a
  // client component fed by the SSR transactions page, not the categories page.
  const [aiSuggestionEnabled, setAiSuggestionEnabled] = useState(false);
  const [aiSuggestionMessage, setAiSuggestionMessage] = useState("No AI provider configured.");

  useEffect(() => {
    let active = true;

    loadAiSuggestionState()
      .then((body) => {
        if (!active) {
          return;
        }
        setAiSuggestionEnabled(Boolean(body.configured));
        setAiSuggestionMessage(body.error_message ?? "No AI provider configured.");
      })
      .catch(() => {
        // Leave the safe default (disabled) — the AI "Suggest" affordance
        // simply stays hidden until the provider status is known.
      });

    return () => {
      active = false;
    };
  }, []);

  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const tagStyleByName = useMemo(() => tagStyleMap(tagStyles), [tagStyles]);

  // Merchants currently sitting in the catch-all "Other" category — feeds the
  // New category modal's bulk-recategorize suggestion, mirroring
  // app/categories/page.tsx's `uncategorizedMerchants` derivation but scoped to
  // whatever transaction rows this client instance actually has loaded.
  const uncategorizedMerchants = useMemo(() => {
    const merchants = new Set<string>();
    for (const transaction of rows) {
      if (transaction.categoryId === "cat_other" && transaction.merchantName) {
        merchants.add(transaction.merchantName);
      }
      if (merchants.size >= 12) {
        break;
      }
    }
    return Array.from(merchants);
  }, [rows]);

  // Every *user* tag the user has ever applied or styled — the row/add-tags
  // popover lists this set with each tag's colored dot (Copilot parity).
  // `kind: "source"` tags (simplefin, plaid, plaid:card_payment, ...) are
  // machine tags a sync adapter attached — they stay on the transaction and
  // stay searchable, but they don't belong in a list of tags a person picks
  // to apply, so they're excluded here. A tag with no registry row yet
  // (shouldn't normally happen — every write path registers one) defaults to
  // visible, matching the "everything else stays user" backfill rule.
  const allTagOptions = useMemo<TagOption[]>(() => {
    const options = new Map<string, TagOption>();
    for (const style of tagStyles) {
      if (style.kind === "source") {
        continue;
      }
      options.set(style.name.toLowerCase(), { color: style.color, name: style.name });
    }
    for (const row of rows) {
      for (const tag of row.tags) {
        const key = tag.toLowerCase();
        if (options.has(key)) {
          continue;
        }
        if (tagStyleByName.get(key)?.kind === "source") {
          continue;
        }
        options.set(key, { color: tagStyleByName.get(key)?.color, name: tag });
      }
    }
    return Array.from(options.values());
  }, [rows, tagStyles, tagStyleByName]);

  useEffect(() => {
    if (!windowed || transactionWindow.filterKey === allRowsFilterKey) {
      return;
    }

    const controller = new AbortController();

    setTransactionWindow((currentWindow) => ({
      ...currentWindow,
      error: "",
      hasMore: false,
      loading: true,
      rows: []
    }));

    fetchTransactionWindow({
      accountId,
      categoryId,
      limit: transactionWindowSize,
      maxAmount,
      minAmount,
      query,
      reviewFilter,
      signal: controller.signal
    })
      .then((result) => {
        setTransactionWindow({
          error: "",
          filterKey: allRowsFilterKey,
          hasMore: result.hasMore,
          loading: false,
          rows: result.rows
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setTransactionWindow((currentWindow) => ({
            ...currentWindow,
            error: error instanceof Error ? error.message : "Unable to load transactions.",
            loading: false
          }));
        }
      });

    return () => controller.abort();
  }, [
    accountId,
    allRowsFilterKey,
    categoryId,
    maxAmount,
    minAmount,
    query,
    reviewFilter,
    transactionWindowSize,
    transactionWindow.filterKey,
    windowed
  ]);

  useEffect(() => {
    if (!windowed || reviewWindow.filterKey === reviewRowsFilterKey) {
      return;
    }

    const controller = new AbortController();

    setReviewWindow((currentWindow) => ({
      ...currentWindow,
      error: "",
      hasMore: false,
      loading: true,
      rows: []
    }));

    fetchTransactionWindow({
      accountId,
      categoryId,
      limit: transactionWindowSize,
      maxAmount,
      minAmount,
      query,
      reviewFilter: "actionable",
      signal: controller.signal
    })
      .then((result) => {
        setReviewWindow({
          error: "",
          filterKey: reviewRowsFilterKey,
          hasMore: result.hasMore,
          loading: false,
          rows: result.rows,
          totalCount: result.totalCount
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setReviewWindow((currentWindow) => ({
            ...currentWindow,
            error: error instanceof Error ? error.message : "Unable to load review transactions.",
            loading: false
          }));
        }
      });

    return () => controller.abort();
  }, [
    accountId,
    categoryId,
    maxAmount,
    minAmount,
    query,
    reviewWindow.filterKey,
    reviewRowsFilterKey,
    transactionWindowSize,
    windowed
  ]);

  const filteredTransactions = useMemo(() => {
    if (windowed) {
      return rowsAreCurrent ? rows : [];
    }

    const normalizedQuery = query.trim().toLowerCase();
    const minAmountValue = parseAmountFilter(minAmount);
    const maxAmountValue = parseAmountFilter(maxAmount);

    return rows.filter((transaction) => {
      const absoluteAmount = Math.abs(transaction.amount);
      const matchesQuery =
        normalizedQuery.length === 0 ||
        transaction.merchant.toLowerCase().includes(normalizedQuery) ||
        transaction.accountName.toLowerCase().includes(normalizedQuery) ||
        transaction.category?.name.toLowerCase().includes(normalizedQuery) ||
        transaction.description.toLowerCase().includes(normalizedQuery) ||
        transaction.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
      const matchesCategory = categoryId === "all" || transaction.category?.id === categoryId;
      const matchesAccount = !accountId || transaction.accountId === accountId;
      const matchesReviewFilter = transactionMatchesReviewFilter(transaction, reviewFilter);
      const matchesAmount =
        (minAmountValue === undefined || absoluteAmount >= minAmountValue) &&
        (maxAmountValue === undefined || absoluteAmount <= maxAmountValue);

      return matchesQuery && matchesCategory && matchesAccount && matchesReviewFilter && matchesAmount;
    });
  }, [accountId, categoryId, maxAmount, minAmount, query, reviewFilter, rows, rowsAreCurrent, windowed]);

  const selectedTransaction = inspectorOpen
    ? filteredTransactions.find((transaction) => transaction.id === selectedId) ?? filteredTransactions[0]
    : undefined;
  const selectedTransactionId = selectedTransaction?.id ?? "";
  const noteDraft =
    noteDraftState.transactionId === selectedTransactionId ? noteDraftState.value : (selectedTransaction?.notes ?? "");
  const tagDraft = tagDraftState.transactionId === selectedTransactionId ? tagDraftState.value : "";
  const linkEvidenceLoading =
    linkEvidenceState.transactionId === selectedTransactionId ? linkEvidenceState.loading : false;
  const linkEvidenceQuery = linkEvidenceState.transactionId === selectedTransactionId ? linkEvidenceState.query : "";
  const linkEvidenceResults =
    linkEvidenceState.transactionId === selectedTransactionId
      ? linkEvidenceState.results
      : EMPTY_SOURCE_ITEM_SEARCH_RESULTS;
  const linkEvidenceSearched =
    linkEvidenceState.transactionId === selectedTransactionId ? linkEvidenceState.searched : false;
  const voiceDraft = voiceDraftState.transactionId === selectedTransactionId ? voiceDraftState.value : "";
  const voiceStatus = voiceStatusState.transactionId === selectedTransactionId ? voiceStatusState.value : "";
  const voiceRecording =
    voiceRecordingState.transactionId === selectedTransactionId ? voiceRecordingState.recording : false;

  const groupedTransactions = useMemo(() => groupByDate(filteredTransactions), [filteredTransactions]);

  useEffect(() => {
    setSelectedTransactionIds((current) => {
      const visible = new Set(filteredTransactions.map((transaction) => transaction.id));
      const next = new Set(Array.from(current).filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filteredTransactions]);

  // Review tab: only actionable rows, honoring the shared search/account/category filters.
  const reviewTransactions = useMemo(() => {
    if (windowed) {
      return reviewRowsAreCurrent ? reviewRows : [];
    }

    const normalizedQuery = query.trim().toLowerCase();
    const minAmountValue = parseAmountFilter(minAmount);
    const maxAmountValue = parseAmountFilter(maxAmount);

    return rows.filter((transaction) => {
      if (!isReviewActionableTransaction(transaction)) {
        return false;
      }

      const absoluteAmount = Math.abs(transaction.amount);
      const matchesQuery =
        normalizedQuery.length === 0 ||
        transaction.merchant.toLowerCase().includes(normalizedQuery) ||
        transaction.accountName.toLowerCase().includes(normalizedQuery) ||
        transaction.category?.name.toLowerCase().includes(normalizedQuery) ||
        transaction.description.toLowerCase().includes(normalizedQuery) ||
        transaction.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
      const matchesCategory = categoryId === "all" || transaction.category?.id === categoryId;
      const matchesAccount = !accountId || transaction.accountId === accountId;
      const matchesAmount =
        (minAmountValue === undefined || absoluteAmount >= minAmountValue) &&
        (maxAmountValue === undefined || absoluteAmount <= maxAmountValue);

      return matchesQuery && matchesCategory && matchesAccount && matchesAmount;
    });
  }, [accountId, categoryId, maxAmount, minAmount, query, reviewRows, reviewRowsAreCurrent, rows, windowed]);

  const reviewGroups = useMemo(() => groupByMerchant(reviewTransactions), [reviewTransactions]);

  // Drop selections that are no longer in the actionable set (e.g. after marking reviewed or recategorizing).
  useEffect(() => {
    setSelectedReviewIds((current) => {
      const visible = new Set(reviewTransactions.map((transaction) => transaction.id));
      let changed = false;
      const next = new Set<string>();

      for (const id of current) {
        if (visible.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [reviewTransactions]);

  const hasActiveFilters =
    Boolean(accountId) ||
    query.trim().length > 0 ||
    categoryId !== "all" ||
    reviewFilter !== "all" ||
    minAmount.trim().length > 0 ||
    maxAmount.trim().length > 0;

  const allReviewSelected =
    reviewTransactions.length > 0 && reviewTransactions.every((transaction) => selectedReviewIds.has(transaction.id));
  const allTransactionsSelected =
    filteredTransactions.length > 0 && filteredTransactions.every((transaction) => selectedTransactionIds.has(transaction.id));

  return {
    accountId,
    allReviewSelected,
    allTransactionsSelected,
    amountRangeMax,
    bulkReviewState,
    bulkMutationBusy,
    categories,
    categoryId,
    evidenceItems,
    evidenceLoading,
    filteredTransactions,
    groupedTransactions,
    hasActiveFilters,
    inspectorOpen,
    inspectorRequested,
    inspectorMessage,
    linkEvidenceLoading,
    linkEvidenceQuery,
    linkEvidenceResults,
    linkEvidenceSearched,
    maxAmount,
    minAmount,
    noteDraft,
    noteSaveState,
    query,
    reviewBusy,
    reviewFilter,
    reviewGroups,
    reviewMessage,
    reviewToggleState,
    reviewTotalCount:
      windowed && reviewRowsAreCurrent && reviewWindow.totalCount !== undefined
        ? reviewWindow.totalCount
        : reviewTransactions.length,
    reviewTransactions,
    reviewTransactionsHasMore: reviewRowsHasMore,
    reviewTransactionsLoading: reviewRowsLoading,
    reviewTransactionsError: reviewRowsError,
    rows,
    rowsError,
    rowsHasMore,
    rowsLoading,
    selectedReviewIds,
    selectedTransactionIds,
    selectedTransaction,
    selectedTransactionId,
    inspectorFocusTarget,
    newRuleContext,
    tab,
    tagDraft,
    tagStyleByName,
    allTagOptions,
    aiSuggestionEnabled,
    aiSuggestionMessage,
    uncategorizedMerchants,
    goalByTxId,
    goalsById,
    voiceDraft,
    voiceRecording,
    voiceStatus,
    windowed,
    addTag,
    applyCategoryToAllMatching,
    bulkAddTag,
    bulkUpdateCategory,
    commitCategoryFromPicker,
    downloadTransactionsCsv,
    handleRuleCreated,
    linkSourceItem,
    loadMoreReviewTransactions,
    loadMoreTransactions,
    markTransactionsReviewed,
    saveContextNote,
    saveVoiceNote,
    searchSourceItems,
    selectTransaction,
    setCategoryId,
    setInspectorOpen,
    setInspectorFocusTarget,
    setLinkEvidenceState,
    setMaxAmount,
    setMinAmount,
    setNewRuleContext,
    setNoteDraftState,
    setQuery,
    setReviewFilter,
    setSelectedReviewIds,
    setSelectedTransactionIds,
    setTab,
    setTagDraftState,
    startVoiceRecognition,
    stopVoiceRecognition,
    toggleReviewGroup,
    toggleReviewRow,
    toggleReviewed,
    toggleSelectAllReview,
    toggleSelectAllTransactions,
    toggleTransactionRow,
    updateEvidenceStatus,
    updateTagColor,
    renameTagStyle,
    updateTransactionCategory,
    updateTransactionTags,
    toggleTransactionTagByName,
    assignTransactionGoal
  };

  function selectTransaction(transaction: TransactionView, options?: { focus?: "category" | "tag" }) {
    if (transaction.id !== selectedTransactionId) {
      stopVoiceRecognition();
    }

    if (inspectorOpen) {
      playSelect();
    } else {
      playOpen();
    }

    setSelectedId(transaction.id);
    setInspectorFocusTarget(options?.focus ?? null);
    setInspectorOpen(true);
    setInspectorRequested(true);
    setEvidenceItems([]);
    void refreshEvidence(transaction.id);
  }

  function toggleReviewRow(id: string, checked: boolean) {
    setSelectedReviewIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function toggleReviewGroup(group: MerchantGroup, checked: boolean) {
    setSelectedReviewIds((current) => {
      const next = new Set(current);
      for (const row of group.rows) {
        if (checked) {
          next.add(row.id);
        } else {
          next.delete(row.id);
        }
      }
      return next;
    });
  }

  function toggleSelectAllReview(checked: boolean) {
    setSelectedReviewIds(checked ? new Set(reviewTransactions.map((transaction) => transaction.id)) : new Set());
  }

  function toggleTransactionRow(id: string, checked: boolean) {
    setSelectedTransactionIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function toggleSelectAllTransactions(checked: boolean) {
    setSelectedTransactionIds(
      checked ? new Set(filteredTransactions.map((transaction) => transaction.id)) : new Set()
    );
  }

  function clearSelectedIds(ids: Iterable<string>) {
    const clearedIds = new Set(ids);
    const withoutCleared = (current: Set<string>) => {
      const next = new Set(current);
      for (const id of clearedIds) {
        next.delete(id);
      }
      return next;
    };

    setSelectedTransactionIds(withoutCleared);
    setSelectedReviewIds(withoutCleared);
  }

  async function loadMoreTransactions() {
    if (!windowed || rowsLoading || !rowsHasMore || transactionWindow.filterKey !== allRowsFilterKey) {
      return;
    }

    const cursor = rows.at(-1)?.id;

    if (!cursor) {
      return;
    }

    setTransactionWindow((currentWindow) => ({
      ...currentWindow,
      error: "",
      loading: true
    }));

    try {
      const result = await fetchTransactionWindow({
        accountId,
        categoryId,
        limit: transactionWindowSize,
        maxAmount,
        minAmount,
        query,
        reviewFilter,
        startingAfter: cursor
      });
      setTransactionWindow((currentWindow) => ({
        ...currentWindow,
        error: "",
        hasMore: result.hasMore,
        loading: false,
        rows: mergeTransactionRows(currentWindow.rows, result.rows)
      }));
    } catch (error) {
      setTransactionWindow((currentWindow) => ({
        ...currentWindow,
        error: error instanceof Error ? error.message : "Unable to load more transactions.",
        loading: false
      }));
    }
  }

  async function loadMoreReviewTransactions() {
    if (!windowed || reviewRowsLoading || !reviewRowsHasMore || reviewWindow.filterKey !== reviewRowsFilterKey) {
      return;
    }

    const cursor = reviewRows.at(-1)?.id;

    if (!cursor) {
      return;
    }

    setReviewWindow((currentWindow) => ({
      ...currentWindow,
      error: "",
      loading: true
    }));

    try {
      const result = await fetchTransactionWindow({
        accountId,
        categoryId,
        limit: transactionWindowSize,
        maxAmount,
        minAmount,
        query,
        reviewFilter: "actionable",
        startingAfter: cursor
      });
      setReviewWindow((currentWindow) => ({
        ...currentWindow,
        error: "",
        hasMore: result.hasMore,
        loading: false,
        totalCount: result.totalCount ?? currentWindow.totalCount,
        rows: mergeTransactionRows(currentWindow.rows, result.rows)
      }));
    } catch (error) {
      setReviewWindow((currentWindow) => ({
        ...currentWindow,
        error: error instanceof Error ? error.message : "Unable to load more review transactions.",
        loading: false
      }));
    }
  }

  async function markTransactionsReviewed(ids: string[]) {
    if (ids.length === 0 || reviewBusy) {
      return;
    }

    setReviewBusy(true);
    setBulkReviewState("loading");
    setReviewMessage(`Marking ${ids.length.toLocaleString()} transactions reviewed…`);
    const toastId = showToast({
      description: `Marking ${ids.length.toLocaleString()} transactions reviewed.`,
      duration: 0,
      status: "loading",
      title: "Review update started",
    });

    try {
      await Promise.all(
        ids.map(async (id) => {
          const response = await fetch(`/api/v1/transactions/${encodeURIComponent(id)}`, {
            body: JSON.stringify({ reviewed: true }),
            headers: { "Content-Type": "application/json" },
            method: "PATCH"
          });

          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? "Unable to mark transactions reviewed.");
          }
        })
      );

      const reviewedIds = new Set(ids);
      updateRows((currentRows) =>
        currentRows.map((row) => (reviewedIds.has(row.id) ? { ...row, needsReview: false, reviewed: true } : row))
      );
      setSelectedReviewIds((current) => {
        const next = new Set(current);
        for (const id of ids) {
          next.delete(id);
        }
        return next;
      });
      setSelectedTransactionIds((current) => {
        const next = new Set(current);
        for (const id of ids) {
          next.delete(id);
        }
        return next;
      });
      setReviewMessage(`${ids.length.toLocaleString()} transactions marked reviewed.`);
      setBulkReviewState("success");
      updateToast(toastId, {
        description: `${ids.length.toLocaleString()} transactions were marked reviewed.`,
        duration: 3600,
        status: "success",
        title: "Review updated",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unable to mark transactions reviewed.";
      setBulkReviewState("error");
      setReviewMessage(errorMessage);
      updateToast(toastId, {
        description: errorMessage,
        duration: 5200,
        status: "error",
        title: "Review update failed",
      });
    } finally {
      setReviewBusy(false);
      resetButtonState(setBulkReviewState);
    }
  }

  async function bulkUpdateCategory(ids: string[], nextCategoryId: string) {
    if (ids.length === 0 || bulkMutationBusy) {
      return;
    }

    const selectedIds = new Set(ids);
    const availableRowsById = new Map([...rows, ...reviewRows].map((transaction) => [transaction.id, transaction]));
    const selectedRows = ids.flatMap((id) => {
      const transaction = availableRowsById.get(id);
      return transaction ? [transaction] : [];
    });
    const nextCategory = categoryById.get(nextCategoryId);

    if (selectedRows.length === 0 || !nextCategory) {
      return;
    }

    const previousCategoryById = new Map(
      selectedRows.map((transaction) => [
        transaction.id,
        { category: transaction.category, categoryId: transaction.categoryId }
      ])
    );
    const succeeded = new Set<string>();
    const failed = new Set<string>();

    setBulkMutationBusy(true);
    updateRowsOptimistically((currentRows) =>
      currentRows.map((row) =>
        selectedIds.has(row.id)
          ? { ...row, category: nextCategory, categoryId: nextCategoryId }
          : row
      )
    );

    await Promise.all(
      selectedRows.map(async (transaction) => {
        const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transaction.id)}`, {
          body: JSON.stringify({ category_id: nextCategoryId }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH"
        }).catch(() => null);

        if (response?.ok) {
          succeeded.add(transaction.id);
        } else {
          failed.add(transaction.id);
        }
      })
    );

    if (failed.size > 0) {
      updateRowsOptimistically((currentRows) =>
        currentRows.map((row) => {
          const previous = previousCategoryById.get(row.id);
          return previous ? { ...row, ...previous } : row;
        })
      );
    }

    if (succeeded.size > 0) {
      updateRows((currentRows) =>
        currentRows.map((row) =>
          succeeded.has(row.id)
            ? { ...row, category: nextCategory, categoryId: nextCategoryId }
            : row
        )
      );
      clearSelectedIds(succeeded);
    }

    if (failed.size > 0) {
      toast.error(
        `${failed.size.toLocaleString()} of ${selectedRows.length.toLocaleString()} transactions could not be categorized.`
      );
    } else {
      toast.success(
        `${selectedRows.length.toLocaleString()} transaction${selectedRows.length === 1 ? "" : "s"} categorized as ${nextCategory.name}.`
      );
    }

    setBulkMutationBusy(false);
  }

  async function bulkAddTag(ids: string[], tagName: string) {
    const tag = tagName.trim();

    if (!tag || ids.length === 0 || bulkMutationBusy) {
      return;
    }

    const availableRowsById = new Map([...rows, ...reviewRows].map((transaction) => [transaction.id, transaction]));
    const selectedRows = ids.flatMap((id) => {
      const transaction = availableRowsById.get(id);
      return transaction ? [transaction] : [];
    });
    const previousTagsById = new Map(selectedRows.map((transaction) => [transaction.id, transaction.tags]));
    const optimisticTagsById = new Map(
      selectedRows.map((transaction) => [
        transaction.id,
        normalizeTags(
          transaction.tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase())
            ? transaction.tags
            : [...transaction.tags, tag]
        )
      ])
    );
    const savedTagsById = new Map<string, string[]>();
    const failed = new Set<string>();

    setBulkMutationBusy(true);
    updateRowsOptimistically((currentRows) =>
      currentRows.map((row) => {
        const nextTags = optimisticTagsById.get(row.id);
        return nextTags ? { ...row, tags: nextTags } : row;
      })
    );

    await Promise.all(
      selectedRows.map(async (transaction) => {
        const nextTags = optimisticTagsById.get(transaction.id) ?? transaction.tags;
        const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transaction.id)}`, {
          body: JSON.stringify({ tags: nextTags }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH"
        }).catch(() => null);

        if (!response?.ok) {
          failed.add(transaction.id);
          return;
        }

        const body = (await response.json().catch(() => ({}))) as TransactionPatchApiResponse;
        savedTagsById.set(transaction.id, body.tags ?? body.transaction?.tags ?? nextTags);
      })
    );

    if (failed.size > 0) {
      updateRowsOptimistically((currentRows) =>
        currentRows.map((row) => {
          const previousTags = failed.has(row.id) ? previousTagsById.get(row.id) : undefined;
          return previousTags ? { ...row, tags: previousTags } : row;
        })
      );
    }

    if (savedTagsById.size > 0) {
      updateRows((currentRows) =>
        currentRows.map((row) => {
          const nextTags = savedTagsById.get(row.id);
          return nextTags ? { ...row, tags: nextTags } : row;
        })
      );
      clearSelectedIds(savedTagsById.keys());
    }

    if (failed.size > 0) {
      toast.error(`${failed.size.toLocaleString()} transactions could not be tagged.`);
    } else {
      toast.success(
        `Added ${tag} to ${selectedRows.length.toLocaleString()} transaction${selectedRows.length === 1 ? "" : "s"}.`
      );
    }

    setBulkMutationBusy(false);
  }

  async function updateTransactionCategory(
    transactionId: string,
    nextCategoryId: string,
    options?: { silent?: boolean }
  ): Promise<boolean> {
    const nextCategory = categoryById.get(nextCategoryId);
    setReviewMessage("Saving category…");
    setInspectorMessage("Saving category…");

    const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transactionId)}`, {
      body: JSON.stringify({ category_id: nextCategoryId }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH"
    });
    const body = (await response.json().catch(() => ({}))) as TransactionPatchApiResponse;

    if (!response.ok) {
      setReviewMessage(body.error ?? "Unable to update category.");
      setInspectorMessage(body.error ?? "Unable to update category.");
      toast.error(body.error ?? "Unable to update category.");
      return false;
    }

    updateRows((currentRows) =>
      currentRows.map((row) =>
        row.id === transactionId
          ? { ...row, category: nextCategory ?? row.category, categoryId: nextCategoryId }
          : row
      )
    );
    setReviewMessage("Category updated.");
    setInspectorMessage("Category updated.");

    if (!options?.silent) {
      toast.success(nextCategory ? `Categorized as ${nextCategory.name}` : "Category updated");
    }

    return true;
  }

  // Picker commit path (row pill + inspector): commits the category, then surfaces
  // the "Category changed" quick-action card so the user can promote it to a rule
  // or apply it across matching transactions.
  async function commitCategoryFromPicker(transaction: TransactionView, nextCategoryId: string) {
    const changed = transaction.category?.id !== nextCategoryId;
    const nextCategory = categoryById.get(nextCategoryId);
    const saved = await updateTransactionCategory(transaction.id, nextCategoryId, { silent: changed });

    if (!saved || !changed) {
      return;
    }

    showCategoryChangedCard({
      merchant: transaction.merchant,
      onApplyAll: () => void applyCategoryToAllMatching(transaction.merchant, nextCategoryId),
      onCreateRule: () =>
        setNewRuleContext({ category: nextCategory ?? transaction.category, merchant: transaction.merchant })
    });
  }

  // One-shot bulk recategorize of every transaction matching the merchant, WITHOUT
  // persisting a rule. Reuses the rules-engine matcher server-side; patches the
  // exact rows the server reports as updated.
  async function applyCategoryToAllMatching(merchant: string, categoryId: string) {
    const matchValue = deriveRuleMatchValue(merchant);
    const nextCategory = categoryById.get(categoryId);

    const response = await fetch("/api/v1/transactions/bulk-categorize", {
      body: JSON.stringify({
        category_id: categoryId,
        field: "merchant_or_description",
        match: matchValue,
        operator: "contains"
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      transactions_updated?: number;
      updated_transaction_ids?: string[];
    };

    if (!response.ok) {
      toast.error(body.error ?? "Unable to apply category to matching transactions.");
      return;
    }

    const updatedIds = new Set(body.updated_transaction_ids ?? []);
    if (updatedIds.size > 0) {
      updateRows((currentRows) =>
        currentRows.map((row) =>
          updatedIds.has(row.id) ? { ...row, category: nextCategory ?? row.category, categoryId } : row
        )
      );
    }

    const count = body.transactions_updated ?? updatedIds.size;
    toast.success(
      count > 0
        ? `Applied to ${count.toLocaleString()} “${merchant}” transaction${count === 1 ? "" : "s"}`
        : `No other “${merchant}” transactions to update`
    );
  }

  function handleRuleCreated({
    category,
    categoryId,
    matchedTransactionIds
  }: {
    category: Category;
    categoryId: string;
    matchedTransactionIds: string[];
    transactionsUpdated: number;
  }) {
    const ids = new Set(matchedTransactionIds);

    if (ids.size === 0) {
      return;
    }

    updateRows((currentRows) =>
      currentRows.map((row) =>
        ids.has(row.id) ? { ...row, category, categoryId } : row
      )
    );
  }

  async function searchSourceItems(event: React.FormEvent<HTMLFormElement>, transaction: TransactionView) {
    event.preventDefault();
    const submittedQuery = linkEvidenceQuery;
    setLinkEvidenceState((current) => ({
      loading: true,
      query: current.transactionId === transaction.id ? current.query : submittedQuery,
      results: current.transactionId === transaction.id ? current.results : EMPTY_SOURCE_ITEM_SEARCH_RESULTS,
      searched: true,
      transactionId: transaction.id
    }));

    try {
      const params = new URLSearchParams({
        limit: "8",
        q: submittedQuery.trim() || transaction.merchant
      });
      const response = await fetch(`/api/v1/source-items?${params.toString()}`, { cache: "no-store" });

      if (!response.ok) {
        throw new Error("Unable to search imported evidence.");
      }

      const body = (await response.json()) as SourceItemsApiResponse;
      const results = body.data.map(sourceItemFromApi);
      setLinkEvidenceState((current) => ({
        loading: false,
        query: current.transactionId === transaction.id ? current.query : submittedQuery,
        results,
        searched: true,
        transactionId: transaction.id
      }));
    } catch (error) {
      setLinkEvidenceState((current) => ({
        loading: false,
        query: current.transactionId === transaction.id ? current.query : submittedQuery,
        results: EMPTY_SOURCE_ITEM_SEARCH_RESULTS,
        searched: true,
        transactionId: transaction.id
      }));
      setInspectorMessage(error instanceof Error ? error.message : "Unable to search imported evidence.");
    }
  }

  async function linkSourceItem(transaction: TransactionView, sourceItem: SourceItemSearchView) {
    setInspectorMessage("Linking evidence…");

    const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transaction.id)}/evidence`, {
      body: JSON.stringify({
        source_item_id: sourceItem.id,
        status: "accepted"
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const body = await response.json();

    if (!response.ok) {
      setInspectorMessage(body.error ?? "Unable to link evidence.");
      return;
    }

    setLinkEvidenceState((current) =>
      current.transactionId === transaction.id
        ? {
            ...current,
            results: current.results.filter((item) => item.id !== sourceItem.id)
          }
        : current
    );
    setInspectorMessage("Evidence linked.");
    await refreshEvidence(transaction.id);
  }

  async function addTag(event: React.FormEvent<HTMLFormElement>, transaction: TransactionView) {
    event.preventDefault();
    const tag = tagDraft.trim();

    if (!tag) {
      setInspectorMessage("Type a tag before adding it.");
      return;
    }

    if (transaction.tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase())) {
      setInspectorMessage("Tag already exists on this transaction.");
      return;
    }

    await updateTransactionTags(transaction, [...transaction.tags, tag]);
    setTagDraftState({ transactionId: transaction.id, value: "" });
  }

  async function downloadTransactionsCsv() {
    const transactionsForCsv = windowed
      ? await fetchAllTransactionRows({
          accountId,
          categoryId,
          limit: transactionWindowSize,
          maxAmount,
          minAmount,
          query,
          reviewFilter
        })
      : filteredTransactions;
    const csvRows = [
      [
        "id",
        "date",
        "status",
        "merchant",
        "description",
        "account",
        "category",
        "amount",
        "currency",
        "reviewed",
        "tags",
        "notes"
      ],
      ...transactionsForCsv.map((transaction) => [
        transaction.id,
        transaction.date,
        transaction.status,
        transaction.merchantName,
        transaction.description,
        transaction.accountName,
        transaction.category?.name ?? "",
        transaction.amount.toFixed(2),
        transaction.currency,
        transaction.reviewed ? "true" : "false",
        transaction.tags.join(";"),
        transaction.notes ?? ""
      ])
    ];
    const csv = csvRows.map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `ai-finances-transactions-${date}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${transactionsForCsv.length.toLocaleString()} transactions to CSV`);
  }

  async function updateTransactionTags(transaction: TransactionView, tags: string[]) {
    setInspectorMessage("Saving tags…");

    const normalizedTags = normalizeTags(tags);
    const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transaction.id)}`, {
      body: JSON.stringify({ tags: normalizedTags }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "PATCH"
    });
    const body = (await response.json()) as TransactionPatchApiResponse;

    if (!response.ok) {
      setInspectorMessage(body.error ?? "Unable to save tags.");
      return;
    }

    const nextTags = body.tags ?? body.transaction?.tags ?? normalizedTags;
    updateRows((currentRows) => currentRows.map((row) => (row.id === transaction.id ? { ...row, tags: nextTags } : row)));
    setInspectorMessage("Tags saved to the local transaction ledger.");
  }

  // Row/inspector tag popover: flip a single tag on or off, then reuse the
  // shared optimistic tag writer.
  async function toggleTransactionTagByName(transaction: TransactionView, tagName: string) {
    const name = tagName.trim();

    if (!name) {
      return;
    }

    const exists = transaction.tags.some((candidate) => candidate.toLowerCase() === name.toLowerCase());
    const nextTags = exists
      ? transaction.tags.filter((candidate) => candidate.toLowerCase() !== name.toLowerCase())
      : [...transaction.tags, name];

    await updateTransactionTags(transaction, nextTags);
  }

  // Goal popover: optimistically stamp the assignment, then persist. The goals
  // backend may not be live yet (404) — keep the local assignment either way so
  // the row reflects intent, and never surface an error toast.
  async function assignTransactionGoal(transaction: TransactionView, goal: FinancialGoal | null) {
    // Always record an explicit override (goal object, or `null` for
    // "unassigned") — this session-local overlay must win over the
    // server-hydrated `goalsById` lookup so a fresh unassignment can't be
    // resurrected by a stale `transaction.financialGoalId` before the PATCH
    // below is confirmed and the row is eventually re-fetched.
    setGoalByTxId((current) => {
      const next = new Map(current);
      next.set(transaction.id, goal);
      return next;
    });

    let response: Response | null = null;
    try {
      response = await fetch(`/api/v1/transactions/${encodeURIComponent(transaction.id)}`, {
        body: JSON.stringify({ financial_goal_id: goal?.id ?? null }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      });
    } catch {
      response = null;
    }

    if (!response || !response.ok) {
      setInspectorMessage("Goal saved locally — goal sync is still pending.");
      return;
    }

    toast.success(goal ? `Added to ${goal.name}` : "Removed from goal");
  }

  function storeTagStyle(body: TagStyleApiResponse, replacedName?: string) {
    if (!body.name) {
      return;
    }

    const nextName = body.name;
    setTagStyles((currentStyles) => {
      const existing = currentStyles.find(
        (style) => style.name.toLowerCase() === nextName.toLowerCase()
          || (replacedName ? style.name.toLowerCase() === replacedName.toLowerCase() : false)
      );
      const nextStyle: TagStyle = {
        ...existing,
        color: body.color ?? undefined,
        createdAt: body.created_at ?? existing?.createdAt,
        kind: body.kind === "source" ? "source" : "user",
        name: nextName,
        updatedAt: body.updated_at ?? existing?.updatedAt
      };

      return [
        ...currentStyles.filter((style) => {
          const key = style.name.toLowerCase();
          return key !== nextName.toLowerCase()
            && (!replacedName || key !== replacedName.toLowerCase());
        }),
        nextStyle
      ];
    });
  }

  async function saveTagStyle(tag: string, update: { color?: string | null }) {
    const name = tag.trim();

    if (!name) {
      setInspectorMessage("Type a tag before editing its style.");
      return null;
    }

    setInspectorMessage("Saving tag style…");
    const response = await fetch("/api/v1/tag-colors", {
      body: JSON.stringify({ name, ...update }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const body = (await response.json().catch(() => ({}))) as TagStyleApiResponse;

    if (!response.ok || !body.name) {
      setInspectorMessage(body.error ?? "Unable to save tag style.");
      return null;
    }

    storeTagStyle(body);
    return body;
  }

  async function updateTagColor(tag: string, color: string | null) {
    const saved = await saveTagStyle(tag, { color });
    if (saved) {
      setInspectorMessage("Tag color saved.");
    }
  }

  async function renameTagStyle(tag: string, newName: string, transactionId: string): Promise<boolean> {
    const currentName = tag.trim();
    const nextName = newName.trim();

    if (!currentName || !nextName) {
      setInspectorMessage("Enter a new tag name.");
      return false;
    }

    setInspectorMessage("Renaming tag…");
    const response = await fetch(`/api/v1/tags/${encodeURIComponent(currentName)}`, {
      body: JSON.stringify({ new_name: nextName }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH"
    });
    const body = (await response.json().catch(() => ({}))) as TagStyleApiResponse;

    if (!response.ok || !body.name) {
      setInspectorMessage(body.error ?? "Unable to rename tag.");
      return false;
    }

    storeTagStyle(body, currentName);
    updateRows((currentRows) => currentRows.map((row) => ({
      ...row,
      tags: renameTags(row.tags, currentName, body.name!)
    })));
    setTagDraftState({ transactionId, value: body.name });
    setInspectorMessage(`Tag renamed to ${body.name}.`);
    return true;
  }

  async function toggleReviewed(transaction: TransactionView) {
    const nextReviewed = !transaction.reviewed;
    setInspectorMessage("Saving review state…");
    setReviewToggleState("loading");
    const toastId = showToast({
      description: nextReviewed ? "Marking the selected transaction reviewed." : "Moving the selected transaction back to review.",
      duration: 0,
      status: "loading",
      title: "Saving review state",
    });

    const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transaction.id)}`, {
      body: JSON.stringify({ reviewed: nextReviewed }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "PATCH"
    });
    const body = (await response.json()) as TransactionPatchApiResponse;

    if (!response.ok) {
      const errorMessage = body.error ?? "Unable to save review state.";
      setReviewToggleState("error");
      setInspectorMessage(errorMessage);
      updateToast(toastId, {
        description: errorMessage,
        duration: 5200,
        status: "error",
        title: "Review state failed",
      });
      resetButtonState(setReviewToggleState);
      return;
    }

    const reviewed = body.reviewed ?? body.transaction?.reviewed ?? nextReviewed;
    updateRows((currentRows) =>
      currentRows.map((row) => (row.id === transaction.id ? { ...row, needsReview: !reviewed, reviewed } : row))
    );
    setInspectorMessage(reviewed ? "Marked reviewed." : "Moved back to review.");
    setReviewToggleState("success");
    updateToast(toastId, {
      description: reviewed ? "Transaction marked reviewed." : "Transaction moved back to review.",
      duration: 3600,
      status: "success",
      title: "Review state saved",
    });
    resetButtonState(setReviewToggleState);
  }

  async function saveContextNote(transaction: TransactionView) {
    const bodyText = noteDraft.trim();

    if (!bodyText) {
      setNoteSaveState("error");
      setInspectorMessage("Type a note before saving.");
      showToast({
        description: "Type a note before saving.",
        status: "error",
        title: "Note not saved",
      });
      resetButtonState(setNoteSaveState);
      return;
    }

    setInspectorMessage("Saving context note…");
    setNoteSaveState("loading");
    const toastId = showToast({
      description: "Saving the note as transaction evidence.",
      duration: 0,
      status: "loading",
      title: "Saving note",
    });

    const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transaction.id)}/context-notes`, {
      body: JSON.stringify({ body: bodyText }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const body = await response.json();

    if (!response.ok) {
      const errorMessage = body.error ?? "Unable to save context note.";
      setNoteSaveState("error");
      setInspectorMessage(errorMessage);
      updateToast(toastId, {
        description: errorMessage,
        duration: 5200,
        status: "error",
        title: "Note save failed",
      });
      resetButtonState(setNoteSaveState);
      return;
    }

    const nextNotes = body.transaction.notes as string | undefined;
    updateRows((currentRows) =>
      currentRows.map((row) => (row.id === transaction.id ? { ...row, notes: nextNotes ?? bodyText } : row))
    );
    setInspectorMessage("Context note saved and linked as transaction evidence.");
    setNoteSaveState("success");
    updateToast(toastId, {
      description: "Context note saved and linked as transaction evidence.",
      duration: 3600,
      status: "success",
      title: "Note saved",
    });
    await refreshEvidence(transaction.id);
    resetButtonState(setNoteSaveState);
  }

  function setVoiceDraftForTransaction(transactionId: string, value: string | ((currentValue: string) => string)) {
    setVoiceDraftState((current) => {
      const currentValue = current.transactionId === transactionId ? current.value : "";
      return {
        transactionId,
        value: typeof value === "function" ? value(currentValue) : value
      };
    });
  }

  function setVoiceStatusForTransaction(transactionId: string, value: string | ((currentValue: string) => string)) {
    setVoiceStatusState((current) => {
      const currentValue = current.transactionId === transactionId ? current.value : "";
      return {
        transactionId,
        value: typeof value === "function" ? value(currentValue) : value
      };
    });
  }

  function setVoiceRecordingForTransaction(transactionId: string, recording: boolean) {
    if (!transactionId) {
      return;
    }

    setVoiceRecordingState({ recording, transactionId });
  }

  function startVoiceRecognition() {
    if (voiceRecording || !selectedTransaction) {
      return;
    }

    const transactionId = selectedTransaction.id;
    const SpeechRecognition =
      (window as WindowWithSpeechRecognition).SpeechRecognition ??
      (window as WindowWithSpeechRecognition).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceStatusForTransaction(transactionId, "Voice recording is not available in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      const finalTranscript: string[] = [];

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];

        if (result?.isFinal) {
          finalTranscript.push(result[0]?.transcript.trim() ?? "");
        }
      }

      if (finalTranscript.length > 0) {
        setVoiceDraftForTransaction(transactionId, (currentDraft) =>
          [currentDraft, ...finalTranscript].filter(Boolean).join(" ").trim()
        );
      }
    };
    recognition.onerror = (event) => {
      setVoiceStatusForTransaction(transactionId, `Voice recording failed: ${event.error}.`);
      setVoiceRecordingForTransaction(transactionId, false);
    };
    recognition.onend = () => {
      setVoiceRecordingForTransaction(transactionId, false);
      recognitionRef.current = null;
      if (voiceTransactionIdRef.current === transactionId) {
        voiceTransactionIdRef.current = "";
      }
      setVoiceStatusForTransaction(transactionId, (currentStatus) => currentStatus || "Voice recording stopped.");
    };

    try {
      recognitionRef.current = recognition;
      voiceTransactionIdRef.current = transactionId;
      recognition.start();
      setVoiceRecordingForTransaction(transactionId, true);
      setVoiceStatusForTransaction(transactionId, "Recording…");
    } catch (error) {
      setVoiceStatusForTransaction(transactionId, error instanceof Error ? error.message : "Voice recording failed.");
      setVoiceRecordingForTransaction(transactionId, false);
      recognitionRef.current = null;
      voiceTransactionIdRef.current = "";
    }
  }

  function stopVoiceRecognition() {
    const recognition = recognitionRef.current;
    const transactionId = voiceTransactionIdRef.current || selectedTransactionId;

    if (!recognition) {
      setVoiceRecordingForTransaction(transactionId, false);
      return;
    }

    recognition.stop();
    recognitionRef.current = null;
    voiceTransactionIdRef.current = "";
    setVoiceRecordingForTransaction(transactionId, false);
  }

  async function saveVoiceNote(transaction: TransactionView) {
    const transcript = voiceDraft.trim();

    if (!transcript) {
      setVoiceStatusForTransaction(transaction.id, "Record a transcript before saving.");
      return;
    }

    stopVoiceRecognition();
    setInspectorMessage("Saving voice note…");

    const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transaction.id)}/voice-notes`, {
      body: JSON.stringify({ transcript }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const body = await response.json();

    if (!response.ok) {
      setInspectorMessage(body.error ?? "Unable to save voice note.");
      return;
    }

    setVoiceDraftForTransaction(transaction.id, "");
    setVoiceStatusForTransaction(transaction.id, "Voice note saved.");
    setInspectorMessage("Voice note saved and linked as transaction evidence.");
    await refreshEvidence(transaction.id);
  }

  async function updateEvidenceStatus(
    transaction: TransactionView,
    evidence: TransactionEvidenceView,
    status: "accepted" | "dismissed"
  ) {
    setInspectorMessage(status === "accepted" ? "Accepting evidence…" : "Dismissing evidence…");

    const response = await fetch(
      `/api/v1/transactions/${encodeURIComponent(transaction.id)}/evidence/${encodeURIComponent(evidence.sourceItem.id)}`,
      {
        body: JSON.stringify({
          relationship: evidence.relationship,
          status
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "PATCH"
      }
    );
    const body = await response.json();

    if (!response.ok) {
      setInspectorMessage(body.error ?? "Unable to update evidence.");
      return;
    }

    if (status === "dismissed") {
      setEvidenceItems((currentItems) =>
        currentItems.filter(
          (item) => !(item.sourceItem.id === evidence.sourceItem.id && item.relationship === evidence.relationship)
        )
      );
    } else {
      setEvidenceItems((currentItems) =>
        currentItems.map((item) =>
          item.sourceItem.id === evidence.sourceItem.id && item.relationship === evidence.relationship
            ? { ...item, status }
            : item
        )
      );
    }

    setInspectorMessage(status === "accepted" ? "Evidence accepted." : "Evidence dismissed.");
  }

  async function refreshEvidence(transactionId: string) {
    setEvidenceLoading(true);

    try {
      const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transactionId)}/evidence`, {
        cache: "no-store"
      });

      if (!response.ok) {
        setEvidenceItems([]);
        return;
      }

      const body = (await response.json()) as TransactionEvidenceApiResponse;
      setEvidenceItems(body.data.map(evidenceFromApi));
    } finally {
      setEvidenceLoading(false);
    }
  }
}

type TransactionsViewModel = ReturnType<typeof useTransactionsViewModel>;

interface MerchantGroup {
  merchant: string;
  rows: TransactionView[];
}

function TransactionsViewLayout({ model }: { model: TransactionsViewModel }) {
  return (
    <main
      className="@container/workspace flex h-[100dvh] min-h-0 flex-col bg-background text-foreground"
      data-testid="transactions-page"
    >
      <Tabs
        className="flex min-h-0 flex-1 flex-col gap-0"
        onValueChange={(value) => model.setTab(value as TransactionTab)}
        value={model.tab}
      >
        <TransactionsHeader model={model} />
        <TabsContent className="grid min-h-0 flex-1 grid-cols-1 @5xl/workspace:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]" value="all">
          <TransactionsList model={model} />
          <TransactionInspector model={model} />
          <MobileTransactionInspector model={model} />
        </TabsContent>
        <TabsContent className="min-h-0 flex-1 overflow-hidden" value="review">
          <ScrollArea className="h-full" viewportClassName="scroll-fade-y overscroll-contain">
            <ReviewTab model={model} />
          </ScrollArea>
        </TabsContent>
      </Tabs>
      <NewRuleDialog
        categories={model.categories}
        category={model.newRuleContext?.category ?? null}
        merchant={model.newRuleContext?.merchant ?? ""}
        onCreated={model.handleRuleCreated}
        onOpenChange={(open) => {
          if (!open) {
            model.setNewRuleContext(null);
          }
        }}
        open={model.newRuleContext !== null}
      />
    </main>
  );
}

function TransactionsHeader({ model }: { model: TransactionsViewModel }) {
  const { syncNow, syncing } = useSyncControls();
  const commandHintId = React.useId();
  const searchClearRef = React.useRef<HTMLDivElement>(null);
  const categoryFilterItems = [
    { label: "All categories", value: "all" },
    ...model.categories.map((category) => ({ label: category.name, value: category.id }))
  ];

  return (
    <header className="flex flex-col gap-3 border-b border-border/50 bg-background/95 px-3 py-2.5 backdrop-blur sm:px-6 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        <h1 className="text-sm font-semibold tracking-tight">Transactions</h1>
        <TabsList className="min-w-0" variant="buttons">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="review">
            Review
            {model.reviewTransactions.length > 0 ? (
              <Badge className="ml-1 h-4 min-w-4 px-1 text-3xs tabular-nums" variant="review">
                {model.reviewTotalCount.toLocaleString("en-US")}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>
      </div>

      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 md:w-auto md:flex-1 md:justify-end">
        <Button
          aria-label="Sync accounts"
          className="rounded-full"
          data-demo-hidden=""
          disabled={syncing}
          onClick={syncNow}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <RefreshCw className={cn("size-4", syncing && "animate-spin motion-reduce:animate-none")} />
        </Button>
        <Button
          aria-label="Download transactions"
          className="rounded-full"
          onClick={model.downloadTransactionsCsv}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Download className="size-4" />
        </Button>
        <span className="sr-only" id={commandHintId}>
          Press Command K to open the global command palette.
        </span>
        <InputGroup
          className={cn("t-clear h-9 min-w-[14rem] flex-1 basis-full rounded-full border border-border/50 bg-input/35 sm:w-64 sm:flex-none sm:basis-auto lg:w-72", model.query && "has-value")}
          ref={searchClearRef}
        >
          <div className="t-clear-mirror px-8 text-sm text-foreground" aria-hidden="true">
            {model.query.replace(/ /g, "\u00a0")}
          </div>
          <div className="t-clear-placeholder px-8 text-sm text-muted-foreground" aria-hidden="true">
            Search
          </div>
          <div className="t-clear-glow" aria-hidden="true" />
          <InputGroupAddon align="inline-start" className="pl-2 pr-0">
            <Search className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            aria-describedby={commandHintId}
            aria-label="Search transactions"
            spellCheck={false}
            className="h-9 px-2 text-base md:text-sm"
            onChange={(event) => model.setQuery(event.target.value)}
            value={model.query}
          />
          <InputGroupAddon align="inline-end" className="gap-1 pr-2">
            {model.query ? (
              <InputGroupButton
                aria-label="Clear transaction search"
                className="t-clear-btn"
                onClick={() =>
                  runInputClearDissolve({
                    onClear: () => model.setQuery(""),
                    placeholder: "Search",
                    value: model.query,
                    wrap: searchClearRef.current
                  })
                }
                onMouseDown={(event) => event.preventDefault()}
                onPointerDown={(event) => event.preventDefault()}
                size="icon-xs"
                type="button"
              >
                <X className="size-3.5" />
              </InputGroupButton>
            ) : null}
            <InputGroupText>
              {/* Pill badge inside a pill input — corner language follows the container.
                  Flex-centered spans: ⌘ and K sit on different baselines otherwise. */}
              <kbd
                aria-label="Command K"
                className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted/60 px-2 py-0.5 font-medium text-muted-foreground"
              >
                <span aria-hidden="true" className="text-2xs leading-none">⌘</span>
                <span className="text-3xs leading-none">K</span>
              </kbd>
            </InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        <div aria-label="Transaction amount filters" className="flex min-w-0 flex-1 basis-full items-center gap-1 sm:flex-none sm:basis-auto">
          <InputGroup className="h-9 min-w-0 flex-1 rounded-full border border-border/50 bg-input/35 sm:w-24 sm:flex-none">
            <InputGroupAddon align="inline-start" className="pl-2 pr-0">
              <InputGroupText className="text-xs">$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Minimum transaction amount"
              className="h-9 px-2 text-base md:text-sm"
              inputMode="decimal"
              onChange={(event) => model.setMinAmount(
                clampAmountInput(event.target.value, model.maxAmount, model.amountRangeMax, "minimum")
              )}
              placeholder="Min"
              value={model.minAmount}
            />
          </InputGroup>
          <InputGroup className="h-9 min-w-0 flex-1 rounded-full border border-border/50 bg-input/35 sm:w-24 sm:flex-none">
            <InputGroupAddon align="inline-start" className="pl-2 pr-0">
              <InputGroupText className="text-xs">$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Maximum transaction amount"
              className="h-9 px-2 text-base md:text-sm"
              inputMode="decimal"
              onChange={(event) => model.setMaxAmount(
                clampAmountInput(event.target.value, model.minAmount, model.amountRangeMax, "maximum")
              )}
              placeholder="Max"
              value={model.maxAmount}
            />
          </InputGroup>
        </div>
        <RangeSlider
          aria-label="transaction amount range"
          // Phones keep the Min/Max fields; the slider would squeeze them to "$".
          className="hidden h-9 w-44 shrink-0 rounded-full border border-border/50 bg-input/35 sm:flex"
          max={model.amountRangeMax}
          min={0}
          onValueChange={([minimum, maximum]) => {
            model.setMinAmount(minimum <= 0 ? "" : String(minimum));
            model.setMaxAmount(maximum >= model.amountRangeMax ? "" : String(maximum));
          }}
          step={Math.max(1, niceAmountStep(model.amountRangeMax))}
          value={amountRangeValue(model.minAmount, model.maxAmount, model.amountRangeMax)}
        />
        <Select
          items={categoryFilterItems}
          onValueChange={(value) => {
            if (typeof value === "string") {
              model.setCategoryId(value);
            }
          }}
          value={model.categoryId}
        >
          <SelectTrigger aria-label="Filter by category" className="h-9 min-w-0 flex-1 rounded-full border-border/50 bg-input/35 sm:w-40 sm:flex-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {categoryFilterItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {model.tab === "all" ? (
          <Select
            items={REVIEW_FILTER_ITEMS}
            onValueChange={(value) => {
              if (isTransactionReviewFilter(value)) {
                model.setReviewFilter(value);
              }
            }}
            value={model.reviewFilter}
          >
            <SelectTrigger aria-label="Filter by review state" className="h-9 min-w-0 flex-1 rounded-full border-border/50 bg-input/35 sm:w-40 sm:flex-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {REVIEW_FILTER_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </header>
  );
}

function TransactionsList({ model }: { model: TransactionsViewModel }) {
  return (
    <section aria-label="Transactions" className="flex min-h-0 min-w-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-muted/15 px-4 py-2 sm:px-6">
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground" htmlFor="transaction-select-all">
          <Checkbox
            aria-label="Select all loaded transactions"
            checked={model.allTransactionsSelected}
            id="transaction-select-all"
            indeterminate={!model.allTransactionsSelected && model.selectedTransactionIds.size > 0}
            onCheckedChange={(checked) => model.toggleSelectAllTransactions(checked === true)}
          />
          Select loaded
        </label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {model.filteredTransactions.length.toLocaleString("en-US")} loaded
        </span>
      </div>
      {model.hasActiveFilters ? (
        <div
          aria-label="Active transaction filters"
          className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-4 py-2 text-xs text-muted-foreground sm:px-6"
        >
          {model.accountId ? <span>Account: {accountLabel(model.rows, model.accountId)}</span> : null}
          {model.categoryId !== "all" ? <span>Category: {categoryLabel(model.categories, model.categoryId)}</span> : null}
          {model.reviewFilter !== "all" ? <span>Review: {reviewFilterLabel(model.reviewFilter)}</span> : null}
          {model.minAmount.trim() || model.maxAmount.trim() ? (
            <span>Amount: {amountFilterLabel(model.minAmount, model.maxAmount)}</span>
          ) : null}
          {model.query.trim() ? <span>Search: {model.query.trim()}</span> : null}
          <Link className="text-primary hover:underline" href="/transactions">
            Clear filters
          </Link>
        </div>
      ) : null}

      {model.windowed ? <VirtualizedTransactionsList model={model} /> : <StaticTransactionsList model={model} />}
      <TransactionBulkActions ids={model.selectedTransactionIds} model={model} />
    </section>
  );
}

function TransactionBulkActions({ ids, model }: { ids: Set<string>; model: TransactionsViewModel }) {
  if (ids.size === 0) {
    return null;
  }

  const selectedIds = Array.from(ids);
  const busy = model.reviewBusy || model.bulkMutationBusy;

  return (
    <div
      aria-label="Bulk transaction actions"
      className="sticky bottom-0 z-30 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-background/88 px-4 py-2.5 backdrop-blur-xl sm:px-6"
    >
      <span className="inline-flex items-center gap-2 text-sm">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold tabular-nums text-primary">
          {ids.size}
        </span>
        selected
      </span>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <CategoryPicker
          aiSuggestionEnabled={model.aiSuggestionEnabled}
          aiSuggestionMessage={model.aiSuggestionMessage}
          categories={model.categories}
          excludeCategoryId={null}
          onSelect={(categoryId) => void model.bulkUpdateCategory(selectedIds, categoryId)}
          uncategorizedMerchants={model.uncategorizedMerchants}
        >
          <Button className="rounded-full" disabled={busy} size="sm" type="button" variant="outline">
            <Shapes className="size-4" />
            Category
          </Button>
        </CategoryPicker>
        <TransactionTagPopover
          onToggle={(tag) => void model.bulkAddTag(selectedIds, tag)}
          selected={[]}
          tags={model.allTagOptions}
        >
          <Button className="rounded-full" disabled={busy} size="sm" type="button" variant="outline">
            <Tag className="size-4" />
            Add tag
          </Button>
        </TransactionTagPopover>
        <ExpandableActionBar
          classNames={{
            track: "border-border/60 bg-card/95 shadow-lg",
            item: "data-[disabled]:opacity-40"
          }}
          expandOnFocus={false}
          expandOnHover={false}
          expanded
          items={[
            {
              disabled: busy,
              icon: <CheckCheck className="size-4" />,
              id: "mark-reviewed",
              label: "Mark reviewed",
              onClick: () => void model.markTransactionsReviewed(selectedIds)
            },
            {
              disabled: busy,
              icon: <Eraser className="size-4" />,
              id: "clear-selection",
              label: "Clear",
              onClick: () => {
                model.setSelectedTransactionIds(new Set());
                model.setSelectedReviewIds(new Set());
              }
            }
          ]}
          size="sm"
        />
      </div>
    </div>
  );
}

function StaticTransactionsList({ model }: { model: TransactionsViewModel }) {
  return (
    <ScrollArea
      className="transaction-list-scroll min-h-0 flex-1"
      viewportClassName="scroll-fade-y overscroll-contain"
    >
      <div className="mx-auto w-full max-w-[70rem]">
        {model.groupedTransactions.map((group) => (
          <section className="transaction-date-group" key={group.label}>
            <TransactionDateHeader label={group.label} />
            {group.rows.map((transaction) => (
              <TransactionRow
                isSelected={transaction.id === model.selectedTransaction?.id}
                key={transaction.id}
                model={model}
                transaction={transaction}
              />
            ))}
          </section>
        ))}
        <TransactionListEmptyState model={model} />
      </div>
    </ScrollArea>
  );
}

function VirtualizedTransactionsList({ model }: { model: TransactionsViewModel }) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const items = useMemo(() => flattenTransactionGroups(model.groupedTransactions), [model.groupedTransactions]);
  const stickyIndexes = useMemo(
    () => items.flatMap((item, index) => (item.type === "header" ? [index] : [])),
    [items]
  );
  const stickyIndexSet = useMemo(() => new Set(stickyIndexes), [stickyIndexes]);
  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const activeStickyIndex = [...stickyIndexes].reverse().find((index) => range.startIndex >= index);
      const nextRange = defaultRangeExtractor(range);
      return activeStickyIndex === undefined ? nextRange : Array.from(new Set([activeStickyIndex, ...nextRange]));
    },
    [stickyIndexes]
  );
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    estimateSize: (index) => (items[index]?.type === "header" ? 32 : 56),
    getScrollElement: () => scrollElement,
    // virtual-core measures the scroll element's rect via ResizeObserver, which
    // hasn't reported yet on first paint -- it defaults to {width:0, height:0}
    // (no rows considered visible) until the observer fires, then re-renders
    // with the real size. That extra settle pass is the same class of bug as an
    // unseeded recharts ResponsiveContainer, and on this list it was part of
    // what widened the 390px "duplicate testid" e2e flake. A seed matching the
    // list's typical viewport renders real rows on the first pass.
    initialRect: { height: 600, width: 390 },
    onChange: (instance) => {
      const lastVirtualIndex = instance.getVirtualItems().at(-1)?.index ?? -1;

      if (lastVirtualIndex >= items.length - 10) {
        void model.loadMoreTransactions();
      }
    },
    overscan: 14,
    rangeExtractor
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const activeStickyIndex = [...stickyIndexes]
    .reverse()
    .find((index) => index <= (virtualItems[0]?.index ?? 0));

  return (
    <ScrollArea
      className="transaction-list-scroll min-h-0 flex-1"
      viewportClassName="scroll-fade-y overscroll-contain"
      viewportRef={setScrollElement}
    >
      {items.length > 0 ? (
        <div
          className="relative mx-auto w-full max-w-[70rem]"
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`
          }}
        >
          {virtualItems.map((virtualItem) => {
            const item = items[virtualItem.index];
            const isStickyHeader = stickyIndexSet.has(virtualItem.index);
            const isActiveStickyHeader = activeStickyIndex === virtualItem.index;

            if (!item) {
              return null;
            }

            return (
              <div
                className="left-0 right-0"
                data-index={virtualItem.index}
                key={item.key}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: isActiveStickyHeader ? "sticky" : "absolute",
                  top: 0,
                  transform: isActiveStickyHeader ? undefined : `translateY(${virtualItem.start}px)`,
                  zIndex: isStickyHeader ? 10 : 0
                }}
              >
                {item.type === "header" ? (
                  <TransactionDateHeader label={item.label ?? ""} />
                ) : item.transaction ? (
                  <TransactionRow
                    isSelected={item.transaction.id === model.selectedTransaction?.id}
                    model={model}
                    transaction={item.transaction}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <TransactionListEmptyState model={model} />
      <TransactionListLoadingState model={model} />
    </ScrollArea>
  );
}

function TransactionDateHeader({ label }: { label: string }) {
  return (
    <h2 className="transaction-date-header sticky top-0 z-10 border-y border-border bg-background/95 px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase backdrop-blur sm:px-6">
      {label}
    </h2>
  );
}

function TransactionRow({
  isSelected,
  model,
  transaction
}: {
  isSelected: boolean;
  model: TransactionsViewModel;
  transaction: TransactionView;
}) {
  const coarsePointer = useCoarsePointer();
  const row = <TransactionRowButton isSelected={isSelected} model={model} transaction={transaction} />;

  if (!coarsePointer) {
    return row;
  }

  return (
    <>
      <div className="sm:hidden">
        <SwipeableRow
          className="border-b border-border/60"
          leftActions={[
            {
              disabled: transaction.reviewed,
              icon: <Check className="size-4" />,
              id: "mark-reviewed",
              label: "Mark reviewed",
              onClick: () => {
                playSuccess();
                void model.markTransactionsReviewed([transaction.id]);
              },
              tone: "success"
            }
          ]}
          rightActions={[
            {
              icon: <Tag className="size-4" />,
              id: "categorize",
              label: "Categorize",
              onClick: () => model.selectTransaction(transaction, { focus: "category" }),
              tone: "primary"
            }
          ]}
          surfaceClassName="bg-background"
        >
          {row}
        </SwipeableRow>
      </div>
      <div className="hidden sm:block">{row}</div>
    </>
  );
}

function stopPropagation(event: React.SyntheticEvent) {
  event.stopPropagation();
}

function TransactionRowButton({
  isSelected,
  model,
  transaction
}: {
  isSelected: boolean;
  model: TransactionsViewModel;
  transaction: TransactionView;
}) {
  // A session-local override always wins (`undefined` = "no override yet");
  // otherwise resolve the persisted `financialGoalId` through the hydrated
  // goal directory so the assignment survives a hard reload.
  const goalOverride = model.goalByTxId.get(transaction.id);
  const assignedGoal =
    goalOverride !== undefined
      ? goalOverride
      : (transaction.financialGoalId ? (model.goalsById.get(transaction.financialGoalId) ?? null) : null);
  // Row chips only ever show `user` tags — source/machine tags (simplefin,
  // plaid:card_payment, ...) stay on the transaction but are noise in a
  // scannable ledger row. They're still visible (muted) in the inspector.
  const userFacingTags = transaction.tags.filter((tag) => model.tagStyleByName.get(tag.toLowerCase())?.kind !== "source");
  const visibleTags = userFacingTags.slice(0, 1);
  const extraTagCount = userFacingTags.length - visibleTags.length;
  const selectTransaction = () => model.selectTransaction(transaction);
  const bulkSelected = model.selectedTransactionIds.has(transaction.id);
  // Row-menu "Edit category"/"Add tag" open pickers anchored AT the row instead
  // of yanking focus to the inspector — the inspector stays for deliberate work.
  const [rowPicker, setRowPicker] = React.useState<"category" | "tag" | null>(null);

  return (
    <div
      className={cn(
        "ledger-transaction-row group/row relative grid w-full items-center gap-2.5 px-4 py-1 text-left transition-colors sm:px-6",
        (isSelected || bulkSelected) && "bg-accent"
      )}
      data-bulk-selected={bulkSelected ? "" : undefined}
      data-selected={isSelected ? "" : undefined}
      data-testid="transaction-row"
    >
      <button
        aria-label={`Select ${transaction.merchant}`}
        className="absolute inset-0 z-0 bg-transparent transition-colors hover:bg-accent"
        data-sound="none"
        onClick={selectTransaction}
        type="button"
      />
      <span className="pointer-events-auto relative z-20 flex items-center justify-center">
        <Checkbox
          aria-label={`Select ${transaction.merchant} for bulk actions`}
          checked={bulkSelected}
          onCheckedChange={(checked) => model.toggleTransactionRow(transaction.id, checked === true)}
          onClick={stopPropagation}
          onPointerDown={stopPropagation}
        />
      </span>
      <span className="pointer-events-none relative z-10">
        <MerchantAvatar name={transaction.merchant} />
      </span>

      {/* Merchant + inline muted account, then assigned tags/goal, then the
          hover-revealed flag/tag/goal actions — all in the flexible column. */}
      <span className="pointer-events-none relative z-10 flex min-w-0 items-center gap-1.5">
        <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-1.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{transaction.merchant}</span>
            {transaction.status === "pending" ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground" />
                  }
                >
                  <Clock3 className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Pending</TooltipContent>
              </Tooltip>
            ) : null}
          </span>
          <span className="truncate text-xs text-muted-foreground sm:text-sm">{transaction.accountName}</span>
        </span>

        {visibleTags.length > 0 ? (
          <span className="hidden shrink-0 items-center gap-1 lg:flex">
            {visibleTags.map((tag) => (
              <span
                className="inline-flex h-[22px] max-w-32 items-center gap-1.5 rounded-full border border-border/70 px-2 text-xs font-medium text-muted-foreground"
                key={tag}
              >
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: model.tagStyleByName.get(tag.toLowerCase())?.color ?? "var(--muted-foreground)" }}
                />
                <span className="truncate">{tag}</span>
              </span>
            ))}
            {extraTagCount > 0 ? (
              <span className="text-xs font-medium text-muted-foreground tabular-nums">+{extraTagCount}</span>
            ) : null}
          </span>
        ) : null}

        {assignedGoal ? (
          <span className="hidden h-4 max-w-28 shrink-0 items-center gap-1 rounded-full border border-border/70 px-1.5 text-3xs font-medium text-muted-foreground sm:inline-flex">
            <span aria-hidden="true" className="leading-none">
              {assignedGoal.emoji ?? "🎯"}
            </span>
            <span className="truncate">{assignedGoal.name}</span>
          </span>
        ) : null}

        <span
          className="row-actions pointer-events-auto hidden w-0 shrink-0 items-center gap-1 overflow-hidden opacity-0 transition-opacity duration-150 group-hover/row:w-auto group-hover/row:opacity-100 group-focus-within/row:w-auto group-focus-within/row:opacity-100 has-[[aria-expanded=true]]:w-auto has-[[aria-expanded=true]]:opacity-100 motion-reduce:transition-none sm:flex"
          onClick={stopPropagation}
          onPointerDown={stopPropagation}
        >
          <TransactionGoalPopover
            onAssign={(goal) => void model.assignTransactionGoal(transaction, goal)}
            value={assignedGoal?.id}
          >
            <button
              aria-label={`Assign goal to ${transaction.merchant}`}
              className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground motion-reduce:transition-none sm:size-10"
              onClick={stopPropagation}
              onPointerDown={stopPropagation}
              type="button"
            >
              <Target className="size-3.5" />
            </button>
          </TransactionGoalPopover>
          <OverflowActions
            classNames={{
              action: "bg-background/80",
              toggle: "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
              track: "border-0 bg-transparent p-0 shadow-none"
            }}
            collapseOnAction
            openLabel={`Show actions for ${transaction.merchant}`}
            overflowActions={[
              {
                ariaLabel: transaction.reviewed
                  ? `Move ${transaction.merchant} back to review`
                  : `Mark ${transaction.merchant} reviewed`,
                icon: <Flag className={cn("size-3.5", transaction.reviewed && "fill-current text-(--positive)")} />,
                id: "review",
                label: transaction.reviewed ? "Move to review" : "Mark reviewed",
                onClick: () => void model.toggleReviewed(transaction)
              },
              {
                ariaLabel: `Edit category for ${transaction.merchant}`,
                icon: <Shapes className="size-3.5" />,
                id: "category",
                label: "Edit category",
                onClick: () => setRowPicker("category")
              },
              {
                ariaLabel: `Add tag to ${transaction.merchant}`,
                icon: <Tag className="size-3.5" />,
                id: "tag",
                label: "Add tag",
                onClick: () => setRowPicker("tag")
              },
              {
                ariaLabel: `Exclude ${transaction.merchant}`,
                disabled: transaction.categoryId === "cat_transfer",
                icon: <Ban className="size-3.5" />,
                id: "exclude",
                label: "Exclude",
                onClick: () => void model.updateTransactionCategory(transaction.id, "cat_transfer")
              }
            ]}
            primaryActions={[]}
            size="sm"
          />
          {/* Invisible anchor: the row-menu "Add tag" opens this popover right
              at the actions cluster instead of focusing the inspector input. */}
          <TransactionTagPopover
            align="end"
            nativeButton={false}
            onOpenChange={(next) => {
              if (!next) {
                setRowPicker(null);
              }
            }}
            onToggle={(tag) => void model.toggleTransactionTagByName(transaction, tag)}
            open={rowPicker === "tag"}
            selected={userFacingTags}
            tags={model.allTagOptions}
          >
            <span aria-hidden="true" className="pointer-events-none inline-block size-px" />
          </TransactionTagPopover>
        </span>
      </span>

      {/* Category column — left-aligned within its fixed track. */}
      <span className="pointer-events-none relative z-10 hidden min-w-0 justify-start sm:flex">
        {transaction.category ? (
          <CategoryPicker
            aiSuggestionEnabled={model.aiSuggestionEnabled}
            aiSuggestionMessage={model.aiSuggestionMessage}
            align="start"
            categories={model.categories}
            onOpenChange={(next) => {
              if (!next) {
                setRowPicker(null);
              }
            }}
            onSelect={(categoryId) => void model.commitCategoryFromPicker(transaction, categoryId)}
            open={rowPicker === "category" ? true : undefined}
            uncategorizedMerchants={model.uncategorizedMerchants}
            value={transaction.category.id}
          >
            <button
              aria-label={`Change category (currently ${transaction.category.name})`}
              className="pointer-events-auto inline-flex min-w-0 rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={stopPropagation}
              onPointerDown={stopPropagation}
              type="button"
            >
              <CategoryPill
                className="max-w-[10rem] cursor-pointer transition-[filter] hover:brightness-110"
                category={transaction.category}
              />
            </button>
          </CategoryPicker>
        ) : null}
      </span>

      <span className="pointer-events-none relative z-10 flex justify-end">
        <Amount amount={transaction.amount} className="text-right" currency={transaction.currency} />
      </span>

      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none relative z-10 size-1.5 justify-self-center rounded-full transition-colors",
          transaction.needsReview ? "bg-primary/70" : "bg-transparent"
        )}
      />
    </div>
  );
}

function TransactionListEmptyState({ model }: { model: TransactionsViewModel }) {
  if (model.filteredTransactions.length > 0 || model.rowsLoading) {
    return null;
  }

  return (
    <EmptyState
      actions={
        model.hasActiveFilters ? (
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/transactions">
            Clear filters
          </Link>
        ) : (
          <Link className={buttonVariants({ variant: "secondary", size: "sm" })} href="/settings">
            Sync or import
          </Link>
        )
      }
      className="m-6"
      description="Adjust the search, category, or review filters to get back to the local ledger."
      icon={<Search className="size-5" />}
      title="No transactions match the current filters."
    />
  );
}

function TransactionListLoadingState({ model }: { model: TransactionsViewModel }) {
  if (!model.rowsLoading && !model.rowsHasMore && !model.rowsError) {
    return null;
  }

  return (
    <div className="px-6 py-4 text-xs text-muted-foreground">
      {model.rowsLoading ? (
        <div className="grid gap-2" aria-label="Loading transactions">
          <Skeleton className="h-9" variant="long" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" variant="short" />
        </div>
      ) : (
        <div className="flex items-center justify-center">
          {model.rowsError ? model.rowsError : "Scroll for more transactions"}
        </div>
      )}
    </div>
  );
}

function TransactionInspector({ model }: { model: TransactionsViewModel }) {
  const transaction = model.selectedTransaction;
  const [panelAnimating, setPanelAnimating] = useState(false);
  const panelMotionMountedRef = useRef(false);

  useEffect(() => {
    if (!panelMotionMountedRef.current) {
      panelMotionMountedRef.current = true;
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPanelAnimating(false);
      return;
    }

    setPanelAnimating(true);
  }, [model.inspectorOpen]);

  const finishPanelTransition = (event: React.TransitionEvent<HTMLElement>) => {
    if (event.currentTarget === event.target) {
      setPanelAnimating(false);
    }
  };

  if (!transaction) {
    return (
      <aside
        aria-label="Selected transaction inspector"
        className="t-panel-slide hidden flex-col border-l border-border bg-card p-6 lg:flex [--panel-translate-y:24px]"
        data-animating={panelAnimating ? "true" : undefined}
        data-open="false"
        data-testid="empty-inspector"
        onTransitionEnd={finishPanelTransition}
      >
        <EmptyState
          actions={
            model.rows.length === 0 ? (
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/settings">
                Open settings
              </Link>
            ) : (
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/transactions?review=actionable">
                Review transactions
              </Link>
            )
          }
          className="mt-0 border-border bg-background/40"
          description={
            model.rows.length === 0
              ? "Sync a connected account from settings to populate this view."
              : "Select a transaction to inspect tags, notes, evidence, and review state."
          }
          icon={<Search className="size-5" />}
          size="sm"
          title={model.rows.length === 0 ? "No transactions yet" : "No transaction selected"}
        />
      </aside>
    );
  }

  return (
    <aside
      aria-label="Selected transaction inspector"
      className="t-panel-slide hidden min-h-0 flex-col border-l border-border/60 bg-muted/10 @5xl/workspace:flex [--panel-translate-y:24px]"
      data-animating={panelAnimating ? "true" : undefined}
      data-open={model.inspectorOpen ? "true" : "false"}
      onTransitionEnd={finishPanelTransition}
    >
      <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade-y overscroll-contain">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <TextSwap value={transaction.status === "pending" ? "Pending transaction" : "Posted transaction"} />
          </span>
          <div className="flex items-center gap-1.5">
            <StatefulButton
              errorText="Failed"
              loadingText="Saving"
              onClick={() => model.toggleReviewed(transaction)}
              size="sm"
              state={model.reviewToggleState}
              successText={transaction.reviewed ? "Move to review" : "Mark reviewed"}
              type="button"
              variant="outline"
            >
              {transaction.reviewed ? "Move to review" : "Mark reviewed"}
            </StatefulButton>
            <Button
              aria-label="Close inspector"
              data-sound="none"
              onClick={() => {
                model.stopVoiceRecognition();
                playClose();
                model.setInspectorOpen(false);
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </div>
        </header>

        <div className="grid gap-3 p-3">
          <IconiqCard className="gap-0 rounded-xl border-border/50 bg-card/90 py-0 shadow-sm">
            <IconiqCardContent className="flex items-start justify-between gap-4 px-4 py-4">
              <div className="min-w-0">
                <span className="text-xs text-muted-foreground">{transaction.dateLabel}</span>
                <h2 className="mt-0.5 truncate text-lg font-semibold">{transaction.merchant}</h2>
                <p className="text-sm text-muted-foreground">{transaction.accountName}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <TextSwap className="text-xs text-muted-foreground capitalize" value={transaction.status} />
                <Badge variant={transaction.reviewed ? "synced" : "review"}>
                  {transaction.reviewed ? "Reviewed" : "To review"}
                </Badge>
                <Amount amount={transaction.amount} compact currency={transaction.currency} />
              </div>
            </IconiqCardContent>
          </IconiqCard>
          <TransactionInspectorDetails model={model} transaction={transaction} />
        </div>
        {model.inspectorMessage ? (
          <p aria-live="polite" className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            {model.inspectorMessage}
          </p>
        ) : null}
      </ScrollArea>
    </aside>
  );
}

function MobileTransactionInspector({ model }: { model: TransactionsViewModel }) {
  const compactWorkspace = useCompactWorkspace();
  const transaction = model.selectedTransaction;

  if (!compactWorkspace) {
    return null;
  }

  return (
    <BottomSheet
      description={transaction ? `${transaction.accountName} · ${transaction.dateLabel}` : undefined}
      onOpenChange={(open) => {
        if (!open) {
          model.stopVoiceRecognition();
          playClose();
          model.setInspectorOpen(false);
        }
      }}
      open={Boolean(transaction && model.inspectorOpen && model.inspectorRequested)}
      title={transaction?.merchant ?? "Transaction"}
    >
      {transaction ? (
        <div className="min-h-0">
          <div className="grid gap-3">
            <IconiqCard className="gap-0 rounded-xl border-border/50 bg-card/90 py-0 shadow-sm">
              <IconiqCardContent className="flex items-start justify-between gap-4 px-4 py-4">
                <div className="min-w-0">
                  <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {transaction.status === "pending" ? "Pending transaction" : "Posted transaction"}
                  </span>
                  <h2 className="mt-1 truncate text-lg font-semibold">{transaction.merchant}</h2>
                  <p className="text-sm text-muted-foreground">{transaction.accountName}</p>
                  {transaction.categoryId === "cat_transfer" ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      Internal transfer
                      {(() => {
                        const counterpart = transaction.pairedTransactionId
                          ? model.rows.find((row) => row.id === transaction.pairedTransactionId)
                          : undefined;
                        return counterpart ? ` · linked to ${counterpart.accountName}` : "";
                      })()}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={transaction.reviewed ? "synced" : "review"}>
                    {transaction.reviewed ? "Reviewed" : "To review"}
                  </Badge>
                  <Amount amount={transaction.amount} compact currency={transaction.currency} />
                </div>
              </IconiqCardContent>
            </IconiqCard>
            <TransactionInspectorDetails model={model} transaction={transaction} />
          </div>
          {model.inspectorMessage ? (
            <p aria-live="polite" className="border-t border-border py-3 text-xs text-muted-foreground">
              {model.inspectorMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </BottomSheet>
  );
}

function TransactionInspectorDetails({
  model,
  transaction
}: {
  model: TransactionsViewModel;
  transaction: TransactionView;
}) {
  return (
    <IconiqCard className="gap-0 rounded-xl border-border/50 bg-card/90 py-0 shadow-sm">
      <IconiqCardContent className="p-0">
        <TransactionInspectorCategory model={model} transaction={transaction} />
        <TransactionInspectorTags model={model} transaction={transaction} />
        <TransactionInspectorNotes model={model} transaction={transaction} />
        <TransactionInspectorEvidence model={model} transaction={transaction} />
      </IconiqCardContent>
    </IconiqCard>
  );
}

function TransactionInspectorCategory({ model, transaction }: { model: TransactionsViewModel; transaction: TransactionView }) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (model.inspectorFocusTarget !== "category") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
      model.setInspectorFocusTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [model, transaction.id]);

  return (
    <section className="border-b border-border/35 px-4 py-4 last:border-b-0">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Category</span>
      <div className="mt-2">
        <CategoryPicker
          aiSuggestionEnabled={model.aiSuggestionEnabled}
          aiSuggestionMessage={model.aiSuggestionMessage}
          align="start"
          categories={model.categories}
          onSelect={(categoryId) => void model.commitCategoryFromPicker(transaction, categoryId)}
          uncategorizedMerchants={model.uncategorizedMerchants}
          value={transaction.category?.id}
        >
          <button
            aria-label={`Category for ${transaction.merchant}`}
            className="flex h-8 w-full items-center justify-between gap-1.5 rounded-2xl border border-transparent bg-input/50 px-3 py-2 text-sm outline-none transition-[color,box-shadow] duration-200 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
            ref={triggerRef}
            type="button"
          >
            <span className="flex min-w-0 items-center gap-2">
              {transaction.category ? (
                <CategoryPill className="max-w-full" category={transaction.category} />
              ) : (
                <span className="text-muted-foreground">Choose category</span>
              )}
            </span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </CategoryPicker>
      </div>
    </section>
  );
}

function TransactionInspectorTags({ model, transaction }: { model: TransactionsViewModel; transaction: TransactionView }) {
  const tagDraft = model.tagDraft.trim();
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const selectedStyle = tagDraft ? model.tagStyleByName.get(tagDraft.toLowerCase()) : undefined;
  const sourceStyleSelected = selectedStyle?.kind === "source";
  // Source/machine tags (simplefin, plaid:card_payment, ...) are kept on the
  // transaction and stay searchable, but they're a sync adapter's bookkeeping,
  // not something to edit — render them separately, muted, and non-removable.
  const userTags = transaction.tags.filter((tag) => model.tagStyleByName.get(tag.toLowerCase())?.kind !== "source");
  const sourceTags = transaction.tags.filter((tag) => model.tagStyleByName.get(tag.toLowerCase())?.kind === "source");

  useEffect(() => {
    if (model.inspectorFocusTarget !== "tag") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      tagInputRef.current?.focus();
      model.setInspectorFocusTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [model, transaction.id]);

  useEffect(() => {
    setRenameOpen(false);
    setRenameDraft("");
  }, [tagDraft, transaction.id]);

  return (
    <section className="border-b border-border/35 px-4 py-4 last:border-b-0">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tags</span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {userTags.length > 0 ? (
          userTags.map((tag) => (
            <TagChip
              color={model.tagStyleByName.get(tag.toLowerCase())?.color}
              key={tag}
              onRemove={() =>
                model.updateTransactionTags(
                  transaction,
                  transaction.tags.filter((candidate) => candidate !== tag)
                )
              }
              tag={tag}
            />
          ))
        ) : (
          <em className="text-sm text-muted-foreground not-italic">No tags</em>
        )}
      </div>
      <form className="mt-2 flex items-center gap-1.5" onSubmit={(event) => model.addTag(event, transaction)}>
        <Input
          aria-label="New transaction tag"
          className="h-7"
          onChange={(event) =>
            model.setTagDraftState({
              transactionId: transaction.id,
              value: event.target.value
            })
          }
          placeholder="Add a tag"
          ref={tagInputRef}
          value={model.tagDraft}
        />
        <Button aria-label="Add tag" size="icon-sm" type="submit" variant="outline">
          <Plus className="size-4" />
        </Button>
      </form>
      {tagDraft ? (
        <div className="mt-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              aria-label={`Use default color for ${tagDraft}`}
              className="h-5 rounded-2xl border border-border px-2 text-2xs text-muted-foreground transition-colors hover:bg-muted"
              onClick={() => model.updateTagColor(tagDraft, null)}
              type="button"
            >
              Default
            </button>
            <BloomColorPicker
              ariaLabel={`Color for tag ${tagDraft}`}
              onChange={(color) => model.updateTagColor(tagDraft, color)}
              value={selectedStyle?.color ?? "#7c8794"}
            />
            {!sourceStyleSelected && selectedStyle ? (
              <Button
                aria-label={`Rename tag ${tagDraft}`}
                onClick={() => {
                  setRenameDraft(selectedStyle.name);
                  setRenameOpen((current) => !current);
                }}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <Pencil className="size-3.5" />
              </Button>
            ) : null}
          </div>
          {renameOpen ? (
            <form
              className="mt-2 flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                void model.renameTagStyle(tagDraft, renameDraft, transaction.id).then((renamed) => {
                  if (renamed) {
                    setRenameOpen(false);
                  }
                });
              }}
            >
              <Input
                aria-label={`New name for ${tagDraft}`}
                className="h-7"
                onChange={(event) => setRenameDraft(event.target.value)}
                value={renameDraft}
              />
              <Button size="sm" type="submit" variant="outline">Rename</Button>
            </form>
          ) : null}
        </div>
      ) : null}
      {sourceTags.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-3">
          <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">Source tags</span>
          {sourceTags.map((tag) => (
            <TagChip
              className="h-5 border-border/60 bg-muted/50 text-2xs text-muted-foreground"
              color={model.tagStyleByName.get(tag.toLowerCase())?.color}
              key={tag}
              tag={tag}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TransactionInspectorNotes({ model, transaction }: { model: TransactionsViewModel; transaction: TransactionView }) {
  return (
    <section className="border-b border-border/35 px-4 py-4 last:border-b-0">
      <label className="flex flex-col gap-1.5" htmlFor="transaction-context-note">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Context note</span>
        <Textarea
          aria-label="Context note"
          className="min-h-20"
          aria-keyshortcuts="Meta+Enter Control+Enter"
          id="transaction-context-note"
          onChange={(event) =>
            model.setNoteDraftState({
              transactionId: transaction.id,
              value: event.target.value
            })
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void model.saveContextNote(transaction);
            }
          }}
          placeholder="Add context for this transaction"
          value={model.noteDraft}
        />
      </label>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <StatefulButton
          className="text-xs [&_svg:not([class*='size-'])]:size-3.5"
          errorText="Failed"
          loadingText="Saving"
          onClick={() => model.saveContextNote(transaction)}
          size="sm"
          state={model.noteSaveState}
          successText="Saved"
          title="Save note (⌘↵ or Ctrl+Enter)"
          type="button"
          variant="outline"
        >
          Save note
        </StatefulButton>
        <Button
          className="text-xs [&_svg:not([class*='size-'])]:size-3.5"
          onClick={model.voiceRecording ? model.stopVoiceRecognition : model.startVoiceRecognition}
          size="sm"
          type="button"
          variant="outline"
        >
          {model.voiceRecording ? (
            <VoiceWaveform bars={5} className="text-[--negative]" height={14} label="Listening" />
          ) : (
            <Mic className="size-3.5" />
          )}
          {model.voiceRecording ? "Stop" : "Record"}
        </Button>
        {model.voiceDraft ? (
          <Button
            className="text-xs"
            onClick={() => model.saveVoiceNote(transaction)}
            size="sm"
            type="button"
            variant="outline"
          >
            Save voice
          </Button>
        ) : null}
      </div>
      {model.voiceDraft ? (
        <div className="mt-2 rounded-lg border border-border bg-muted/40 p-2.5">
          <span className="text-xs font-medium text-muted-foreground">Voice transcript</span>
          <p className="mt-0.5 text-sm">{model.voiceDraft}</p>
        </div>
      ) : null}
      {model.voiceStatus ? <p className="mt-1.5 text-xs text-muted-foreground">{model.voiceStatus}</p> : null}
    </section>
  );
}

function TransactionInspectorEvidence({ model, transaction }: { model: TransactionsViewModel; transaction: TransactionView }) {
  return (
    <section aria-label="Transaction evidence" className="border-b border-border/35 px-4 py-4 last:border-b-0">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <Link2 className="size-3.5" />
          Evidence
        </span>
        <Badge className="tabular-nums" variant="synced">{model.evidenceItems.length}</Badge>
      </header>
      {model.evidenceLoading ? (
        <div className="mt-2 grid gap-2">
          <p className="text-sm text-muted-foreground">Loading evidence…</p>
          <Skeleton className="h-3" variant="long" />
          <Skeleton className="h-3" variant="short" />
        </div>
      ) : null}
      {!model.evidenceLoading && model.evidenceItems.length === 0 ? (
        <EmptyState
          actions={
            <Button
              onClick={() => document.getElementById("evidence-source-search")?.focus()}
              size="sm"
              type="button"
              variant="outline"
            >
              Link evidence
            </Button>
          }
          className="mt-2"
          description="Link receipts, emails, or imported source items when a transaction needs supporting context."
          icon={<Link2 className="size-5" />}
          size="sm"
          title="No linked evidence yet"
        />
      ) : null}
      <div className="mt-2 flex flex-col gap-2">
        {model.evidenceItems.map((item) => (
          <article
            className="flex items-start justify-between gap-2 rounded-xl border border-border/40 bg-muted/15 p-2.5"
            key={`${item.sourceItem.id}:${item.relationship}`}
          >
            <div className="min-w-0">
              <strong className="text-sm font-medium">{item.sourceItem.title}</strong>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {evidenceLabel(item.relationship)} · {item.status} · {Math.round(item.confidence * 100)}%
              </span>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.sourceItem.summary}</p>
              {item.sourceItem.lines?.length ? (
                <ItemizedLines categories={model.categories} className="mt-1.5" currency={item.sourceItem.currency} lines={item.sourceItem.lines} max={8} />
              ) : null}
            </div>
            {item.status === "suggested" ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  aria-label={`Accept evidence ${item.sourceItem.title}`}
                  onClick={() => model.updateEvidenceStatus(transaction, item, "accepted")}
                  size="icon-xs"
                  type="button"
                  variant="outline"
                >
                  <Check className="size-3.5" />
                </Button>
                <Button
                  aria-label={`Dismiss evidence ${item.sourceItem.title}`}
                  onClick={() => model.updateEvidenceStatus(transaction, item, "dismissed")}
                  size="icon-xs"
                  type="button"
                  variant="outline"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Link source item</summary>
        <form className="mt-2 flex items-center gap-1.5" onSubmit={(event) => model.searchSourceItems(event, transaction)}>
          <Input
            aria-label="Search imported evidence"
            className="h-7"
            id="evidence-source-search"
            onChange={(event) =>
              model.setLinkEvidenceState((current) => ({
                loading: current.transactionId === transaction.id ? current.loading : false,
                query: event.target.value,
                results:
                  current.transactionId === transaction.id
                    ? current.results
                    : EMPTY_SOURCE_ITEM_SEARCH_RESULTS,
                searched: current.transactionId === transaction.id ? current.searched : false,
                transactionId: transaction.id
              }))
            }
            placeholder="Search imported evidence"
            value={model.linkEvidenceQuery}
          />
          <Button disabled={model.linkEvidenceLoading} size="sm" type="submit" variant="outline">
            {model.linkEvidenceLoading ? "Searching…" : "Search source items"}
          </Button>
        </form>
        {model.linkEvidenceLoading ? (
          <div className="mt-2 grid gap-2">
            <p className="text-sm text-muted-foreground">Searching imported evidence…</p>
            <Skeleton className="h-3" />
            <Skeleton className="h-3" variant="short" />
          </div>
        ) : null}
        {!model.linkEvidenceLoading && model.linkEvidenceSearched && model.linkEvidenceResults.length === 0 ? (
          <EmptyState
            actions={
              <Button
                onClick={() => {
                  const input = document.getElementById("evidence-source-search") as HTMLInputElement | null;
                  input?.focus();
                  input?.select();
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Try another search
              </Button>
            }
            className="mt-2"
            description="Try the merchant name, amount, or a receipt keyword from your imported evidence sources."
            icon={<Search className="size-5" />}
            size="sm"
            title="No matching source items"
          />
        ) : null}
        {!model.linkEvidenceLoading && model.linkEvidenceResults.length > 0 ? (
          <div className="mt-2 flex flex-col gap-2">
            {model.linkEvidenceResults.map((item) => (
              <article
                className="flex items-start justify-between gap-2 rounded-xl border border-border/40 bg-muted/15 p-2.5"
                key={item.id}
              >
                <div className="min-w-0">
                  <strong className="text-sm font-medium">{item.title}</strong>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {item.kind}
                    {item.merchantName ? ` · ${item.merchantName}` : ""}
                  </span>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.summary}</p>
                </div>
                <Button
                  aria-label={`Link evidence ${item.title}`}
                  onClick={() => model.linkSourceItem(transaction, item)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Link
                </Button>
              </article>
            ))}
          </div>
        ) : null}
      </details>
    </section>
  );
}

function ReviewTab({ model }: { model: TransactionsViewModel }) {
  if (model.reviewTransactions.length === 0) {
    return (
      <div className="px-6 py-16">
        <EmptyState
          actions={
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/transactions">
              View all transactions
            </Link>
          }
          className="mx-auto max-w-xl"
          description="Every transaction matching the current filters has been reviewed."
          icon={<Check className="size-5 animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none" />}
          title="Nothing left to review"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 sm:px-6">
        <label className="flex items-center gap-2 text-sm text-muted-foreground" htmlFor="review-select-all">
          <Checkbox
            aria-label="Select all transactions to review"
            className="after:-inset-3"
            checked={model.allReviewSelected}
            id="review-select-all"
            onCheckedChange={(checked) => model.toggleSelectAllReview(checked === true)}
          />
          Select all
        </label>
        <span className="text-xs text-muted-foreground tabular-nums">
          {model.reviewTotalCount.toLocaleString("en-US")} to review
        </span>
      </div>

      <AvatarHoverGroup className="flex flex-col gap-2 px-4 py-3 sm:px-6">
        {model.reviewGroups.map((group, index) => (
          <MerchantReviewGroup
            avatarIndex={index}
            categories={model.categories}
            group={group}
            key={group.merchant}
            onApproveGroup={() => model.markTransactionsReviewed(group.rows.map((row) => row.id))}
            onToggleRow={model.toggleReviewRow}
            onToggleGroup={(checked) => model.toggleReviewGroup(group, checked)}
            onUpdateCategory={model.updateTransactionCategory}
            reviewBusy={model.reviewBusy}
            selectedIds={model.selectedReviewIds}
          />
        ))}
        <ReviewTabLoadMore model={model} />
      </AvatarHoverGroup>

      {model.reviewMessage ? (
        <p aria-live="polite" className="inline-flex items-center gap-1.5 px-6 pb-4 text-xs text-muted-foreground">
          {isReviewSuccessMessage(model.reviewMessage) ? (
            <Check className="size-3.5 animate-in fade-in zoom-in-95 text-(--positive) duration-200 motion-reduce:animate-none" />
          ) : null}
          {model.reviewMessage}
        </p>
      ) : null}

      <TransactionBulkActions ids={model.selectedReviewIds} model={model} />
    </div>
  );
}

function ReviewTabLoadMore({ model }: { model: TransactionsViewModel }) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!model.windowed || !model.reviewTransactionsHasMore) {
      return;
    }

    const sentinel = sentinelRef.current;

    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void model.loadMoreReviewTransactions();
      }
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [model]);

  if (!model.windowed || (!model.reviewTransactionsHasMore && !model.reviewTransactionsLoading && !model.reviewTransactionsError)) {
    return null;
  }

  return (
    <div className="flex items-center justify-center px-6 py-3 text-xs text-muted-foreground" ref={sentinelRef}>
      {model.reviewTransactionsError
        ? model.reviewTransactionsError
        : model.reviewTransactionsLoading
          ? "Loading review rows…"
          : "Scroll for more review rows"}
    </div>
  );
}

function MerchantReviewGroup({
  avatarIndex,
  categories,
  group,
  onApproveGroup,
  onToggleGroup,
  onToggleRow,
  onUpdateCategory,
  reviewBusy,
  selectedIds
}: {
  avatarIndex: number;
  categories: Category[];
  group: MerchantGroup;
  onApproveGroup: () => void;
  onToggleGroup: (checked: boolean) => void;
  onToggleRow: (id: string, checked: boolean) => void;
  onUpdateCategory: (transactionId: string, categoryId: string) => void;
  reviewBusy: boolean;
  selectedIds: Set<string>;
}) {
  const [open, setOpen] = useState(true);
  const allSelected = group.rows.every((row) => selectedIds.has(row.id));
  const categorySelectItems = categories.map((category) => ({
    label: category.name,
    value: category.id
  }));
  const toggleOpen = () => {
    setOpen((current) => {
      const next = !current;
      if (next) {
        playOpen();
      } else {
        playClose();
      }
      return next;
    });
  };

  return (
    <div className="t-acc overflow-hidden rounded-xl border border-border" data-open={open ? "true" : "false"}>
      <div className="flex items-center gap-3 bg-muted/30 px-3 py-2">
        <Checkbox
          aria-label={`Select all ${group.rows.length} ${group.merchant}`}
          className="after:-inset-3"
          checked={allSelected}
          onCheckedChange={(checked) => onToggleGroup(checked === true)}
        />
        <button
          aria-expanded={open}
          className="t-acc-head flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={toggleOpen}
          type="button"
        >
          <span className="t-acc-chevron shrink-0 text-muted-foreground">
            <ChevronDown className="size-4" />
          </span>
          <AvatarHoverItem index={avatarIndex} className="shrink-0">
            <MerchantAvatar name={group.merchant} />
          </AvatarHoverItem>
          <span className="truncate text-sm font-medium">{group.merchant}</span>
          <Badge className="tabular-nums" variant="review">
            {group.rows.length}
          </Badge>
        </button>
        <Button disabled={reviewBusy} onClick={onApproveGroup} size="xs" type="button" variant="outline">
          <Check className="size-3" />
          Approve all {group.rows.length}
        </Button>
      </div>
      <div className="t-acc-panel">
        <div className="t-acc-panel-inner">
          <ScrollArea
            className="border-t border-border"
            orientation="horizontal"
            viewportClassName="scroll-fade-x overscroll-x-contain"
          >
            <div className="min-w-[42rem] divide-y divide-border">
              {group.rows.map((transaction) => (
                <div
                  className="transaction-review-row grid items-center gap-3 px-3 py-2 pl-9"
                  key={transaction.id}
                >
                  <Checkbox
                    aria-label={`Select ${transaction.merchant} ${transaction.dateLabel}`}
                    className="after:-inset-3"
                    checked={selectedIds.has(transaction.id)}
                    onCheckedChange={(checked) => onToggleRow(transaction.id, checked === true)}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs text-muted-foreground">{transaction.relativeDateLabel}</span>
                    <span className="truncate text-xs text-muted-foreground">{transaction.accountName}</span>
                  </span>
                  <span className="flex-1" />
                  <Select
                    items={categorySelectItems}
                    onValueChange={(value) => {
                      if (typeof value === "string") {
                        onUpdateCategory(transaction.id, value);
                      }
                    }}
                    value={transaction.category?.id}
                  >
                    <SelectTrigger aria-label={`Category for ${transaction.merchant}`} className="h-7" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {categories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            <span className="flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="size-1.5 rounded-full"
                                style={{ backgroundColor: category.color }}
                              />
                              {category.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <span className="transaction-row-edge">
                    <Amount amount={transaction.amount} currency={transaction.currency} />
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

function MerchantAvatar({ name }: { name: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-medium text-muted-foreground">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function flattenTransactionGroups(groups: Array<{ label: string; rows: TransactionView[] }>): TransactionGroupItem[] {
  return groups.flatMap((group, groupIndex) => [
    {
      key: `header:${groupIndex}:${group.label}`,
      label: group.label,
      type: "header" as const
    },
    ...group.rows.map((transaction) => ({
      key: transaction.id,
      transaction,
      type: "row" as const
    }))
  ]);
}

async function fetchAllTransactionRows(request: TransactionWindowRequest): Promise<TransactionView[]> {
  const rows: TransactionView[] = [];
  let hasMore = true;
  let startingAfter = request.startingAfter;

  while (hasMore) {
    const result = await fetchTransactionWindow({
      ...request,
      referenceDate: rows[0]?.date ?? request.referenceDate,
      startingAfter
    });

    rows.push(...result.rows);
    hasMore = result.hasMore;
    startingAfter = rows.at(-1)?.id;

    if (!startingAfter) {
      break;
    }
  }

  return rows;
}

async function fetchTransactionWindow(request: TransactionWindowRequest): Promise<TransactionWindowResult> {
  const params = transactionWindowSearchParams(request);
  const response = await fetch(`/api/v1/transactions?${params.toString()}`, {
    cache: "no-store",
    signal: request.signal
  });

  if (!response.ok) {
    throw new Error("Unable to load transactions.");
  }

  const body = (await response.json()) as TransactionsApiResponse;
  const referenceDate = request.referenceDate ?? body.data[0]?.date;

  return {
    hasMore: body.has_more,
    rows: body.data.map((transaction) => transactionViewFromApi(transaction, referenceDate)),
    totalCount: body.total_count
  };
}

function transactionWindowSearchParams(request: TransactionWindowRequest): URLSearchParams {
  const params = new URLSearchParams({
    limit: String(request.limit)
  });
  const minAmountValue = parseAmountFilter(request.minAmount);
  const maxAmountValue = parseAmountFilter(request.maxAmount);
  const query = request.query.trim();

  if (request.accountId) {
    params.set("account_id", request.accountId);
  }

  if (request.categoryId !== "all") {
    params.set("category_id", request.categoryId);
  }

  if (query) {
    params.set("q", query);
  }

  if (request.reviewFilter !== "all") {
    params.set("review", request.reviewFilter);
  }

  if (minAmountValue !== undefined) {
    params.set("min_amount", String(minAmountValue));
  }

  if (maxAmountValue !== undefined) {
    params.set("max_amount", String(maxAmountValue));
  }

  if (request.startingAfter) {
    params.set("starting_after", request.startingAfter);
  }

  return params;
}

function transactionViewFromApi(transaction: TransactionApiItem, referenceDate?: string): TransactionView {
  return {
    accountId: transaction.account_id,
    accountName: transaction.account_name,
    amount: transaction.amount,
    authorizedDate: transaction.authorized_date,
    category: categoryFromApi(transaction.category),
    categoryId: transaction.category_id,
    currency: normalizeCurrencyCode(transaction.currency) ?? transaction.currency,
    date: transaction.date,
    dateLabel: formatTransactionLongDate(transaction.date),
    description: transaction.description,
    financialGoalId: transaction.financial_goal_id ?? undefined,
    id: transaction.id,
    merchant: transaction.merchant_name,
    merchantName: transaction.merchant_name,
    needsReview: transaction.needs_review,
    notes: transaction.notes,
    pairedTransactionId: transaction.paired_transaction_id ?? undefined,
    pendingTransactionId: transaction.pending_transaction_id,
    postedDate: transaction.posted_date,
    providerConnectionId: transaction.provider_connection_id,
    relativeDateLabel: getTransactionRelativeDateLabel(transaction.date, referenceDate),
    reviewed: transaction.reviewed,
    status: transaction.status,
    tags: transaction.tags
  };
}

function categoryFromApi(category: TransactionApiCategory | undefined): Category {
  if (!category) {
    return {
      archived: false,
      color: "oklch(0.72 0.04 245)",
      emoji: "🏷️",
      icon: "circle",
      id: "unknown",
      name: "Other",
      sortOrder: 999
    };
  }

  return {
    archived: category.archived ?? false,
    budgetAmount: category.budget_amount,
    color: category.color ?? "oklch(0.72 0.04 245)",
    emoji: category.emoji ?? "🏷️",
    icon: category.icon ?? "circle",
    id: category.id,
    name: category.name,
    parentId: category.parent_id,
    sortOrder: category.sort_order ?? 999
  };
}

function mergeTransactionRows(currentRows: TransactionView[], nextRows: TransactionView[]): TransactionView[] {
  return Array.from(new Map([...currentRows, ...nextRows].map((transaction) => [transaction.id, transaction])).values());
}

function evidenceFromApi(item: TransactionEvidenceApiResponse["data"][number]): TransactionEvidenceView {
  return {
    confidence: item.confidence,
    createdAt: item.created_at,
    relationship: item.relationship,
    sourceItem: {
      amount: sourceAmountForUi(item.source_item.amount),
      currency: normalizeCurrencyCode(item.source_item.currency),
      id: item.source_item.id,
      kind: item.source_item.kind,
      lines: item.source_item.lines?.map((line) => ({
        name: line.name,
        ...(line.quantity === null ? {} : { quantity: line.quantity }),
        ...(line.unit_price === null ? {} : { unitPrice: line.unit_price }),
        ...(line.amount === null ? {} : { amount: line.amount }),
        ...(line.sku === null ? {} : { sku: line.sku }),
        ...(line.category_id ? { categoryId: line.category_id } : {})
      })),
      merchantName: item.source_item.merchant_name,
      occurredAt: item.source_item.occurred_at,
      summary: item.source_item.summary,
      title: item.source_item.title
    },
    status: item.status
  };
}

function transactionMatchesInitialFilters(
  transaction: TransactionView,
  {
    accountId,
    categoryId,
    query,
    reviewFilter
  }: {
    accountId?: string;
    categoryId?: string;
    query?: string;
    reviewFilter: TransactionReviewFilter;
  }
): boolean {
  const normalizedQuery = query?.trim().toLowerCase();

  if (accountId && transaction.accountId !== accountId) {
    return false;
  }

  if (categoryId && transaction.category?.id !== categoryId) {
    return false;
  }

  if (!transactionMatchesReviewFilter(transaction, reviewFilter)) {
    return false;
  }

  if (!normalizedQuery) {
    return true;
  }

  return [
    transaction.merchant,
    transaction.accountName,
    transaction.category?.name ?? "",
    transaction.description,
    ...transaction.tags
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

function transactionMatchesReviewFilter(transaction: TransactionView, reviewFilter: TransactionReviewFilter): boolean {
  if (reviewFilter === "actionable") {
    return isReviewActionableTransaction(transaction);
  }

  if (reviewFilter === "reviewed") {
    return transaction.reviewed;
  }

  return true;
}

function isTransactionReviewFilter(value: string | null): value is TransactionReviewFilter {
  return value === "all" || value === "actionable" || value === "reviewed";
}

function isReviewSuccessMessage(message: string) {
  return /marked reviewed|category updated/i.test(message);
}

function reviewFilterLabel(reviewFilter: TransactionReviewFilter): string {
  switch (reviewFilter) {
    case "actionable":
      return "Needs review";
    case "reviewed":
      return "Reviewed";
    case "all":
      return "All";
  }
}

function accountLabel(rows: TransactionView[], accountId: string): string {
  return rows.find((transaction) => transaction.accountId === accountId)?.accountName ?? accountId;
}

function categoryLabel(categories: Category[], categoryId: string): string {
  return categories.find((category) => category.id === categoryId)?.name ?? categoryId;
}

function parseAmountFilter(value: string): number | undefined {
  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) {
    return undefined;
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

export function p95AmountRangeMax(rows: TransactionView[]): number {
  if (rows.length === 0) {
    return 100;
  }

  const magnitudes = rows.map((transaction) => Math.abs(transaction.amount)).sort((left, right) => left - right);
  const p95 = magnitudes[Math.max(0, Math.ceil(magnitudes.length * 0.95) - 1)] ?? 100;
  return niceAmountCeiling(Math.max(1, p95));
}

function niceAmountCeiling(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function niceAmountStep(maximum: number): number {
  return niceAmountCeiling(maximum / 100);
}

function amountRangeValue(minimum: string, maximum: string, bound: number): [number, number] {
  const parsedMinimum = Math.min(bound, parseAmountFilter(minimum) ?? 0);
  const parsedMaximum = Math.min(bound, parseAmountFilter(maximum) ?? bound);
  return [Math.min(parsedMinimum, parsedMaximum), Math.max(parsedMinimum, parsedMaximum)];
}

function clampAmountInput(
  value: string,
  otherValue: string,
  bound: number,
  edge: "maximum" | "minimum"
): string {
  if (value.trim().length === 0) {
    return "";
  }

  const parsed = parseAmountFilter(value);
  if (parsed === undefined) {
    return value;
  }

  const other = parseAmountFilter(otherValue);
  const clampedToBound = Math.min(bound, parsed);
  const clamped = edge === "minimum"
    ? Math.min(clampedToBound, other ?? bound)
    : Math.max(clampedToBound, other ?? 0);
  return String(clamped);
}

function transactionWindowFilterKey({
  accountId,
  categoryId,
  maxAmount,
  minAmount,
  query,
  reviewFilter
}: {
  accountId?: string;
  categoryId: string;
  maxAmount: string;
  minAmount: string;
  query: string;
  reviewFilter: TransactionReviewFilter;
}): string {
  return JSON.stringify({
    accountId: accountId ?? "",
    categoryId,
    maxAmount: parseAmountFilter(maxAmount) ?? "",
    minAmount: parseAmountFilter(minAmount) ?? "",
    query: query.trim().toLowerCase(),
    reviewFilter
  });
}

function amountFilterLabel(minAmount: string, maxAmount: string): string {
  const min = parseAmountFilter(minAmount);
  const max = parseAmountFilter(maxAmount);

  if (min !== undefined && max !== undefined) {
    return `$${min.toLocaleString()}-$${max.toLocaleString()}`;
  }

  if (min !== undefined) {
    return `from $${min.toLocaleString()}`;
  }

  if (max !== undefined) {
    return `up to $${max.toLocaleString()}`;
  }

  return "custom";
}

function sourceItemFromApi(item: SourceItemsApiResponse["data"][number]): SourceItemSearchView {
  return {
    amount: sourceAmountForUi(item.amount),
    currency: normalizeCurrencyCode(item.currency),
    id: item.id,
    kind: item.kind,
    merchantName: item.merchant_name,
    occurredAt: item.occurred_at,
    sourceId: item.source_id,
    summary: item.summary,
    title: item.title
  };
}

function sourceAmountForUi(amount: number | null | undefined): number | undefined {
  return typeof amount === "number" && Number.isFinite(amount) ? amount : undefined;
}

function formatTransactionLongDate(date: string) {
  return transactionLongDateFormatter.format(new Date(`${date}T12:00:00`));
}

function getTransactionRelativeDateLabel(date: string, referenceDate?: string) {
  if (!referenceDate) {
    return formatTransactionLongDate(date);
  }

  const dayDifference = transactionDaysBetween(date, referenceDate);

  if (dayDifference === 0) {
    return "Latest";
  }

  if (dayDifference === 1) {
    return "Previous day";
  }

  if (dayDifference > 1 && dayDifference < 7) {
    return `${dayDifference} days before latest`;
  }

  return formatTransactionLongDate(date);
}

function transactionDaysBetween(leftDate: string, rightDate: string): number {
  const left = Date.parse(`${leftDate}T12:00:00Z`);
  const right = Date.parse(`${rightDate}T12:00:00Z`);
  return Math.round((right - left) / 86_400_000);
}

function evidenceLabel(relationship: string): string {
  return relationship
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawTag of tags) {
    const tag = rawTag.trim();
    const key = tag.toLowerCase();

    if (!tag || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(tag);
  }

  return normalized;
}

function renameTags(tags: string[], oldName: string, newName: string): string[] {
  const oldKey = oldName.toLowerCase();
  return normalizeTags(tags.map((tag) => tag.toLowerCase() === oldKey ? newName : tag));
}

function groupByDate(transactions: TransactionView[]) {
  const groups = new Map<string, TransactionView[]>();

  for (const transaction of transactions) {
    const key = transaction.relativeDateLabel;
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }

  return Array.from(groups, ([label, rows]) => ({ label, rows }));
}

function groupByMerchant(transactions: TransactionView[]): MerchantGroup[] {
  const groups = new Map<string, TransactionView[]>();

  for (const transaction of transactions) {
    const key = transaction.merchant;
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }

  return Array.from(groups, ([merchant, rows]) => ({ merchant, rows })).sort(
    (left, right) => right.rows.length - left.rows.length || left.merchant.localeCompare(right.merchant)
  );
}
