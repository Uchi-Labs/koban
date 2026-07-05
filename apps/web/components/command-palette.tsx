"use client";

import {
  BarChart3,
  Bot,
  CreditCard,
  Layers,
  LayoutDashboard,
  PieChart,
  RefreshCw,
  Repeat2,
  ScrollText,
  Search,
  Settings
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
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
import { playNav, playTap } from "@/lib/ui-sound";

const destinations = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/transactions", icon: Layers, label: "Transactions" },
  { href: "/transactions?tab=review", icon: Layers, label: "Review queue" },
  { href: "/accounts", icon: CreditCard, label: "Accounts" },
  { href: "/investments", icon: BarChart3, label: "Investments" },
  { href: "/categories", icon: PieChart, label: "Categories" },
  { href: "/recurrings", icon: Repeat2, label: "Recurrings" },
  { href: "/rules", icon: ScrollText, label: "Rules" },
  { href: "/assistant", icon: Bot, label: "Agent" },
  { href: "/settings", icon: Settings, label: "Settings" }
];

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
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SemanticResult[]>([]);
  const [searching, setSearching] = React.useState(false);

  React.useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/v1/search?q=${encodeURIComponent(trimmed)}&limit=6`,
          { signal: controller.signal }
        );
        if (response.ok) {
          const body = (await response.json()) as { data?: SemanticResult[] };
          setResults(body.data ?? []);
        }
      } catch {
        /* aborted or offline — stale results are fine */
      } finally {
        setSearching(false);
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  function go(href: string) {
    playNav();
    onOpenChangeAction(false);
    setQuery("");
    router.push(href);
  }

  async function syncNow() {
    playTap();
    onOpenChangeAction(false);
    await fetch("/api/v1/sync-runs", {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    router.refresh();
  }

  return (
    <CommandDialog onOpenChange={onOpenChangeAction} open={open} title="Search" description="Search transactions, evidence, and pages">
      <Command shouldFilter={false}>
        <CommandInput
          onValueChange={setQuery}
          placeholder="Search transactions, evidence, pages…"
          value={query}
        />
        <CommandList>
          <CommandEmpty>{searching ? "Searching your ledger…" : "No results."}</CommandEmpty>

          {results.length > 0 ? (
            <CommandGroup heading="Transactions & evidence">
              {results.map((result) => (
                <CommandItem
                  key={`${result.resource_type}-${result.resource_id}`}
                  onSelect={() => go(`/transactions?q=${encodeURIComponent(result.title)}`)}
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
            {destinations
              .filter(
                (destination) =>
                  query.trim().length < 2 ||
                  destination.label.toLowerCase().includes(query.trim().toLowerCase())
              )
              .map((destination) => {
                const Icon = destination.icon;
                return (
                  <CommandItem
                    key={destination.href}
                    onSelect={() => go(destination.href)}
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
            <CommandItem onSelect={() => void syncNow()} value="action-sync">
              <RefreshCw className="text-muted-foreground" />
              Sync everything
              <CommandShortcut>Teller + sources + AI</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
