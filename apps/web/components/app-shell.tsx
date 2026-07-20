"use client";

import type { Account, AccountGroup } from "@ai-finances/schema";
import {
  ArrowLeftRight,
  BarChart3,
  Check,
  CircleAlert,
  CreditCard,
  Flag,
  Layers,
  LayoutDashboard,
  Lightbulb,
  LoaderCircle,
  PieChart,
  Plus,
  RefreshCw,
  Repeat2,
  ScrollText,
  Search,
  Settings
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useState } from "react";
import { attachGlobalUiSounds, playClose, playError, playOpen, playSuccess, prepareUiSound } from "@/lib/ui-sound";
import { AgentPanelProvider, useAgentPanel } from "@/components/agent-panel-provider";
import { SidebarAccountRow } from "@/components/sidebar-account-row";
import { SyncProvider } from "@/components/sync-provider";
import { AgentChatSidebar } from "@/components/agent-chat-sidebar";
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar
} from "@/components/ui/sidebar";
import { Dock, DockItem } from "@/components/motion/dock";
import { SharedLayoutBg } from "@/components/ui/shared-layout-bg";
import { SyncStatusIsland } from "@/components/ui/sync-status-island";
import { ActionSwapIcon, ActionSwapText } from "@/components/ui/action-swap";
import { Button } from "@/components/ui/button";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { deriveSyncIslandState, SYNC_ISLAND_PHASE_COUNT } from "@/lib/sync-island-state";
import { cn } from "@/lib/utils";

const accountColorByType = {
  cash: "var(--muted-foreground)",
  checking: "var(--chart-1)",
  credit_card: "var(--chart-2)",
  investment: "var(--chart-5)",
  loan: "var(--negative)",
  savings: "var(--primary)"
};

const navItems = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, activePath: "/" },
  { label: "Transactions", href: "/transactions", icon: Layers, activePath: "/transactions" },
  { label: "Review", href: "/review", icon: Check, activePath: "/review" },
  { label: "Insights", href: "/insights", icon: Lightbulb, activePath: "/insights" },
  { label: "Goals", href: "/goals", icon: Flag, activePath: "/goals" },
  { label: "Cash flow", href: "/cash-flow", icon: ArrowLeftRight, activePath: "/cash-flow" },
  { label: "Accounts", href: "/accounts", icon: CreditCard, activePath: "/accounts" },
  { label: "Investments", href: "/investments", icon: BarChart3, activePath: "/investments" },
  { label: "Categories", href: "/categories", icon: PieChart, activePath: "/categories" },
  { label: "Recurrings", href: "/recurrings", icon: Repeat2, activePath: "/recurrings" },
  { label: "Rules", href: "/rules", icon: ScrollText, activePath: "/rules" },
  { label: "Settings", href: "/settings", icon: Settings, activePath: "/settings" }
];

const mobileNavItems = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Transactions", href: "/transactions", icon: Layers },
  { label: "Review", href: "/review", icon: Check },
  { label: "Recurrings", href: "/recurrings", icon: Repeat2 },
  { label: "Cash flow", href: "/cash-flow", icon: ArrowLeftRight }
];

const SIDEBAR_MIN_WIDTH = 208;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_DEFAULT_WIDTH = 256;
const SIDEBAR_WIDTH_STORAGE_KEY = "koban:sidebar-width";

function clampSidebarWidth(px: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, px));
}

function readStoredSidebarWidth() {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  const parsed = Number.parseInt(stored, 10);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : null;
}

