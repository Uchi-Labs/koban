"use client";

import type { Category } from "@ai-finances/schema";
import * as React from "react";
import { toast } from "sonner";
import { Amount } from "@/components/amount";
import { CategoryPill } from "@/components/category-pill";
import { Button } from "@/components/ui/button";
import { CategoryPicker } from "@/components/ui/category-picker";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildRulePreviewParams,
  operatorForRuleDialogMode,
  rulePreviewKey,
  type RuleDialogMode
} from "@/lib/new-rule-dialog";
import { deriveRuleMatchValue } from "@/lib/rule-match";

const RULE_MATCH_FIELD = "merchant_or_description";

interface PreviewCategory extends Category {}

interface PreviewTransaction {
  amount: number;
  category?: PreviewCategory;
  currency: string;
  date: string;
  id: string;
  merchant_name: string;
}

interface RulePreviewResponse {
  data: PreviewTransaction[];
  has_more: boolean;
  total_count: number;
}

interface RulePreviewState {
  error: string;
  key: string;
  preview: RulePreviewResponse | null;
}

export interface NewRuleDialogProps {
  categories: Category[];
  category: Category | null;
  merchant: string;
  onCreated: (result: {
    category: Category;
    categoryId: string;
    matchedTransactionIds: string[];
    transactionsUpdated: number;
  }) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const previewDateFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

function formatPreviewDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : previewDateFormatter.format(parsed);
}

async function loadRulePreview(params: URLSearchParams, signal: AbortSignal) {
  const response = await fetch(`/api/v1/rules/preview?${params.toString()}`, { cache: "no-store", signal });
  const body = (await response.json()) as RulePreviewResponse & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Unable to load matching transactions.");
  }
  return body;
}

interface CategoryApiItem {
  archived?: boolean;
  budget_amount?: number;
  color: string;
  created_at?: string;
  emoji?: string;
  icon: string;
  id: string;
  name: string;
  parent_id?: string;
  sort_order: number;
  updated_at?: string;
}

function categoryFromApi(item: CategoryApiItem): Category {
  return {
    archived: item.archived,
    budgetAmount: item.budget_amount,
    color: item.color,
    createdAt: item.created_at,
    emoji: item.emoji,
    icon: item.icon,
    id: item.id,
    name: item.name,
    parentId: item.parent_id,
    sortOrder: item.sort_order,
    updatedAt: item.updated_at
  };
}

async function loadCategories(): Promise<Category[]> {
  const loaded: Category[] = [];
  let startingAfter = "";
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({ include_empty: "true", limit: "250" });
    if (startingAfter) {
      params.set("starting_after", startingAfter);
    }
    const response = await fetch(`/api/v1/categories?${params.toString()}`, { cache: "no-store" });
    const body = (await response.json()) as {
      data?: CategoryApiItem[];
      error?: string;
      has_more?: boolean;
    };

    if (!response.ok || !body.data) {
      throw new Error(body.error ?? "Unable to load categories.");
    }

    loaded.push(...body.data.map(categoryFromApi));
    hasMore = body.has_more === true && body.data.length > 0;
    startingAfter = body.data.at(-1)?.id ?? "";
  }

  return loaded;
}

function mergeCategories(current: Category[], incoming: Category[]): Category[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    merged.set(item.id, item);
  }
  return Array.from(merged.values()).sort((left, right) => left.sortOrder - right.sortOrder);
}

