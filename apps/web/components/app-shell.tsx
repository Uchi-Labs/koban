"use client";

import type { Account, AccountGroup } from "@ai-finances/schema";
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
  Settings,
  WalletCards
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useState } from "react";
import { formatCurrency } from "@/lib/format";
import { attachGlobalUiSounds, playError, playSuccess, playTap } from "@/lib/ui-sound";
import { CommandPalette } from "@/components/command-palette";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const accountColorByType = {
  cash: "#94a3b8",
  checking: "#1594f2",
  credit_card: "#f59e0b",
  investment: "#14b8a6",
  loan: "#ef4444",
  savings: "#1f9bd7"
};

const navItems = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, activePath: "/" },
  { label: "Transactions", href: "/transactions", icon: Layers, activePath: "/transactions" },
  { label: "Accounts", href: "/accounts", icon: CreditCard, activePath: "/accounts" },
  { label: "Investments", href: "/investments", icon: BarChart3, activePath: "/investments" },
  { label: "Categories", href: "/categories", icon: PieChart, activePath: "/categories" },
  { label: "Recurrings", href: "/recurrings", icon: Repeat2, activePath: "/recurrings" },
  { label: "Rules", href: "/rules", icon: ScrollText, activePath: "/rules" },
  { label: "Agent", href: "/assistant", icon: Bot, activePath: "/assistant" },
  { label: "Settings", href: "/settings", icon: Settings, activePath: "/settings" }
];

const syncAgeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short"
});

export function AppShell({
  accountGroups,
  accounts,
  lastSyncedAt,
  source,
  transactionCount,
  children
}: {
  accountGroups: AccountGroup[];
  accounts: Account[];
  lastSyncedAt?: string;
  source: "empty" | "teller";
  transactionCount: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const accountById = React.useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);

  const [paletteOpen, setPaletteOpen] = useState(false);

  React.useEffect(() => attachGlobalUiSounds(), []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function syncNow() {
    setSyncing(true);
    playTap();
    try {
      const response = await fetch("/api/v1/sync-runs", {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      if (response.ok) {
        playSuccess();
      } else {
        playError();
      }
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="sidebar">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-0.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary group-data-[collapsible=icon]:hidden">
              <WalletCards className="size-4" />
            </div>
            <span className="truncate text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
              AI Finances
            </span>
            <SidebarTrigger className="ml-auto group-data-[collapsible=icon]:ml-0" />
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <button
                aria-label="Open search"
                className="mx-2 mb-1 flex h-8 items-center gap-2 rounded-lg border border-input bg-input/30 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-input/50 hover:text-foreground group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                onClick={() => setPaletteOpen(true)}
                type="button"
              >
                <Search className="size-4 shrink-0" />
                <span className="flex-1 text-left group-data-[collapsible=icon]:hidden">Search</span>
                <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                  ⌘K
                </kbd>
              </button>
              <SidebarMenu aria-label="Primary">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active =
                    item.activePath === "/"
                      ? pathname === "/"
                      : Boolean(item.activePath && pathname.startsWith(item.activePath));

                  return (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        isActive={active}
                        render={<Link href={item.href} />}
                        tooltip={item.label}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {accountGroups.map((group) => (
            <SidebarGroup className="group-data-[collapsible=icon]:hidden" key={group.id}>
              <SidebarGroupLabel>{group.name}</SidebarGroupLabel>
              <SidebarGroupContent>
                <ul className="flex flex-col gap-0.5 px-2">
                  {group.accountIds.flatMap((accountId) => {
                    const account = accountById.get(accountId);

                    return account ? [
                      <li className="flex items-center gap-2 rounded-md px-2 py-1 text-xs" key={account.id}>
                        <span
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: accountColorByType[account.type] }}
                        />
                        <span className="min-w-0 flex-1 truncate text-sidebar-foreground/70">{account.name}</span>
                        <span className="shrink-0 font-medium tabular-nums">
                          {formatCurrency(Math.abs(account.currentBalance), account.currency)}
                        </span>
                      </li>
                    ] : [];
                  })}
                </ul>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter className="group-data-[collapsible=icon]:hidden">
          <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-3 text-xs">
            <p className="font-medium">
              {source === "teller" ? "Teller synced" : "No Teller data"}
            </p>
            <p className="mt-1 text-sidebar-foreground/60">
              {source === "teller"
                ? `${accounts.length} accounts · ${transactionCount.toLocaleString()} transactions. ${formatSyncAge(lastSyncedAt)}`
                : "Connect Teller in Settings to populate accounts and transactions."}
            </p>
            <Button
              className="mt-2 w-full"
              disabled={syncing}
              onClick={syncNow}
              size="sm"
              variant="outline"
            >
              <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      {/* ponytail: legacy pages offset themselves by --sidebar-width; zero it inside the inset until every page is migrated */}
      <SidebarInset style={{ ["--sidebar-width" as string]: "0px" }}>{children}</SidebarInset>
      <CommandPalette onOpenChangeAction={setPaletteOpen} open={paletteOpen} />
    </SidebarProvider>
  );
}

function formatSyncAge(lastSyncedAt?: string) {
  if (!lastSyncedAt) {
    return "Sync time unavailable.";
  }

  return `Last sync ${syncAgeFormatter.format(new Date(lastSyncedAt))}.`;
}