function SidebarResizeHandle({
  onReset,
  onResize,
  onResizeEnd,
  onResizeStart
}: {
  onReset: () => void;
  onResize: (px: number) => void;
  onResizeEnd: (px: number) => void;
  onResizeStart: () => void;
}) {
  const { isMobile, state } = useSidebar();
  const [dragging, setDragging] = useState(false);
  const latestWidth = React.useRef(SIDEBAR_DEFAULT_WIDTH);

  if (isMobile || state === "collapsed") {
    return null;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const container = event.currentTarget.closest<HTMLElement>('[data-slot="sidebar-container"]');
    const left = container?.getBoundingClientRect().left ?? 0;

    setDragging(true);
    onResizeStart();
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const handleMove = (moveEvent: PointerEvent) => {
      const next = clampSidebarWidth(moveEvent.clientX - left);
      latestWidth.current = next;
      onResize(next);
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      setDragging(false);
      onResizeEnd(latestWidth.current);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return (
    <button
      aria-label="Drag to resize sidebar. Double-click to reset."
      className="group/resize absolute inset-y-0 -right-1 z-30 hidden w-2 cursor-col-resize touch-none select-none group-data-[collapsible=icon]:hidden md:block"
      data-dragging={dragging ? "true" : undefined}
      onDoubleClick={onReset}
      onPointerDown={handlePointerDown}
      tabIndex={-1}
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 right-1 w-0.5 transition-colors motion-reduce:transition-none",
          dragging ? "bg-primary" : "bg-transparent group-hover/resize:bg-primary/50"
        )}
      />
    </button>
  );
}

const syncAgeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short"
});

interface AppShellProps {
  accountGroups: AccountGroup[];
  accounts: Account[];
  children: React.ReactNode;
  demoMode?: boolean;
  lastSyncedAt?: string;
  reviewActionableCount: number;
  source: "empty" | "koban";
  transactionCount: number;
}

export function AppShell(props: AppShellProps) {
  return (
    <ToastProvider>
      <AgentPanelProvider>
        <AppShellContent {...props} />
      </AgentPanelProvider>
    </ToastProvider>
  );
}

