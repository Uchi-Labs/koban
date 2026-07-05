"use client";

import type { Category } from "@ai-finances/schema";
import {
  Check,
  ChevronRight,
  Download,
  Link2,
  Mic,
  Plus,
  Search,
  Square,
  X
} from "lucide-react";
import Link from "next/link";
import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Amount } from "@/components/amount";
import { CategoryPill } from "@/components/category-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { normalizeCurrencyCode } from "@/lib/currency";
import { isReviewActionableTransaction } from "@/lib/transaction-classification";
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
    merchantName?: string;
    occurredAt?: string;
    summary: string;
    title: string;
  };
  status: "accepted" | "dismissed" | "suggested";
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

interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

interface TransactionsViewProps {
  categories: Category[];
  initialAccountId?: string;
  initialCategoryId?: string;
  initialQuery?: string;
  initialReviewFilter?: TransactionReviewFilter;
  initialTab?: TransactionTab;
  transactions: TransactionView[];
}

export function TransactionsView(props: TransactionsViewProps) {
  const model = useTransactionsViewModel(props);
  return <TransactionsViewLayout model={model} />;
}

function useTransactionsViewModel({
  categories,
  initialAccountId,
  initialCategoryId,
  initialQuery,
  initialReviewFilter = "all",
  initialTab = "all",
  transactions
}: TransactionsViewProps) {
  const [rowsOverride, setRowsOverride] = useState<TransactionView[] | null>(null);
  const [tab, setTab] = useState<TransactionTab>(initialTab);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? "all");
  const [reviewFilter, setReviewFilter] = useState<TransactionReviewFilter>(initialReviewFilter);
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const rows = rowsOverride ?? transactions;
  const accountId = initialAccountId;

  function updateRows(updater: (currentRows: TransactionView[]) => TransactionView[]) {
    setRowsOverride((currentRows) => updater(currentRows ?? transactions));
  }

  const initialSelectedTransaction =
    transactions.find((transaction) =>
      transactionMatchesInitialFilters(transaction, {
        accountId,
        categoryId: initialCategoryId,
        query: initialQuery,
        reviewFilter: initialReviewFilter
      })
    ) ?? transactions[0];
  const [selectedId, setSelectedId] = useState(initialSelectedTransaction?.id ?? "");
  const [inspectorOpen, setInspectorOpen] = useState(transactions.length > 0);
  const [evidenceItems, setEvidenceItems] = useState<TransactionEvidenceView[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [inspectorMessage, setInspectorMessage] = useState("");
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
  const [reviewMessage, setReviewMessage] = useState("");

  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);

  const filteredTransactions = useMemo(() => {
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
  }, [accountId, categoryId, maxAmount, minAmount, query, reviewFilter, rows]);

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

  // Review tab: only actionable rows, honoring the shared search/account/category filters.
  const reviewTransactions = useMemo(() => {
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
  }, [accountId, categoryId, maxAmount, minAmount, query, rows]);

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

  return {
    accountId,
    allReviewSelected,
    categories,
    categoryId,
    evidenceItems,
    evidenceLoading,
    filteredTransactions,
    groupedTransactions,
    hasActiveFilters,
    inspectorMessage,
    linkEvidenceLoading,
    linkEvidenceQuery,
    linkEvidenceResults,
    linkEvidenceSearched,
    maxAmount,
    minAmount,
    noteDraft,
    query,
    reviewBusy,
    reviewFilter,
    reviewGroups,
    reviewMessage,
    reviewTransactions,
    rows,
    selectedReviewIds,
    selectedTransaction,
    selectedTransactionId,
    tab,
    tagDraft,
    voiceDraft,
    voiceRecording,
    voiceStatus,
    addTag,
    downloadTransactionsCsv,
    linkSourceItem,
    markTransactionsReviewed,
    saveContextNote,
    saveVoiceNote,
    searchSourceItems,
    selectTransaction,
    setCategoryId,
    setInspectorOpen,
    setLinkEvidenceState,
    setMaxAmount,
    setMinAmount,
    setNoteDraftState,
    setQuery,
    setReviewFilter,
    setSelectedReviewIds,
    setTab,
    setTagDraftState,
    startVoiceRecognition,
    stopVoiceRecognition,
    toggleReviewGroup,
    toggleReviewRow,
    toggleReviewed,
    toggleSelectAllReview,
    updateEvidenceStatus,
    updateTransactionCategory,
    updateTransactionTags
  };

  function selectTransaction(transaction: TransactionView) {
    if (transaction.id !== selectedTransactionId) {
      stopVoiceRecognition();
    }

    setSelectedId(transaction.id);
    setInspectorOpen(true);
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

  async function markTransactionsReviewed(ids: string[]) {
    if (ids.length === 0 || reviewBusy) {
      return;
    }

    setReviewBusy(true);
    setReviewMessage(`Marking ${ids.length.toLocaleString()} transactions reviewed...`);

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
      setReviewMessage(`${ids.length.toLocaleString()} transactions marked reviewed.`);
    } catch (error) {
      setReviewMessage(error instanceof Error ? error.message : "Unable to mark transactions reviewed.");
    } finally {
      setReviewBusy(false);
    }
  }

  async function updateTransactionCategory(transactionId: string, nextCategoryId: string) {
    const nextCategory = categoryById.get(nextCategoryId);
    setReviewMessage("Saving category...");

    const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transactionId)}`, {
      body: JSON.stringify({ category_id: nextCategoryId }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH"
    });
    const body = (await response.json().catch(() => ({}))) as TransactionPatchApiResponse;

    if (!response.ok) {
      setReviewMessage(body.error ?? "Unable to update category.");
      return;
    }

    updateRows((currentRows) =>
      currentRows.map((row) =>
        row.id === transactionId
          ? { ...row, category: nextCategory ?? row.category, categoryId: nextCategoryId }
          : row
      )
    );
    setReviewMessage("Category updated.");
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
    setInspectorMessage("Linking evidence...");

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

  function downloadTransactionsCsv() {
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
      ...filteredTransactions.map((transaction) => [
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
  }

  async function updateTransactionTags(transaction: TransactionView, tags: string[]) {
    setInspectorMessage("Saving tags...");

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
    setInspectorMessage("Tags saved to the local Teller ledger.");
  }

  async function toggleReviewed(transaction: TransactionView) {
    const nextReviewed = !transaction.reviewed;
    setInspectorMessage("Saving review state...");

    const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transaction.id)}`, {
      body: JSON.stringify({ reviewed: nextReviewed }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "PATCH"
    });
    const body = (await response.json()) as TransactionPatchApiResponse;

    if (!response.ok) {
      setInspectorMessage(body.error ?? "Unable to save review state.");
      return;
    }

    const reviewed = body.reviewed ?? body.transaction?.reviewed ?? nextReviewed;
    updateRows((currentRows) =>
      currentRows.map((row) => (row.id === transaction.id ? { ...row, needsReview: !reviewed, reviewed } : row))
    );
    setInspectorMessage(reviewed ? "Marked reviewed." : "Moved back to review.");
  }

  async function saveContextNote(transaction: TransactionView) {
    const bodyText = noteDraft.trim();

    if (!bodyText) {
      setInspectorMessage("Type a note before saving.");
      return;
    }

    setInspectorMessage("Saving context note...");

    const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transaction.id)}/context-notes`, {
      body: JSON.stringify({ body: bodyText }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const body = await response.json();

    if (!response.ok) {
      setInspectorMessage(body.error ?? "Unable to save context note.");
      return;
    }

    const nextNotes = body.transaction.notes as string | undefined;
    updateRows((currentRows) =>
      currentRows.map((row) => (row.id === transaction.id ? { ...row, notes: nextNotes ?? bodyText } : row))
    );
    setInspectorMessage("Context note saved and linked as transaction evidence.");
    await refreshEvidence(transaction.id);
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
      setVoiceStatusForTransaction(transactionId, "Recording...");
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
    setInspectorMessage("Saving voice note...");

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
    setInspectorMessage(status === "accepted" ? "Accepting evidence..." : "Dismissing evidence...");

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
      className="flex h-[100dvh] min-h-0 flex-col bg-background text-foreground"
      data-testid="transactions-page"
    >
      <Tabs
        className="flex min-h-0 flex-1 flex-col gap-0"
        onValueChange={(value) => model.setTab(value as TransactionTab)}
        value={model.tab}
      >
        <TransactionsHeader model={model} />
        <TabsContent className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]" value="all">
          <TransactionsList model={model} />
          <TransactionInspector model={model} />
        </TabsContent>
        <TabsContent className="min-h-0 flex-1 overflow-y-auto" value="review">
          <ReviewTab model={model} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function TransactionsHeader({ model }: { model: TransactionsViewModel }) {
  const commandHintId = React.useId();
  const categoryFilterItems = [
    { label: "All categories", value: "all" },
    ...model.categories.map((category) => ({ label: category.name, value: category.id }))
  ];
  const reviewFilterItems = [
    { label: "All review states", value: "all" },
    { label: "Needs review", value: "actionable" },
    { label: "Reviewed", value: "reviewed" }
  ] satisfies Array<{ label: string; value: TransactionReviewFilter }>;

  return (
    <header className="flex flex-col gap-3 border-b border-border px-3 py-2.5 sm:px-6 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        <h1 className="text-sm font-semibold tracking-tight">Transactions</h1>
        <TabsList className="min-w-0" variant="line">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="review">
            Review
            {model.reviewTransactions.length > 0 ? (
              <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px] tabular-nums" variant="review">
                {model.reviewTransactions.length}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>
      </div>

      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 md:w-auto md:flex-1 md:justify-end">
        <Button
          aria-label="Download transactions"
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
        <InputGroup className="h-8 min-w-[14rem] flex-1 rounded-xl bg-input/50 sm:w-64 sm:flex-none lg:w-72">
          <InputGroupAddon align="inline-start" className="pl-2 pr-0">
            <Search className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            aria-describedby={commandHintId}
            aria-label="Search transactions"
            className="h-8 px-2 text-sm"
            onChange={(event) => model.setQuery(event.target.value)}
            placeholder="Search"
            value={model.query}
          />
          <InputGroupAddon align="inline-end" className="gap-1 pr-1">
            {model.query ? (
              <InputGroupButton
                aria-label="Clear transaction search"
                onClick={() => model.setQuery("")}
                size="icon-xs"
                type="button"
              >
                <X className="size-3.5" />
              </InputGroupButton>
            ) : null}
            <InputGroupText>
              <kbd
                aria-label="Command K"
                className="rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
              >
                ⌘K
              </kbd>
            </InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        <div aria-label="Transaction amount filters" className="flex min-w-0 flex-1 items-center gap-1 sm:flex-none">
          <InputGroup className="h-8 min-w-0 flex-1 rounded-xl bg-input/50 sm:w-24 sm:flex-none">
            <InputGroupAddon align="inline-start" className="pl-2 pr-0">
              <InputGroupText className="text-xs">$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Minimum transaction amount"
              className="h-8 px-2 text-sm"
              inputMode="decimal"
              onChange={(event) => model.setMinAmount(event.target.value)}
              placeholder="Min"
              value={model.minAmount}
            />
          </InputGroup>
          <InputGroup className="h-8 min-w-0 flex-1 rounded-xl bg-input/50 sm:w-24 sm:flex-none">
            <InputGroupAddon align="inline-start" className="pl-2 pr-0">
              <InputGroupText className="text-xs">$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Maximum transaction amount"
              className="h-8 px-2 text-sm"
              inputMode="decimal"
              onChange={(event) => model.setMaxAmount(event.target.value)}
              placeholder="Max"
              value={model.maxAmount}
            />
          </InputGroup>
        </div>
        <Select
          items={categoryFilterItems}
          onValueChange={(value) => {
            if (typeof value === "string") {
              model.setCategoryId(value);
            }
          }}
          value={model.categoryId}
        >
          <SelectTrigger aria-label="Filter by category" className="h-8 min-w-0 flex-1 sm:w-40 sm:flex-none">
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
            items={reviewFilterItems}
            onValueChange={(value) => {
              if (isTransactionReviewFilter(value)) {
                model.setReviewFilter(value);
              }
            }}
            value={model.reviewFilter}
          >
            <SelectTrigger aria-label="Filter by review state" className="h-8 min-w-0 flex-1 sm:w-40 sm:flex-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {reviewFilterItems.map((item) => (
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
      {model.hasActiveFilters ? (
        <div
          aria-label="Active transaction filters"
          className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground sm:px-6"
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

      <div className="transaction-list-scroll min-h-0 flex-1 overflow-auto">
        {model.groupedTransactions.map((group) => (
          <section className="transaction-date-group" key={group.label}>
            <h2 className="transaction-date-header sticky top-0 z-10 border-y border-border bg-background/95 px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase backdrop-blur sm:px-6">
              {group.label}
            </h2>
            {group.rows.map((transaction) => {
              const isSelected = transaction.id === model.selectedTransaction?.id;

              return (
                <button
                  className={cn(
                    "ledger-transaction-row grid w-full items-center gap-3 border-l-2 border-transparent px-4 py-2 text-left transition-colors hover:bg-accent sm:px-6",
                    isSelected && "border-l-primary bg-accent"
                  )}
                  data-selected={isSelected ? "" : undefined}
                  data-testid="transaction-row"
                  key={transaction.id}
                  onClick={() => model.selectTransaction(transaction)}
                  type="button"
                >
                  <MerchantAvatar name={transaction.merchant} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{transaction.merchant}</span>
                    <span className="truncate text-xs text-muted-foreground">{transaction.accountName}</span>
                  </span>
                  <span className="transaction-row-status flex min-w-0 items-center gap-1.5">
                    {transaction.status === "pending" ? (
                      <Badge className="text-[10px] font-normal" variant="pending">
                        Pending
                      </Badge>
                    ) : null}
                    {/* Review state lives in the Review tab + inspector; a badge on every
                        unreviewed row (1,300+) is noise, not signal. */}
                  </span>
                  <span className="transaction-row-category shrink-0">
                    {transaction.category ? <CategoryPill category={transaction.category} /> : null}
                  </span>
                  <span className="transaction-row-edge">
                    <Amount amount={transaction.amount} currency={transaction.currency} />
                  </span>
                </button>
              );
            })}
          </section>
        ))}
        {model.filteredTransactions.length === 0 ? (
          <EmptyState
            actions={
              model.hasActiveFilters ? (
                <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/transactions">
                  Clear filters
                </Link>
              ) : null
            }
            className="m-6"
            description="Adjust the search, category, or review filters to get back to the local ledger."
            icon={<Search className="size-5" />}
            title="No transactions match the current filters."
          />
        ) : null}
      </div>
    </section>
  );
}

function TransactionInspector({ model }: { model: TransactionsViewModel }) {
  const transaction = model.selectedTransaction;

  if (!transaction) {
    return (
      <aside
        aria-label="Selected transaction inspector"
        className="hidden flex-col border-l border-border bg-card p-6 lg:flex"
        data-testid="empty-inspector"
      >
        <EmptyState
          actions={
            model.rows.length === 0 ? (
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/settings">
                Open settings
              </Link>
            ) : null
          }
          className="mt-0 border-border bg-background/40"
          description={
            model.rows.length === 0
              ? "Sync Teller data from settings to populate this view."
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
      className="hidden min-h-0 flex-col overflow-y-auto border-l border-border bg-card lg:flex"
    >
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {transaction.status === "pending" ? "Pending transaction" : "Posted transaction"}
        </span>
        <div className="flex items-center gap-1.5">
          <Button onClick={() => model.toggleReviewed(transaction)} size="sm" type="button" variant="outline">
            {transaction.reviewed ? "Move to review" : "Mark reviewed"}
          </Button>
          <Button
            aria-label="Close inspector"
            onClick={() => {
              model.stopVoiceRecognition();
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

      <section className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <span className="text-xs text-muted-foreground">{transaction.dateLabel}</span>
          <h2 className="mt-0.5 truncate text-lg font-semibold">{transaction.merchant}</h2>
          <p className="text-sm text-muted-foreground">{transaction.accountName}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs text-muted-foreground capitalize">{transaction.status}</span>
          <Badge variant={transaction.reviewed ? "synced" : "review"}>
            {transaction.reviewed ? "Reviewed" : "To review"}
          </Badge>
          <Amount amount={transaction.amount} compact currency={transaction.currency} />
        </div>
      </section>

      <Separator />
      <TransactionInspectorTags model={model} transaction={transaction} />
      <Separator />
      <TransactionInspectorNotes model={model} transaction={transaction} />
      <Separator />
      <TransactionInspectorEvidence model={model} transaction={transaction} />
      {model.inspectorMessage ? (
        <p aria-live="polite" className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          {model.inspectorMessage}
        </p>
      ) : null}
    </aside>
  );
}

function TransactionInspectorTags({ model, transaction }: { model: TransactionsViewModel; transaction: TransactionView }) {
  return (
    <section className="px-5 py-4">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tags</span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {transaction.tags.length > 0 ? (
          transaction.tags.map((tag) => (
            <button
              aria-label={`Remove tag ${tag}`}
              className="inline-flex h-6 items-center gap-1 rounded-2xl border border-border px-2 text-xs text-foreground transition-colors hover:bg-muted"
              key={tag}
              onClick={() =>
                model.updateTransactionTags(
                  transaction,
                  transaction.tags.filter((candidate) => candidate !== tag)
                )
              }
              type="button"
            >
              {tag}
              <X className="size-3 text-muted-foreground" />
            </button>
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
          value={model.tagDraft}
        />
        <Button aria-label="Add tag" size="icon-sm" type="submit" variant="outline">
          <Plus className="size-4" />
        </Button>
      </form>
    </section>
  );
}

function TransactionInspectorNotes({ model, transaction }: { model: TransactionsViewModel; transaction: TransactionView }) {
  return (
    <section className="px-5 py-4">
      <label className="flex flex-col gap-1.5" htmlFor="transaction-context-note">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Context note</span>
        <Textarea
          aria-label="Context note"
          className="min-h-20"
          id="transaction-context-note"
          onChange={(event) =>
            model.setNoteDraftState({
              transactionId: transaction.id,
              value: event.target.value
            })
          }
          placeholder="Add context for this transaction"
          value={model.noteDraft}
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button onClick={() => model.saveContextNote(transaction)} size="sm" type="button" variant="outline">
          Save note
        </Button>
        <Button
          onClick={model.voiceRecording ? model.stopVoiceRecognition : model.startVoiceRecognition}
          size="sm"
          type="button"
          variant="outline"
        >
          {model.voiceRecording ? <Square className="size-3.5" /> : <Mic className="size-4" />}
          {model.voiceRecording ? "Stop" : "Record"}
        </Button>
        {model.voiceDraft ? (
          <Button onClick={() => model.saveVoiceNote(transaction)} size="sm" type="button" variant="outline">
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
    <section aria-label="Transaction evidence" className="px-5 py-4">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <Link2 className="size-3.5" />
          Evidence
        </span>
        <Badge className="tabular-nums" variant="synced">{model.evidenceItems.length}</Badge>
      </header>
      {model.evidenceLoading ? (
        <div className="mt-2 grid gap-2">
          <p className="text-sm text-muted-foreground">Loading evidence...</p>
          <Skeleton className="h-3" variant="long" />
          <Skeleton className="h-3" variant="short" />
        </div>
      ) : null}
      {!model.evidenceLoading && model.evidenceItems.length === 0 ? (
        <EmptyState
          className="mt-2"
          description="Link receipts, emails, or imported source items when a transaction needs supporting context."
          icon={<Link2 className="size-5" />}
          size="sm"
          title="No linked evidence yet."
        />
      ) : null}
      <div className="mt-2 flex flex-col gap-2">
        {model.evidenceItems.map((item) => (
          <article
            className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5"
            key={`${item.sourceItem.id}:${item.relationship}`}
          >
            <div className="min-w-0">
              <strong className="text-sm font-medium">{item.sourceItem.title}</strong>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {evidenceLabel(item.relationship)} · {item.status} · {Math.round(item.confidence * 100)}%
              </span>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.sourceItem.summary}</p>
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
            {model.linkEvidenceLoading ? "Searching..." : "Search source items"}
          </Button>
        </form>
        {model.linkEvidenceLoading ? (
          <div className="mt-2 grid gap-2">
            <p className="text-sm text-muted-foreground">Searching imported evidence...</p>
            <Skeleton className="h-3" />
            <Skeleton className="h-3" variant="short" />
          </div>
        ) : null}
        {!model.linkEvidenceLoading && model.linkEvidenceSearched && model.linkEvidenceResults.length === 0 ? (
          <EmptyState
            className="mt-2"
            description="Try the merchant name, amount, or a receipt keyword from your imported evidence sources."
            icon={<Search className="size-5" />}
            size="sm"
            title="No source items found."
          />
        ) : null}
        {!model.linkEvidenceLoading && model.linkEvidenceResults.length > 0 ? (
          <div className="mt-2 flex flex-col gap-2">
            {model.linkEvidenceResults.map((item) => (
              <article
                className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5"
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
          actions={<Badge variant="synced">Review clear</Badge>}
          className="mx-auto max-w-xl"
          description="Every transaction matching the current filters has been reviewed."
          icon={<Check className="size-5 animate-bounce-in" />}
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
          {model.reviewTransactions.length} to review
        </span>
      </div>

      <div className="flex flex-col gap-2 px-4 py-3 sm:px-6">
        {model.reviewGroups.map((group) => (
          <MerchantReviewGroup
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
      </div>

      {model.reviewMessage ? (
        <p aria-live="polite" className="inline-flex items-center gap-1.5 px-6 pb-4 text-xs text-muted-foreground">
          {isReviewSuccessMessage(model.reviewMessage) ? (
            <Check className="size-3.5 animate-bounce-in text-(--positive)" />
          ) : null}
          {model.reviewMessage}
        </p>
      ) : null}

      {model.selectedReviewIds.size > 0 ? (
        <div className="sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t border-border bg-card/95 px-4 py-2.5 backdrop-blur sm:px-6">
          <span className="text-sm">
            <strong className="tabular-nums">{model.selectedReviewIds.size}</strong> selected
          </span>
          <div className="flex items-center gap-2">
            <Button onClick={() => model.setSelectedReviewIds(new Set())} size="sm" type="button" variant="ghost">
              Clear
            </Button>
            <Button
              disabled={model.reviewBusy}
              onClick={() => model.markTransactionsReviewed(Array.from(model.selectedReviewIds))}
              size="sm"
              type="button"
            >
              <Check className="size-4" />
              {model.reviewBusy ? "Marking..." : `Mark ${model.selectedReviewIds.size} reviewed`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MerchantReviewGroup({
  categories,
  group,
  onApproveGroup,
  onToggleGroup,
  onToggleRow,
  onUpdateCategory,
  reviewBusy,
  selectedIds
}: {
  categories: Category[];
  group: MerchantGroup;
  onApproveGroup: () => void;
  onToggleGroup: (checked: boolean) => void;
  onToggleRow: (id: string, checked: boolean) => void;
  onUpdateCategory: (transactionId: string, categoryId: string) => void;
  reviewBusy: boolean;
  selectedIds: Set<string>;
}) {
  const allSelected = group.rows.every((row) => selectedIds.has(row.id));
  const categorySelectItems = categories.map((category) => ({
    label: category.name,
    value: category.id
  }));

  return (
    <Collapsible className="overflow-hidden rounded-xl border border-border" defaultOpen>
      <div className="flex items-center gap-3 bg-muted/30 px-3 py-2">
        <Checkbox
          aria-label={`Select all ${group.rows.length} ${group.merchant}`}
          className="after:-inset-3"
          checked={allSelected}
          onCheckedChange={(checked) => onToggleGroup(checked === true)}
        />
        <CollapsibleTrigger className="group/trigger flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/trigger:rotate-90" />
          <MerchantAvatar name={group.merchant} />
          <span className="truncate text-sm font-medium">{group.merchant}</span>
          <Badge className="tabular-nums" variant="review">
            {group.rows.length}
          </Badge>
        </CollapsibleTrigger>
        <Button disabled={reviewBusy} onClick={onApproveGroup} size="xs" type="button" variant="outline">
          <Check className="size-3" />
          Approve all {group.rows.length}
        </Button>
      </div>
      <CollapsibleContent>
        <div className="overflow-x-auto">
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
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MerchantAvatar({ name }: { name: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
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
