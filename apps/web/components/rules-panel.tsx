"use client";

import type { Category, TransactionRuleMatchOperator } from "@ai-finances/schema";
import { Check, Play, Plus, Sparkles, Trash2, X } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CategoryPill } from "@/components/category-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ProviderStatusBadge } from "@/components/provider-status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { playSuccess } from "@/lib/ui-sound";

export interface RuleView {
  categoryId?: string;
  enabled: boolean;
  id: string;
  lastAppliedAt?: string;
  lastAppliedCount: number;
  markReviewed: boolean;
  matchField: "description" | "merchant_name" | "merchant_or_description";
  matchOperator: TransactionRuleMatchOperator;
  name: string;
  pattern: string;
  tags: string[];
}

export interface EnrichmentSuggestionView {
  action: "add_tags" | "create_rule" | "mark_reviewed" | "set_category";
  categoryId?: string;
  confidence: number;
  id: string;
  markReviewed: boolean;
  reason: string;
  ruleName?: string;
  rulePattern?: string;
  status: "applied" | "dismissed" | "pending";
  tags: string[];
  transaction?: {
    amount: number;
    categoryId: string;
    currency: string;
    date: string;
    description: string;
    id: string;
    merchantName?: string;
    reviewed: boolean;
  };
  transactionId?: string;
}

export interface EnrichmentProviderView {
  baseUrl?: string;
  configured: boolean;
  errorMessage?: string;
  model?: string;
  provider: "none" | "ollama" | "openai_compatible";
  status: "not_configured" | "connected" | "syncing" | "stale" | "error";
  timeoutMs: number;
}

interface RuleApiResponse {
  apply_result?: {
    rulesApplied: number;
    transactionsUpdated: number;
  };
  data?: RuleApiRule[];
  rule?: RuleApiRule;
}

interface SuggestionApiResponse {
  data?: SuggestionApiSuggestion[];
  pendingSuggestions?: number;
  provider?: {
    completed: boolean;
    errorMessage?: string;
    provider: EnrichmentProviderView;
    suggestionsAccepted: number;
    suggestionsRejected: number;
    suggestionsSeen: number;
  };
  suggestion?: SuggestionApiSuggestion;
  suggestionsCreated?: number;
  suggestionsSeen?: number;
}

interface SuggestionBatchApiResponse {
  applied?: SuggestionBatchApiItem[];
  data?: SuggestionBatchApiItem[];
  failed?: Array<{
    error: string;
    id: string;
  }>;
}

interface SuggestionBatchApiItem {
  id: string;
  suggestion: SuggestionApiSuggestion;
}

interface SuggestionApiSuggestion {
  action: EnrichmentSuggestionView["action"];
  category_id?: string;
  confidence: number;
  id: string;
  mark_reviewed: boolean;
  reason: string;
  rule_name?: string;
  rule_pattern?: string;
  status: EnrichmentSuggestionView["status"];
  tags: string[];
  transaction?: {
    amount: number;
    category_id: string;
    currency: string;
    date: string;
    description: string;
    id: string;
    merchant_name?: string;
    reviewed: boolean;
  };
  transaction_id?: string;
}

interface RuleApiRule {
  category_id?: string;
  enabled: boolean;
  id: string;
  last_applied_at?: string;
  last_applied_count: number;
  mark_reviewed: boolean;
  match_field: RuleView["matchField"];
  match_operator: RuleView["matchOperator"];
  name: string;
  pattern: string;
  tags: string[];
}

const transactionAmountFormatters = new Map<string, Intl.NumberFormat>();

interface RulesPanelProps {
  categories: Category[];
  initialProvider: EnrichmentProviderView;
  initialSuggestions: EnrichmentSuggestionView[];
  initialRules: RuleView[];
}

export function RulesPanel(props: RulesPanelProps) {
  const model = useRulesPanelModel(props);
  return <RulesPanelLayout model={model} />;
}

