"use client";

import {
  ArrowLeft,
  BarChart3,
  Bot,
  CreditCard,
  Layers,
  LayoutDashboard,
  PanelRightOpen,
  PieChart,
  RefreshCw,
  Repeat2,
  ScrollText,
  Search,
  Settings,
  Sparkles
} from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AgentAnswer } from "@/components/agent-answer";
import { useAgentPanel } from "@/components/agent-panel-provider";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
} from "@/components/ui/command";
import { CommandDialog } from "@/components/ui/command";
import { Amount } from "@/components/amount";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { looksLikeQuestion } from "@/lib/agent-question";
import { useAgentStream } from "@/lib/hooks/use-agent-stream";
import { EASE_OUT } from "@/lib/motion";
import { playClose, playError, playOpen, playSelect, playSuccess, playSync } from "@/lib/ui-sound";

type Destination =
  | { href: string; icon: typeof LayoutDashboard; label: string }
  | { action: "agent"; icon: typeof Bot; label: string };

const destinations: Destination[] = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/transactions", icon: Layers, label: "Transactions" },
  { href: "/transactions?tab=review", icon: Layers, label: "Review queue" },
  { href: "/accounts", icon: CreditCard, label: "Accounts" },
  { href: "/investments", icon: BarChart3, label: "Investments" },
  { href: "/categories", icon: PieChart, label: "Categories" },
  { href: "/recurrings", icon: Repeat2, label: "Recurrings" },
  { href: "/rules", icon: ScrollText, label: "Rules" },
  { action: "agent", icon: Bot, label: "Agent" },
  { href: "/settings", icon: Settings, label: "Settings" }
];

function matchingDestinations(query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery.length < 2) {
    return destinations;
  }

  return destinations.reduce<typeof destinations>((matches, destination) => {
    if (destination.label.toLowerCase().includes(normalizedQuery)) {
      matches.push(destination);
    }

    return matches;
  }, []);
}

interface SemanticResult {
  resource_id: string;
  resource_type: string;
  title: string;
  transaction?: {
    amount: number;
    currency: string;
    date: string;
    merchantName?: string;
  };
}