export function NewRuleDialog({
  categories,
  category,
  merchant,
  onCreated,
  onOpenChange,
  open
}: NewRuleDialogProps) {
  const initialPattern = React.useMemo(() => deriveRuleMatchValue(merchant), [merchant]);
  const [mode, setMode] = React.useState<RuleDialogMode>("partial");
  const [pattern, setPattern] = React.useState(initialPattern);
  const [debouncedPattern, setDebouncedPattern] = React.useState(initialPattern);
  const [selectedCategoryId, setSelectedCategoryId] = React.useState(category?.id ?? "");
  const [availableCategories, setAvailableCategories] = React.useState(categories);
  const [previewState, setPreviewState] = React.useState<RulePreviewState>({
    error: "",
    key: "",
    preview: null
  });
  const [creating, setCreating] = React.useState(false);
  const wasOpenRef = React.useRef(false);
  const opening = open && !wasOpenRef.current;
  const activeMode = opening ? "partial" : mode;
  const activePattern = opening ? initialPattern : pattern;
  const activeDebouncedPattern = opening ? initialPattern : debouncedPattern;
  const activeCategoryId = opening ? category?.id ?? "" : selectedCategoryId;
  const operator = operatorForRuleDialogMode(activeMode);
  const trimmedPattern = activePattern.trim();
  const previewKey = rulePreviewKey(operator, activeDebouncedPattern);
  const selectedCategory =
    availableCategories.find((item) => item.id === activeCategoryId)
    ?? (category?.id === activeCategoryId ? category : null);
  const previewReady = activeDebouncedPattern === trimmedPattern && previewState.key === previewKey;
  const previewSucceeded = previewReady && !previewState.error && previewState.preview !== null;

  React.useEffect(() => {
    setAvailableCategories((current) => mergeCategories(current, categories));
  }, [categories]);

  React.useEffect(() => {
    if (open && !wasOpenRef.current) {
      setMode("partial");
      setPattern(initialPattern);
      setDebouncedPattern(initialPattern);
      setSelectedCategoryId(category?.id ?? "");
      setPreviewState({ error: "", key: "", preview: null });
    }
    wasOpenRef.current = open;
  }, [category, initialPattern, open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const timer = window.setTimeout(() => setDebouncedPattern(trimmedPattern), 250);
    return () => window.clearTimeout(timer);
  }, [open, trimmedPattern]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    if (!activeDebouncedPattern) {
      setPreviewState({ error: "", key: previewKey, preview: null });
      return;
    }

    const controller = new AbortController();
    const params = buildRulePreviewParams({ operator, pattern: activeDebouncedPattern });

    loadRulePreview(params, controller.signal)
      .then((body) => {
        setPreviewState({ error: "", key: previewKey, preview: body });
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setPreviewState({
            error: caught instanceof Error ? caught.message : "Unable to load matching transactions.",
            key: previewKey,
            preview: null
          });
        }
      });

    return () => controller.abort();
  }, [activeDebouncedPattern, open, operator, previewKey]);

  function handleCategorySelect(categoryId: string) {
    setSelectedCategoryId(categoryId);

    if (availableCategories.some((item) => item.id === categoryId)) {
      return;
    }

    void loadCategories()
      .then((loaded) => setAvailableCategories((current) => mergeCategories(current, loaded)))
      .catch((caught: unknown) => {
        toast.error(caught instanceof Error ? caught.message : "Unable to load the new category.");
      });
  }

  async function handleCreate() {
    if (!selectedCategory || !trimmedPattern || !previewSucceeded || creating) {
      return;
    }

    setCreating(true);

    try {
      const response = await fetch("/api/v1/rules", {
        body: JSON.stringify({
          category_id: selectedCategory.id,
          mark_reviewed: false,
          match_field: RULE_MATCH_FIELD,
          match_operator: operator,
          name: `${trimmedPattern} → ${selectedCategory.name}`,
          pattern: trimmedPattern
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const body = (await response.json()) as {
        apply_result?: { transactionsUpdated?: number };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to create rule.");
      }

      const createPreviewKey = rulePreviewKey(operator, trimmedPattern);
      const matchedRows = previewState.key === createPreviewKey ? previewState.preview?.data : undefined;
      const matchedTransactionIds = (matchedRows ?? []).map((item) => item.id);
      const transactionsUpdated = body.apply_result?.transactionsUpdated ?? 0;

      onCreated({
        category: selectedCategory,
        categoryId: selectedCategory.id,
        matchedTransactionIds,
        transactionsUpdated
      });
      onOpenChange(false);
      toast.success(
        transactionsUpdated > 0
          ? `Rule created — ${transactionsUpdated.toLocaleString()} transaction${transactionsUpdated === 1 ? "" : "s"} updated`
          : "Rule created"
      );
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Unable to create rule.");
    } finally {
      setCreating(false);
    }
  }

  const currentPreview = previewReady ? previewState.preview : null;
  const totalCount = currentPreview?.total_count ?? 0;
  const rows = currentPreview?.data ?? [];
  const overflow = Math.max(0, totalCount - rows.length);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-4 sm:max-w-lg" showCloseButton>
        <header className="flex flex-col items-center gap-1 text-center">
          <DialogTitle className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            New rule for {selectedCategory?.name ?? "category"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Would you like to create a new rule for all matching transactions?
          </p>
        </header>

        <p className="text-center text-2xl font-semibold tracking-tight">{merchant}</p>

        <Tabs
          className="items-center"
          onValueChange={(value) => setMode(value as RuleDialogMode)}
          value={activeMode}
        >
          <TabsList aria-label="Match type">
            <TabsTrigger value="exact">Exact</TabsTrigger>
            <TabsTrigger value="partial">Partial</TabsTrigger>
          </TabsList>
        </Tabs>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Match text
          <Input
            aria-label="Rule match text"
            autoComplete="off"
            onChange={(event) => setPattern(event.target.value)}
            value={activePattern}
          />
        </label>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <CategoryPicker
            categories={availableCategories}
            excludeCategoryId={null}
            onSelect={handleCategorySelect}
            value={activeCategoryId}
          >
            <button
              aria-label="Change rule category"
              className="rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50"
              type="button"
            >
              {selectedCategory
                ? <CategoryPill category={selectedCategory} className="cursor-pointer" />
                : <span className="text-xs text-muted-foreground">Choose category</span>}
            </button>
          </CategoryPicker>
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="flex min-h-[8rem] flex-col gap-2">
          {previewReady && !previewState.error ? (
            <p className="text-xs font-medium text-muted-foreground tabular-nums">
              {totalCount.toLocaleString()} matching transaction{totalCount === 1 ? "" : "s"}
            </p>
          ) : null}
          {!previewReady ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading matching transactions…</p>
          ) : previewState.error ? (
            <p className="py-8 text-center text-sm text-(--negative)">{previewState.error}</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {trimmedPattern ? `No transactions match “${trimmedPattern}”.` : "Enter text to preview matches."}
            </p>
          ) : (
            <ScrollArea
              className="max-h-72"
              viewportClassName="scroll-fade-y h-fit max-h-72 overscroll-contain"
            >
              <ul className="flex flex-col">
                {rows.map((item) => (
                  <li
                    className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-sm"
                    key={item.id}
                  >
                    <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatPreviewDate(item.date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.merchant_name}</span>
                    {item.category ? (
                      <CategoryPill category={item.category} className="hidden max-w-40 shrink-0 sm:inline-flex" />
                    ) : null}
                    <Amount
                      amount={item.amount}
                      className="min-w-[5.5rem] shrink-0 text-right"
                      currency={item.currency}
                    />
                  </li>
                ))}
              </ul>
              {overflow > 0 ? (
                <p className="px-1 pt-2 text-center text-xs text-muted-foreground">+ {overflow.toLocaleString()} more</p>
              ) : null}
            </ScrollArea>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2">
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={creating || !selectedCategory || !trimmedPattern || !previewSucceeded}
            onClick={handleCreate}
            type="button"
          >
            {creating ? "Creating…" : "Create rule"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