function useRulesPanelModel({
  categories,
  initialProvider,
  initialSuggestions,
  initialRules
}: RulesPanelProps) {
  const [rules, setRules] = useState(initialRules);
  const [provider, setProvider] = useState(initialProvider);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [message, setMessage] = useState("");
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerMessage, setProviderMessage] = useState("");
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({
    categoryId: "cat_other",
    markReviewed: false,
    matchField: "merchant_or_description" as RuleView["matchField"],
    matchOperator: "contains" as RuleView["matchOperator"],
    name: "",
    pattern: "",
    tags: ""
  });
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const allSuggestionsSelected = suggestions.length > 0 && suggestions.every((suggestion) => selectedSuggestionIds.has(suggestion.id));

  return {
    allSuggestionsSelected,
    categories,
    categoryById,
    form,
    message,
    provider,
    providerBusy,
    providerMessage,
    rules,
    selectedSuggestionIds,
    suggestionBusy,
    suggestionMessage,
    suggestions,
    applyRules,
    batchResolveSuggestions,
    checkProvider,
    createRule,
    deleteRule,
    generateSuggestions,
    resolveSuggestion,
    setSelectedSuggestionIds,
    setForm,
    toggleSelectAllSuggestions,
    toggleSuggestionSelection,
    toggleRule
  };

  async function generateSuggestions() {
    setSuggestionBusy(true);
    setSuggestionMessage("Analyzing local ledger...");

    try {
      const response = await fetch("/api/v1/enrichment/runs", {
        body: JSON.stringify({ limit: 50 }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const body = (await response.json()) as SuggestionApiResponse & { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to generate suggestions.");
      }

      await refreshSuggestions();
      if (body.provider?.provider) {
        setProvider(providerFromApi(body.provider.provider));
      } else {
        await refreshProvider();
      }
      setSuggestionMessage(
        `Generated ${body.suggestionsSeen ?? 0} candidates. Pending suggestions: ${body.pendingSuggestions ?? 0}.${providerRunMessage(body.provider)}`
      );
    } catch (error) {
      setSuggestionMessage(error instanceof Error ? error.message : "Unable to generate suggestions.");
    } finally {
      setSuggestionBusy(false);
    }
  }

  async function checkProvider() {
    setProviderBusy(true);
    setProviderMessage("");

    try {
      const response = await fetch("/api/v1/enrichment/provider", {
        method: "POST"
      });
      const body = (await response.json()) as {
        base_url?: string;
        checked_at?: string;
        completed?: boolean;
        configured: boolean;
        error_message?: string;
        model?: string;
        provider: EnrichmentProviderView["provider"];
        status: EnrichmentProviderView["status"];
        timeout_ms: number;
      } & { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to check LLM provider.");
      }

      setProvider(providerFromApi(body));
      setProviderMessage(
        body.completed
          ? `LLM provider check passed${body.checked_at ? ` at ${new Date(body.checked_at).toLocaleString()}` : ""}.`
          : body.error_message ?? "LLM provider check did not complete."
      );
    } catch (error) {
      setProvider((currentProvider) => ({
        ...currentProvider,
        errorMessage: error instanceof Error ? error.message : "Unable to check LLM provider.",
        status: "error"
      }));
      setProviderMessage(error instanceof Error ? error.message : "Unable to check LLM provider.");
    } finally {
      setProviderBusy(false);
    }
  }

  function toggleSuggestionSelection(id: string, checked: boolean) {
    setSelectedSuggestionIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function toggleSelectAllSuggestions(checked: boolean) {
    setSelectedSuggestionIds(checked ? new Set(suggestions.map((suggestion) => suggestion.id)) : new Set());
  }

  async function batchResolveSuggestions(action: "accept" | "dismiss") {
    const ids = Array.from(selectedSuggestionIds);

    if (ids.length === 0 || suggestionBusy) {
      return;
    }

    setSuggestionBusy(true);
    setSuggestionMessage(action === "accept" ? `Applying ${ids.length} suggestions...` : `Dismissing ${ids.length} suggestions...`);

    try {
      const response = await fetch("/api/v1/enrichment/suggestions/batch", {
        body: JSON.stringify({
          action,
          suggestion_ids: ids
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const body = (await response.json()) as SuggestionBatchApiResponse & { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to update suggestions.");
      }

      const appliedItems = body.applied ?? body.data ?? [];
      const appliedIds = new Set(appliedItems.map((item) => item.id));

      setSuggestions((currentSuggestions) => currentSuggestions.filter((candidate) => !appliedIds.has(candidate.id)));
      setSelectedSuggestionIds((current) => {
        const next = new Set(current);
        for (const id of appliedIds) {
          next.delete(id);
        }
        return next;
      });
      await refreshRules();

      if (appliedIds.size > 0) {
        playSuccess();
      }

      const failedCount = body.failed?.length ?? 0;
      setSuggestionMessage(
        `${appliedIds.size.toLocaleString()} suggestions ${action === "accept" ? "applied" : "dismissed"}.${failedCount > 0 ? ` ${failedCount.toLocaleString()} failed.` : ""}`
      );
    } catch (error) {
      setSuggestionMessage(error instanceof Error ? error.message : "Unable to update suggestions.");
    } finally {
      setSuggestionBusy(false);
    }
  }

  async function resolveSuggestion(suggestion: EnrichmentSuggestionView, status: "applied" | "dismissed") {
    setSuggestionBusy(true);
    setSuggestionMessage(status === "applied" ? "Applying suggestion..." : "Dismissing suggestion...");

    try {
      const response = await fetch(`/api/v1/enrichment/suggestions/${encodeURIComponent(suggestion.id)}`, {
        body: JSON.stringify({ status }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "PATCH"
      });
      const body = (await response.json()) as SuggestionApiResponse & { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to update suggestion.");
      }

      setSuggestions((currentSuggestions) => currentSuggestions.filter((candidate) => candidate.id !== suggestion.id));
      setSelectedSuggestionIds((current) => {
        const next = new Set(current);
        next.delete(suggestion.id);
        return next;
      });
      await refreshRules();
      setSuggestionMessage(status === "applied" ? "Suggestion applied." : "Suggestion dismissed.");
    } catch (error) {
      setSuggestionMessage(error instanceof Error ? error.message : "Unable to update suggestion.");
    } finally {
      setSuggestionBusy(false);
    }
  }

  async function refreshSuggestions() {
    const response = await fetch("/api/v1/enrichment/suggestions?status=pending&limit=50", { cache: "no-store" });

    if (!response.ok) {
      return;
    }

    const body = (await response.json()) as SuggestionApiResponse;
    const nextSuggestions = (body.data ?? []).map(suggestionFromApi);
    const nextSuggestionIds = new Set(nextSuggestions.map((suggestion) => suggestion.id));
    setSuggestions(nextSuggestions);
    setSelectedSuggestionIds((current) => new Set(Array.from(current).filter((id) => nextSuggestionIds.has(id))));
  }

  async function refreshProvider() {
    const response = await fetch("/api/v1/enrichment/provider", { cache: "no-store" });

    if (!response.ok) {
      return;
    }

    const body = (await response.json()) as {
      base_url?: string;
      configured: boolean;
      error_message?: string;
      model?: string;
      provider: EnrichmentProviderView["provider"];
      status: EnrichmentProviderView["status"];
      timeout_ms: number;
    };
    setProvider(providerFromApi(body));
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("Creating rule...");

    const response = await fetch("/api/v1/rules", {
      body: JSON.stringify({
        category_id: form.categoryId,
        mark_reviewed: form.markReviewed,
        match_field: form.matchField,
        match_operator: form.matchOperator,
        name: form.name,
        pattern: form.pattern,
        tags: tagsFromInput(form.tags)
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const body = (await response.json()) as RuleApiResponse & { error?: string };

    if (!response.ok || !body.rule) {
      setMessage(body.error ?? "Unable to create rule.");
      return;
    }

    setRules((currentRules) => [ruleFromApi(body.rule!), ...currentRules]);
    setForm((current) => ({ ...current, name: "", pattern: "", tags: "" }));
    setMessage(
      `Rule created. Updated ${body.apply_result?.transactionsUpdated ?? 0} transactions from ${body.apply_result?.rulesApplied ?? 0} rule.`
    );
  }

  async function toggleRule(rule: RuleView) {
    setMessage(rule.enabled ? "Pausing rule..." : "Enabling rule...");
    const response = await fetch(`/api/v1/rules/${encodeURIComponent(rule.id)}`, {
      body: JSON.stringify({ enabled: !rule.enabled }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "PATCH"
    });
    const body = (await response.json()) as RuleApiResponse & { error?: string };

    if (!response.ok || !body.rule) {
      setMessage(body.error ?? "Unable to update rule.");
      return;
    }

    setRules((currentRules) => currentRules.map((candidate) => (candidate.id === rule.id ? ruleFromApi(body.rule!) : candidate)));
    setMessage(
      body.rule.enabled
        ? `Rule enabled. Updated ${body.apply_result?.transactionsUpdated ?? 0} transactions.`
        : "Rule paused."
    );
  }

  async function deleteRule(rule: RuleView) {
    setMessage("Deleting rule...");
    const response = await fetch(`/api/v1/rules/${encodeURIComponent(rule.id)}`, {
      method: "DELETE"
    });
    const body = (await response.json()) as { error?: string };

    if (!response.ok) {
      setMessage(body.error ?? "Unable to delete rule.");
      return;
    }

    setRules((currentRules) => currentRules.filter((candidate) => candidate.id !== rule.id));
    setMessage("Rule deleted. Existing transaction edits are preserved.");
  }

  async function applyRules() {
    setMessage("Applying enabled rules...");
    const response = await fetch("/api/v1/rules/apply", {
      method: "POST"
    });
    const body = (await response.json()) as {
      error?: string;
      rulesApplied?: number;
      transactionsUpdated?: number;
    };

    if (!response.ok) {
      setMessage(body.error ?? "Unable to apply rules.");
      return;
    }

    await refreshRules();
    setMessage(`Applied ${body.rulesApplied ?? 0} rules. Updated ${body.transactionsUpdated ?? 0} transactions.`);
  }

  async function refreshRules() {
    const response = await fetch("/api/v1/rules", { cache: "no-store" });

    if (!response.ok) {
      return;
    }

    const body = (await response.json()) as RuleApiResponse;
    setRules((body.data ?? []).map(ruleFromApi));
  }
}

type RulesPanelModel = ReturnType<typeof useRulesPanelModel>;

function RulesPanelLayout({ model }: { model: RulesPanelModel }) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <EnrichmentSuggestionsCard model={model} />
      <TransactionRulesCard model={model} />
    </div>
  );
}

function EnrichmentSuggestionsCard({ model }: { model: RulesPanelModel }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-medium">AI enrichment suggestions</h1>
          <p className="text-sm text-muted-foreground">
            Local and optional LLM enrichment jobs propose categories, tags, review actions, and rules for you to approve.
          </p>
        </div>
        <Button disabled={model.suggestionBusy} onClick={model.generateSuggestions} size="sm" type="button" variant="secondary">
          <Sparkles size={14} />
          {model.suggestionBusy ? "Analyzing..." : "Generate suggestions"}
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4 rounded-2xl bg-muted/40 px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">LLM provider</span>
            <strong className="text-sm font-semibold">{providerLabel(model.provider)}</strong>
            <em className="text-xs text-muted-foreground not-italic">
              {model.provider.model
                ? `${model.provider.model}${model.provider.baseUrl ? ` at ${model.provider.baseUrl}` : ""}`
                : model.provider.errorMessage}
            </em>
          </div>
          <div className="flex items-center gap-2">
            <ProviderStatusBadge status={model.providerBusy ? "syncing" : model.provider.status} />
            <Button
              disabled={model.providerBusy || !model.provider.configured}
              onClick={model.checkProvider}
              size="sm"
              type="button"
              variant="secondary"
            >
              {model.providerBusy ? "Checking..." : "Check provider"}
            </Button>
          </div>
        </div>
        {model.providerMessage ? (
          <p className={model.provider.status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {model.providerMessage}
          </p>
        ) : null}

        {model.suggestions.length > 0 ? (
          <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground" htmlFor="suggestion-select-all">
              <Checkbox
                aria-label="Select all suggestions"
                checked={model.allSuggestionsSelected}
                id="suggestion-select-all"
                onCheckedChange={(checked) => model.toggleSelectAllSuggestions(checked === true)}
              />
              Select all
            </label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {model.suggestions.length} pending
            </span>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          {model.suggestions.map((suggestion) => (
            <SuggestionRow
              category={suggestion.categoryId ? model.categoryById.get(suggestion.categoryId) : undefined}
              key={suggestion.id}
              onResolve={model.resolveSuggestion}
              onToggleSelected={model.toggleSuggestionSelection}
              selected={model.selectedSuggestionIds.has(suggestion.id)}
              suggestion={suggestion}
              suggestionBusy={model.suggestionBusy}
            />
          ))}
          {model.suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending enrichment suggestions. Generate suggestions to analyze the local ledger.</p>
          ) : null}
        </div>
        {model.suggestionMessage ? <p className="text-sm text-muted-foreground">{model.suggestionMessage}</p> : null}
        {model.selectedSuggestionIds.size > 0 ? (
          <div className="sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t border-border bg-card/95 py-2.5 backdrop-blur">
            <span className="text-sm">
              <strong className="tabular-nums">{model.selectedSuggestionIds.size}</strong> selected
            </span>
            <div className="flex items-center gap-2">
              <Button onClick={() => model.setSelectedSuggestionIds(new Set())} size="sm" type="button" variant="ghost">
                Clear
              </Button>
              <Button
                disabled={model.suggestionBusy}
                onClick={() => model.batchResolveSuggestions("dismiss")}
                size="sm"
                type="button"
                variant="secondary"
              >
                <X size={14} />
                Dismiss {model.selectedSuggestionIds.size}
              </Button>
              <Button
                disabled={model.suggestionBusy}
                onClick={() => model.batchResolveSuggestions("accept")}
                size="sm"
                type="button"
              >
                <Check size={14} />
                Apply {model.selectedSuggestionIds.size}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SuggestionRow({
  category,
  onResolve,
  onToggleSelected,
  selected,
  suggestion,
  suggestionBusy
}: {
  category?: Category;
  onResolve: (suggestion: EnrichmentSuggestionView, status: "applied" | "dismissed") => void;
  onToggleSelected: (id: string, checked: boolean) => void;
  selected: boolean;
  suggestion: EnrichmentSuggestionView;
  suggestionBusy: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-border p-4">
      <Checkbox
        aria-label={`Select suggestion ${suggestion.id}`}
        checked={selected}
        className="mt-1"
        onCheckedChange={(checked) => onToggleSelected(suggestion.id, checked === true)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <strong className="text-sm font-semibold">{suggestionLabel(suggestion)}</strong>
          <Badge variant="outline">{Math.round(suggestion.confidence * 100)}%</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{suggestion.reason}</p>
        {suggestion.transaction ? (
          <div className="flex flex-col gap-0.5 rounded-xl bg-muted/40 px-3 py-2">
            <strong className="text-sm font-medium">{suggestion.transaction.merchantName ?? suggestion.transaction.description}</strong>
            <span className="text-xs text-muted-foreground">
              {new Date(`${suggestion.transaction.date}T12:00:00`).toLocaleDateString()} ·{" "}
              {formatTransactionAmount(suggestion.transaction.amount, suggestion.transaction.currency)}
            </span>
            <em className="text-xs text-muted-foreground not-italic">{suggestion.transaction.reviewed ? "Reviewed" : "Needs review"}</em>
          </div>
        ) : suggestion.transactionId ? (
          <div className="flex flex-col gap-0.5 rounded-xl bg-muted/40 px-3 py-2">
            <strong className="text-sm font-medium">Transaction unavailable</strong>
            <span className="text-xs text-muted-foreground">{suggestion.transactionId}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          {category ? <CategoryPill category={category} /> : null}
          {suggestion.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
          {suggestion.rulePattern ? <Badge variant="secondary">{suggestion.rulePattern}</Badge> : null}
          {suggestion.markReviewed ? <Badge variant="secondary">reviewed</Badge> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          aria-label={`Apply suggestion ${suggestion.id}`}
          disabled={suggestionBusy}
          onClick={() => onResolve(suggestion, "applied")}
          size="sm"
          type="button"
          variant="secondary"
        >
          <Check size={14} />
          Apply
        </Button>
        <Button
          aria-label={`Dismiss suggestion ${suggestion.id}`}
          disabled={suggestionBusy}
          onClick={() => onResolve(suggestion, "dismissed")}
          size="icon-sm"
          type="button"
          variant="destructive"
        >
          <X size={15} />
        </Button>
      </div>
    </div>
  );
}

function TransactionRulesCard({ model }: { model: RulesPanelModel }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-medium">Transaction rules</h1>
          <p className="text-sm text-muted-foreground">
            Rules run locally against Teller transactions on creation, manual apply, and future Teller syncs.
          </p>
        </div>
        <Button onClick={model.applyRules} size="sm" type="button" variant="secondary">
          <Play size={14} />
          Apply enabled
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <RuleForm model={model} />
        <div className="flex flex-col gap-2">
          {model.rules.map((rule) => (
            <RuleRow
              category={rule.categoryId ? model.categoryById.get(rule.categoryId) : undefined}
              key={rule.id}
              onDelete={model.deleteRule}
              onToggle={model.toggleRule}
              rule={rule}
            />
          ))}
          {model.rules.length === 0 ? <p className="text-sm text-muted-foreground">No local transaction rules yet.</p> : null}
        </div>

        {model.message ? <p className="text-sm text-muted-foreground">{model.message}</p> : null}
      </CardContent>
    </Card>
  );
}

function RuleForm({ model }: { model: RulesPanelModel }) {
  return (
    <form className="grid grid-cols-2 gap-3 rounded-2xl bg-muted/40 p-4 md:grid-cols-3 lg:grid-cols-6" onSubmit={model.createRule}>
      <label className="flex flex-col gap-1 text-xs" htmlFor="transaction-rule-name">
        <span className="text-muted-foreground">Name</span>
        <Input
          autoComplete="off"
          id="transaction-rule-name"
          onChange={(event) => model.setForm((current) => ({ ...current, name: event.target.value }))}
          placeholder="OpenAI subscriptions"
          value={model.form.name}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs" htmlFor="transaction-rule-pattern">
        <span className="text-muted-foreground">Match</span>
        <Input
          autoComplete="off"
          id="transaction-rule-pattern"
          onChange={(event) => model.setForm((current) => ({ ...current, pattern: event.target.value }))}
          placeholder="OPENAI"
          value={model.form.pattern}
        />
      </label>
      <RuleSelects model={model} />
      <label className="flex flex-col gap-1 text-xs" htmlFor="transaction-rule-tags">
        <span className="text-muted-foreground">Tags</span>
        <Input
          autoComplete="off"
          id="transaction-rule-tags"
          onChange={(event) => model.setForm((current) => ({ ...current, tags: event.target.value }))}
          placeholder="ai, work"
          value={model.form.tags}
        />
      </label>
      <label className="col-span-2 flex items-center gap-2 text-xs md:col-span-3 lg:col-span-4" htmlFor="transaction-rule-mark-reviewed">
        <Checkbox
          checked={model.form.markReviewed}
          id="transaction-rule-mark-reviewed"
          onCheckedChange={(checked) => model.setForm((current) => ({ ...current, markReviewed: checked === true }))}
        />
        <span className="text-muted-foreground">Mark reviewed</span>
      </label>
      <Button className="col-span-2 md:col-span-1 lg:col-span-2" type="submit">
        <Plus size={15} />
        Create rule
      </Button>
    </form>
  );
}

function RuleSelects({ model }: { model: RulesPanelModel }) {
  return (
    <>
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Field</span>
        <Select
          onValueChange={(value) =>
            model.setForm((current) => ({ ...current, matchField: value as RuleView["matchField"] }))
          }
          value={model.form.matchField}
        >
          <SelectTrigger aria-label="Field" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="merchant_or_description">Merchant or description</SelectItem>
            <SelectItem value="merchant_name">Merchant</SelectItem>
            <SelectItem value="description">Description</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Operator</span>
        <Select
          onValueChange={(value) =>
            model.setForm((current) => ({ ...current, matchOperator: value as RuleView["matchOperator"] }))
          }
          value={model.form.matchOperator}
        >
          <SelectTrigger aria-label="Operator" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="contains">Contains</SelectItem>
            <SelectItem value="equals">Equals</SelectItem>
            <SelectItem value="regex">matches regex</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Category</span>
        <Select
          onValueChange={(value) => model.setForm((current) => ({ ...current, categoryId: value ?? current.categoryId }))}
          value={model.form.categoryId}
        >
          <SelectTrigger aria-label="Category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {model.categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

function RuleRow({
  category,
  onDelete,
  onToggle,
  rule
}: {
  category?: Category;
  onDelete: (rule: RuleView) => void;
  onToggle: (rule: RuleView) => void;
  rule: RuleView;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-border p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <strong className="text-sm font-semibold">{rule.name}</strong>
          <Badge variant={rule.enabled ? "default" : "outline"}>{rule.enabled ? "Enabled" : "Paused"}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {fieldLabel(rule.matchField)} {operatorLabel(rule.matchOperator)} &quot;{rule.pattern}&quot;
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {category ? <CategoryPill category={category} /> : null}
          {rule.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
          {rule.markReviewed ? <Badge variant="secondary">reviewed</Badge> : null}
        </div>
        <em className="text-xs text-muted-foreground not-italic">
          Last matched {rule.lastAppliedCount.toLocaleString()} transactions
          {rule.lastAppliedAt ? ` on ${new Date(rule.lastAppliedAt).toLocaleString()}` : ""}
        </em>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button onClick={() => onToggle(rule)} size="sm" type="button" variant="secondary">
          {rule.enabled ? "Pause" : "Enable"}
        </Button>
        <Button
          aria-label={`Delete rule ${rule.name}`}
          onClick={() => onDelete(rule)}
          size="icon-sm"
          type="button"
          variant="destructive"
        >
          <Trash2 size={15} />
        </Button>
      </div>
    </div>
  );
}

function ruleFromApi(rule: RuleApiRule): RuleView {
  return {
    categoryId: rule.category_id,
    enabled: rule.enabled,
    id: rule.id,
    lastAppliedAt: rule.last_applied_at,
    lastAppliedCount: rule.last_applied_count,
    markReviewed: rule.mark_reviewed,
    matchField: rule.match_field,
    matchOperator: rule.match_operator,
    name: rule.name,
    pattern: rule.pattern,
    tags: rule.tags
  };
}

function suggestionFromApi(suggestion: SuggestionApiSuggestion): EnrichmentSuggestionView {
  return {
    action: suggestion.action,
    categoryId: suggestion.category_id,
    confidence: suggestion.confidence,
    id: suggestion.id,
    markReviewed: suggestion.mark_reviewed,
    reason: suggestion.reason,
    ruleName: suggestion.rule_name,
    rulePattern: suggestion.rule_pattern,
    status: suggestion.status,
    tags: suggestion.tags,
    transaction: suggestion.transaction
      ? {
          amount: suggestion.transaction.amount,
          categoryId: suggestion.transaction.category_id,
          currency: suggestion.transaction.currency,
          date: suggestion.transaction.date,
          description: suggestion.transaction.description,
          id: suggestion.transaction.id,
          merchantName: suggestion.transaction.merchant_name,
          reviewed: suggestion.transaction.reviewed
        }
      : undefined,
    transactionId: suggestion.transaction_id
  };
}

function suggestionLabel(suggestion: EnrichmentSuggestionView) {
  switch (suggestion.action) {
    case "add_tags":
      return `Add ${suggestion.tags.join(", ")}`;
    case "create_rule":
      return suggestion.ruleName ?? "Create rule";
    case "mark_reviewed":
      return "Mark reviewed";
    case "set_category":
      return "Set category";
  }
}

function fieldLabel(field: RuleView["matchField"]) {
  switch (field) {
    case "description":
      return "Description";
    case "merchant_name":
      return "Merchant";
    case "merchant_or_description":
      return "Merchant or description";
  }
}

function operatorLabel(operator: RuleView["matchOperator"]) {
  switch (operator) {
    case "contains":
      return "contains";
    case "equals":
      return "equals";
    case "regex":
      return "matches regex";
  }
}

function providerLabel(provider: EnrichmentProviderView): string {
  switch (provider.provider) {
    case "ollama":
      return "Ollama";
    case "openai_compatible":
      return "OpenAI-compatible";
    case "none":
      return "Local only";
  }
}

function providerFromApi(provider: {
  base_url?: string;
  baseUrl?: string;
  configured: boolean;
  error_message?: string;
  errorMessage?: string;
  model?: string;
  provider: EnrichmentProviderView["provider"];
  status: EnrichmentProviderView["status"];
  timeout_ms?: number;
  timeoutMs?: number;
}): EnrichmentProviderView {
  return {
    baseUrl: provider.base_url ?? provider.baseUrl,
    configured: provider.configured,
    errorMessage: provider.error_message ?? provider.errorMessage,
    model: provider.model,
    provider: provider.provider,
    status: provider.status,
    timeoutMs: provider.timeout_ms ?? provider.timeoutMs ?? 20_000
  };
}

function providerRunMessage(providerRun: SuggestionApiResponse["provider"]): string {
  if (!providerRun) {
    return "";
  }

  if (!providerRun.provider.configured) {
    return " LLM provider is not configured; local enrichment was used.";
  }

  if (providerRun.errorMessage) {
    return ` LLM provider failed: ${providerRun.errorMessage}`;
  }

  return ` LLM accepted ${providerRun.suggestionsAccepted} suggestions and rejected ${providerRun.suggestionsRejected}.`;
}

function formatTransactionAmount(amount: number, currency: string): string {
  const fractionDigits = amount % 1 === 0 ? 0 : 2;
  const formatterKey = `${currency}:${fractionDigits}`;
  let formatter = transactionAmountFormatters.get(formatterKey);

  if (!formatter) {
    formatter = Intl.NumberFormat("en-US", {
      currency,
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
      style: "currency"
    });
    transactionAmountFormatters.set(formatterKey, formatter);
  }

  return formatter.format(amount);
}

function tagsFromInput(value: string): string[] {
  return value.split(",").flatMap((tag) => {
    const trimmedTag = tag.trim();
    return trimmedTag ? [trimmedTag] : [];
  });
}