export function CommandPalette({
  onOpenChangeAction,
  open
}: {
  onOpenChangeAction: (open: boolean) => void;
  open: boolean;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const agentPanel = useAgentPanel();
  const agentStream = useAgentStream();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SemanticResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [inlineQuestion, setInlineQuestion] = React.useState("");
  const searchControllerRef = React.useRef<AbortController | null>(null);
  const searchTimerRef = React.useRef<number | null>(null);
  const { showToast, updateToast } = useToast();
  const inlineAnswerOpen = inlineQuestion.length > 0;
  const canAskAgent = looksLikeQuestion(query) && !inlineAnswerOpen && agentStream.status !== "streaming";

  React.useEffect(() => {
    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }

      searchControllerRef.current?.abort();
    };
  }, []);

  function stopSearch() {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }

    searchControllerRef.current?.abort();
  }

  function handleQueryChange(nextQuery: string) {
    const trimmed = nextQuery.trim();

    setQuery(nextQuery);
    stopSearch();

    if (inlineAnswerOpen) {
      setResults([]);
      setSearching(false);
      return;
    }

    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    searchControllerRef.current = controller;
    setSearching(true);
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/search?q=${encodeURIComponent(trimmed)}&limit=6`, {
          signal: controller.signal
        });
        if (response.ok) {
          const body = (await response.json()) as { data?: SemanticResult[] };
          setResults(body.data ?? []);
        }
      } catch {
        /* aborted or offline — stale results are fine */
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      }
    }, 180);
  }

  function startInlineAnswer(nextQuestion = query) {
    const question = nextQuestion.trim();

    if (!looksLikeQuestion(question) || agentStream.status === "streaming") {
      return;
    }

    stopSearch();
    setResults([]);
    setSearching(false);
    setInlineQuestion(question);
    playOpen();
    agentStream.ask(question);
  }

  function collapseInlineAnswer() {
    if (inlineAnswerOpen) {
      playClose();
    }

    agentStream.reset();
    setInlineQuestion("");
  }

  function openAgentFromPalette(prefill?: string) {
    playSelect();
    agentPanel.openAgent(prefill);
    agentStream.reset();
    setInlineQuestion("");
    setQuery("");
    onOpenChangeAction(false);
  }

  function go(href: string) {
    playSelect();
    onOpenChangeAction(false);
    setQuery("");
    router.push(href);
  }

  function runDestination(destination: Destination) {
    if ("action" in destination) {
      openAgentFromPalette();
      return;
    }

    go(destination.href);
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen && inlineAnswerOpen) {
      collapseInlineAnswer();
      return;
    }

    if (!nextOpen) {
      agentStream.reset();
      setInlineQuestion("");
    }

    onOpenChangeAction(nextOpen);
  }

  function handleCommandKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && inlineAnswerOpen) {
      event.preventDefault();
      event.stopPropagation();
      collapseInlineAnswer();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && looksLikeQuestion(query)) {
      event.preventDefault();
      startInlineAnswer();
    }
  }

  async function syncNow() {
    playSync();
    onOpenChangeAction(false);
    const loadingDescription = "Running whole-app sync from the command palette.";
    const toastId = showToast({
      description: (
        <span className="t-shimmer" data-text={loadingDescription}>
          {loadingDescription}
        </span>
      ),
      duration: 0,
      status: "loading",
      title: "Sync started",
    });

    try {
      const response = await fetch("/api/v1/sync-runs", {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST"
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Sync failed.");
      }

      updateToast(toastId, {
        description: "The local ledger has been refreshed.",
        duration: 3600,
        status: "success",
        title: "Sync complete",
      });
      playSuccess();
      router.refresh();
    } catch (error) {
      updateToast(toastId, {
        description: error instanceof Error ? error.message : "Sync failed.",
        duration: 5200,
        status: "error",
        title: "Sync failed",
      });
      playError();
    }
  }

  return (
    <CommandDialog onOpenChange={handleDialogOpenChange} open={open} title="Search" description="Search transactions, evidence, and pages">
      <Command onKeyDownCapture={handleCommandKeyDown} shouldFilter={false}>
        <CommandInput
          onValueChange={handleQueryChange}
          placeholder={inlineAnswerOpen ? "Ask another finance question…" : "Search transactions, evidence, pages…"}
          value={query}
        />
        <InlineAgentPanel
          agentStream={agentStream}
          inlineQuestion={inlineQuestion}
          onBack={collapseInlineAnswer}
          onOpenPanel={() => openAgentFromPalette(inlineQuestion || query)}
          open={inlineAnswerOpen}
          reduce={reduce}
        />

        {!inlineAnswerOpen ? (
          <PaletteCommandList
            canAskAgent={canAskAgent}
            onAsk={() => startInlineAnswer()}
            onGo={go}
            onRunDestination={runDestination}
            onSync={() => void syncNow()}
            query={query}
            results={results}
            searching={searching}
          />
        ) : null}
      </Command>
    </CommandDialog>
  );
}

function InlineAgentPanel({
  agentStream,
  inlineQuestion,
  onBack,
  onOpenPanel,
  open,
  reduce
}: {
  agentStream: ReturnType<typeof useAgentStream>;
  inlineQuestion: string;
  onBack: () => void;
  onOpenPanel: () => void;
  open: boolean;
  reduce: boolean | null;
}) {
  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence initial={false}>
        {open ? (
          <m.div
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0.15 } : { duration: 0.35, ease: EASE_OUT }}
          >
            <div className="scroll-fade flex max-h-[30rem] flex-col gap-3 overflow-y-auto px-3 pt-3 pb-4">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs text-muted-foreground">{inlineQuestion}</p>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    className="h-7 rounded-xl px-2 text-xs"
                    data-sound="none"
                    onClick={onOpenPanel}
                    type="button"
                    variant="ghost"
                  >
                    <PanelRightOpen className="size-3.5" />
                    Open in panel
                  </Button>
                  <Button
                    className="h-7 rounded-xl px-2 text-xs"
                    data-sound="none"
                    onClick={onBack}
                    type="button"
                    variant="ghost"
                  >
                    <ArrowLeft className="size-3.5" />
                    Back to search
                  </Button>
                </div>
              </div>
              <AgentAnswer
                answer={agentStream.answer}
                meta={agentStream.meta}
                question={agentStream.question || inlineQuestion}
                status={agentStream.status}
                variant="inline"
              />
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </LazyMotion>
  );
}

function PaletteCommandList({
  canAskAgent,
  onAsk,
  onGo,
  onRunDestination,
  onSync,
  query,
  results,
  searching
}: {
  canAskAgent: boolean;
  onAsk: () => void;
  onGo: (href: string) => void;
  onRunDestination: (destination: Destination) => void;
  onSync: () => void;
  query: string;
  results: SemanticResult[];
  searching: boolean;
}) {
  return (
    <CommandList>
      <CommandEmpty>{searching ? "Searching your ledger…" : "No results."}</CommandEmpty>

      {canAskAgent ? (
        <>
          <CommandGroup heading="Agent">
            <CommandItem data-sound="none" onSelect={onAsk} value={`ask-agent-${query}`}>
              <Sparkles className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">Ask the agent: "{query.trim()}"</span>
              <CommandShortcut>⌘↵</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
        </>
      ) : null}

      {results.length > 0 ? (
        <CommandGroup heading="Transactions & evidence">
          {results.map((result) => (
            <CommandItem
              data-sound="none"
              key={`${result.resource_type}-${result.resource_id}`}
              onSelect={() => onGo(`/transactions?q=${encodeURIComponent(result.title)}`)}
              value={`${result.resource_type}-${result.resource_id}`}
            >
              <Search className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{result.title}</span>
              {result.transaction ? (
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {result.transaction.date}
                  <Amount amount={result.transaction.amount} currency={result.transaction.currency} />
                </span>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">evidence</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}

      {results.length > 0 ? <CommandSeparator /> : null}

      <CommandGroup heading="Go to">
        {matchingDestinations(query).map((destination) => {
          const Icon = destination.icon;
          return (
            <CommandItem
              data-sound="none"
              key={"href" in destination ? destination.href : destination.label}
              onSelect={() => onRunDestination(destination)}
              value={`nav-${destination.label}`}
            >
              <Icon className="text-muted-foreground" />
              {destination.label}
            </CommandItem>
          );
        })}
      </CommandGroup>

      <CommandSeparator />

      <CommandGroup heading="Actions">
        <CommandItem data-sound="none" onSelect={onSync} value="action-sync">
          <RefreshCw className="text-muted-foreground" />
          Sync everything
          <CommandShortcut>Providers + sources + AI</CommandShortcut>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  );
}