function AppShellContent({
  accountGroups,
  accounts,
  demoMode,
  lastSyncedAt,
  reviewActionableCount,
  source,
  transactionCount,
  children
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const agentPanel = useAgentPanel();
  const { showToast, updateToast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [syncPhaseIndex, setSyncPhaseIndex] = useState(0);
  const [syncStatus, setSyncStatus] = useState<"error" | "idle" | "success" | "syncing">("idle");
  const accountById = React.useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const syncIslandState = deriveSyncIslandState({
    accountCount: accounts.length,
    lastSyncedAt,
    phaseIndex: syncPhaseIndex,
    source,
    status: syncStatus,
    transactionCount
  });

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(() => readStoredSidebarWidth());
  const [resizingSidebar, setResizingSidebar] = useState(false);

  const persistSidebarWidth = React.useCallback((px: number | null) => {
    if (px === null) {
      window.localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(px));
    }
  }, []);

  const changePaletteOpen = React.useCallback((open: boolean) => {
    setPaletteOpen((current) => {
      if (current === open) {
        return current;
      }

      if (open) {
        playOpen();
      } else {
        playClose();
      }

      return open;
    });
  }, []);

  React.useEffect(() => attachGlobalUiSounds(), []);

  React.useEffect(() => {
    if (syncStatus !== "syncing") {
      return;
    }

    setSyncPhaseIndex(0);
    const interval = window.setInterval(() => {
      setSyncPhaseIndex((current) => {
        if (current >= SYNC_ISLAND_PHASE_COUNT - 1) {
          // Reached the final stage — hold there instead of looping.
          window.clearInterval(interval);
          return current;
        }
        return current + 1;
      });
    }, 1400);
    return () => window.clearInterval(interval);
  }, [syncStatus]);

  React.useEffect(() => {
    if (syncStatus !== "success" && syncStatus !== "error") {
      return;
    }

    const timeout = window.setTimeout(() => setSyncStatus("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [syncStatus]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        prepareUiSound();
        setPaletteOpen((current) => {
          const next = !current;

          if (next) {
            playOpen();
          } else {
            playClose();
          }

          return next;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function syncNow() {
    setSyncing(true);
    setSyncStatus("syncing");
    const loadingDescription = "Connected accounts, sources, semantic updates, and AI enrichment are running.";
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

      playSuccess();
      setSyncStatus("success");
      updateToast(toastId, {
        description: "The local ledger has been refreshed.",
        duration: 3600,
        status: "success",
        title: "Sync complete",
      });
      router.refresh();
    } catch (error) {
      playError();
      setSyncStatus("error");
      updateToast(toastId, {
        description: error instanceof Error ? error.message : "Sync failed.",
        duration: 5200,
        status: "error",
        title: "Sync failed",
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <SyncProvider value={{ syncNow, syncing }}>
    <SidebarProvider
      data-resizing={resizingSidebar ? "true" : undefined}
      style={
        sidebarWidth !== null
          ? ({ ["--sidebar-width" as string]: `${sidebarWidth}px` } as React.CSSProperties)
          : undefined
      }
    >
      <Sidebar collapsible="icon" variant="sidebar">
        <SidebarResizeHandle
          onReset={() => {
            setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
            persistSidebarWidth(null);
          }}
          onResize={(px) => setSidebarWidth(px)}
          onResizeEnd={(px) => {
            setResizingSidebar(false);
            persistSidebarWidth(clampSidebarWidth(px));
          }}
          onResizeStart={() => setResizingSidebar(true)}
        />
        <AppSidebarSections
          accountById={accountById}
          accountGroups={accountGroups}
          accountCount={accounts.length}
          agentPanel={agentPanel}
          demoMode={demoMode}
          lastSyncedAt={lastSyncedAt}
          onOpenPalette={() => changePaletteOpen(true)}
          pathname={pathname}
          reviewActionableCount={reviewActionableCount}
          source={source}
          syncIslandState={syncIslandState}
          syncStatus={syncStatus}
          syncing={syncing}
          syncNow={syncNow}
          transactionCount={transactionCount}
        />
      </Sidebar>

      {/* ponytail: legacy pages offset themselves by --sidebar-width; zero it inside the inset until every page is migrated */}
      <SidebarInset
        className="pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0"
        style={{ ["--sidebar-width" as string]: "0px" }}
      >
        {children}
      </SidebarInset>
      <nav
        aria-label="Mobile primary"
        className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <Dock className="mb-2 w-full max-w-sm justify-around" size={52}>
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

            return (
              <DockItem active={active} className="rounded-xl" key={item.href}>
                <Link
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className="relative z-10 flex size-full flex-col items-center justify-center gap-0.5 rounded-xl text-[9px] font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground motion-reduce:transition-none"
                  href={item.href}
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                </Link>
              </DockItem>
            );
          })}
          <DockItem
            active={paletteOpen}
            aria-label="Search"
            className="flex-col gap-0.5 rounded-xl text-[9px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => changePaletteOpen(true)}
          >
            <Search className="size-4" />
            <span>Search</span>
          </DockItem>
        </Dock>
      </nav>
      <CommandPalette onOpenChangeAction={changePaletteOpen} open={paletteOpen} />
    </SidebarProvider>
    </SyncProvider>
  );
}

function AppSidebarSections({
  accountById,
  accountGroups,
  accountCount,
  agentPanel,
  demoMode,
  lastSyncedAt,
  onOpenPalette,
  pathname,
  reviewActionableCount,
  source,
  syncIslandState,
  syncStatus,
  syncing,
  syncNow,
  transactionCount
}: {
  accountById: Map<string, Account>;
  accountGroups: AccountGroup[];
  accountCount: number;
  agentPanel: ReturnType<typeof useAgentPanel>;
  demoMode?: boolean;
  lastSyncedAt?: string;
  onOpenPalette: () => void;
  pathname: string;
  reviewActionableCount: number;
  source: AppShellProps["source"];
  syncIslandState: ReturnType<typeof deriveSyncIslandState>;
  syncStatus: "error" | "idle" | "success" | "syncing";
  syncing: boolean;
  syncNow: () => void;
  transactionCount: number;
}) {
  const { isMobile, state, toggleSidebar } = useSidebar();
  const syncButtonLabel = syncStatus === "syncing"
    ? "Syncing"
    : syncStatus === "success"
      ? "Synced"
      : syncStatus === "error"
        ? "Failed"
        : "Sync now";

  return (
    <>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-0.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          {/* Koban maneki mark. Collapsed rail shows only the logo, which then
              doubles as the expand affordance. */}
          {/* Maneki hop: the cat pops up on hover (bounce ease, transform-only). */}
          <button
            aria-label="Expand sidebar"
            className="group/logo hidden shrink-0 cursor-pointer group-data-[collapsible=icon]:block"
            onClick={toggleSidebar}
            type="button"
          >
            <Image
              alt=""
              className="size-7 object-contain transition-transform duration-[var(--duration-fast)] ease-[var(--ease-bounce-strong)] group-hover/logo:-translate-y-1 group-hover/logo:scale-110 group-hover/logo:-rotate-6 motion-reduce:transition-none motion-reduce:group-hover/logo:transform-none"
              height={28}
              priority
              src="/icons/koban-1024-transparent.png"
              width={28}
            />
          </button>
          <span className="group/logo shrink-0 group-data-[collapsible=icon]:hidden">
            <Image
              alt=""
              aria-hidden="true"
              className="size-7 object-contain transition-transform duration-[var(--duration-fast)] ease-[var(--ease-bounce-strong)] group-hover/logo:-translate-y-1 group-hover/logo:scale-110 group-hover/logo:-rotate-6 motion-reduce:transition-none motion-reduce:group-hover/logo:transform-none"
              height={28}
              priority
              src="/icons/koban-1024-transparent.png"
              width={28}
            />
          </span>
          <span className="truncate text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Koban
          </span>
          {demoMode ? (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase group-data-[collapsible=icon]:hidden"
              style={{
                backgroundColor: "color-mix(in oklab, oklch(0.78 0.15 72) 16%, transparent)",
                color: "oklch(0.78 0.15 72)"
              }}
              title="Demo mode is on — money figures are scrambled"
            >
              Demo
            </span>
          ) : null}
          <SidebarTrigger className="ml-auto group-data-[collapsible=icon]:hidden" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <div className="mx-2 mb-1 flex flex-col gap-1 group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:items-center">
              <button
                aria-label="Start a new chat"
                className={cn(
                  "flex h-10 w-full items-center justify-start gap-2 rounded-[0.875rem] border border-foreground bg-foreground px-3 text-sm font-semibold text-background shadow-[inset_0_1px_0_color-mix(in_oklab,var(--background)_35%,transparent),0_8px_18px_-12px_color-mix(in_oklab,var(--foreground)_45%,transparent)] transition-[transform,opacity] hover:opacity-90 active:scale-[0.98] motion-reduce:transition-none group-data-[collapsible=icon]:w-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
                  agentPanel.open && !agentPanel.activeConversationId && "ring-2 ring-sidebar-ring/35"
                )}
                data-sound="open"
                data-testid="new-chat-button"
                onClick={agentPanel.startNewConversation}
                style={{
                  backgroundImage: "linear-gradient(180deg, oklch(from var(--foreground) calc(l + 0.08) c h), var(--foreground) 55%, oklch(from var(--foreground) calc(l - 0.035) c h))"
                }}
                type="button"
              >
                <Plus aria-hidden="true" className="size-4 shrink-0" />
                <span className="group-data-[collapsible=icon]:hidden">New</span>
              </button>
              <button
                aria-label="Open search"
                className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground motion-reduce:transition-none group-data-[collapsible=icon]:w-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                data-sound="none"
                onClick={onOpenPalette}
                type="button"
              >
                <Search aria-hidden="true" className="size-4 shrink-0" />
                <span className="flex-1 text-left group-data-[collapsible=icon]:hidden">Search</span>
                <kbd className="inline-flex items-center gap-0.5 rounded-full border border-sidebar-border bg-sidebar-accent/50 px-2 py-0.5 font-medium text-muted-foreground group-data-[collapsible=icon]:hidden">
                  <span aria-hidden="true" className="text-[11px] leading-none">⌘</span>
                  <span className="text-[10px] leading-none">K</span>
                </kbd>
              </button>
            </div>
            <SharedLayoutBg
              aria-label="Primary"
              as="ul"
              className="flex w-full min-w-0 flex-col gap-0.5"
              data-sidebar="menu"
              data-slot="sidebar-menu"
              pillClassName="rounded-xl bg-sidebar-accent/70"
            >
              {navItems.map((item) => {
                const Icon = item.icon;
                const active =
                  "action" in item
                    ? agentPanel.open
                    : item.activePath === "/"
                      ? pathname === "/"
                      : Boolean(item.activePath && pathname.startsWith(item.activePath));

                return (
                  <SidebarMenuItem key={item.label}>
                    {"action" in item ? (
                      <SidebarMenuButton
                        data-sound="none"
                        data-sound-hover=""
                        isActive={active}
                        onClick={() => agentPanel.openAgent()}
                        tooltip={item.label}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuButton
                        className={cn(item.label === "Transactions" && "relative overflow-visible group-data-[collapsible=icon]:overflow-hidden")}
                        data-sound-hover=""
                        isActive={active}
                        render={<Link href={item.href} />}
                        tooltip={item.label}
                      >
                        <Icon />
                        <span>{item.label}</span>
                        {item.label === "Transactions" && reviewActionableCount > 0 ? (
                          <span
                            aria-label={`${reviewActionableCount.toLocaleString()} transactions need review`}
                            className="t-badge group-data-[collapsible=icon]:hidden"
                            data-open="true"
                          >
                            <span className="t-badge-dot text-xs font-medium text-muted-foreground tabular-nums">
                              {reviewActionableCount.toLocaleString()}
                            </span>
                          </span>
                        ) : null}
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SharedLayoutBg>
          </SidebarGroupContent>
        </SidebarGroup>

        {!isMobile && state === "expanded" ? (
          <AgentChatSidebar
            activeConversationId={agentPanel.activeConversationId}
            busyConversationId={agentPanel.busyConversationId}
            conversations={agentPanel.conversations}
            insertedConversationId={agentPanel.insertedConversationId}
            loading={agentPanel.conversationsLoading}
            onDeleteConversation={agentPanel.deleteConversation}
            onOpenConversation={agentPanel.openConversation}
            onRenameConversation={agentPanel.renameConversation}
          />
        ) : null}

        {accountGroups.map((group) => (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden" key={group.id}>
            <SidebarGroupLabel>{group.name}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SharedLayoutBg
                aria-label={`${group.name} accounts`}
                as="ul"
                className="flex flex-col gap-0.5 px-2"
                pillClassName="rounded-lg bg-sidebar-accent/70"
              >
                {group.accountIds.flatMap((accountId) => {
                  const account = accountById.get(accountId);
                  const href = `/accounts/${encodeURIComponent(accountId)}`;

                  return account ? [
                    <SidebarAccountRow
                      account={account}
                      active={pathname === href}
                      dotColor={accountColorByType[account.type]}
                      href={href}
                      key={account.id}
                    />
                  ] : [];
                })}
              </SharedLayoutBg>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="group-data-[collapsible=icon]:hidden">
        <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-3 text-xs">
          <SyncStatusIsland state={syncIslandState} />
          <p className="mt-2 text-sidebar-foreground/60">
            {source === "koban"
              ? `${accountCount} accounts · ${transactionCount.toLocaleString()} transactions. ${formatSyncAge(lastSyncedAt)}`
              : "Connect an account in Settings to populate accounts and transactions."}
          </p>
          <Button
            aria-label={syncButtonLabel}
            className="mt-2 w-full"
            data-sound="sync"
            disabled={syncing}
            onClick={syncNow}
            size="sm"
            variant="outline"
          >
            <ActionSwapIcon animation="blur" value={syncStatus}>
              {syncStatus === "syncing" ? (
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
              ) : syncStatus === "success" ? (
                <Check className="size-3.5 text-(--positive)" />
              ) : syncStatus === "error" ? (
                <CircleAlert className="size-3.5 text-destructive" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </ActionSwapIcon>
            <ActionSwapText animation="blur" value={syncStatus}>
              {syncButtonLabel}
            </ActionSwapText>
          </Button>
        </div>
      </SidebarFooter>
    </>
  );
}

function formatSyncAge(lastSyncedAt?: string) {
  if (!lastSyncedAt) {
    return "Sync time unavailable.";
  }

  return `Last sync ${syncAgeFormatter.format(new Date(lastSyncedAt))}.`;
}
