"use client";

import type { Account } from "@ai-finances/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

type RowAccount = Pick<Account, "id" | "name" | "currentBalance" | "currency">;

/**
 * Sidebar account row. Right-click enters inline rename directly — no
 * intermediate menu, which sidesteps the popup open/close races entirely and
 * makes "right-click to rename" reliable. The alias persists as a user overlay
 * (survives resync) and is merged at the read boundary, so the new name shows
 * everywhere the account appears. Empty submit restores the provider name.
 */
export function SidebarAccountRow({ account, href, active, dotColor }: {
  account: RowAccount;
  href: string;
  active: boolean;
  dotColor: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(account.name);
  const cancelled = useRef(false);
  const rowRef = useRef<HTMLLIElement>(null);

  // Keep the draft in sync when a resync or another surface changes the name.
  useEffect(() => setDraft(account.name), [account.name]);

  // Attach contextmenu natively rather than via React's onContextMenu: React's
  // synthetic delegation was not firing for real right-clicks here, while a
  // native listener on the row reliably does. Right-click → straight to edit.
  useEffect(() => {
    const el = rowRef.current;
    if (!el || editing) return;
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      setDraft(account.name);
      setEditing(true);
    };
    el.addEventListener("contextmenu", onContextMenu);
    return () => el.removeEventListener("contextmenu", onContextMenu);
  }, [account.name, editing]);

  async function save() {
    setEditing(false);
    const next = draft.trim();
    if (next === account.name) return;
    const response = await fetch(`/api/v1/accounts/${encodeURIComponent(account.id)}`, {
      body: JSON.stringify({ name: next.length === 0 ? null : next }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH"
    });
    // Server components re-render so the new name lands everywhere at once.
    if (response.ok) router.refresh();
    else setDraft(account.name);
  }

  if (editing) {
    // Mirror the row exactly — dot + inline text at the same padding — so
    // entering edit mode never changes the row's height or width.
    return (
      <li className="rounded-lg">
        <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent/70 px-2 py-1 ring-1 ring-inset ring-sidebar-ring/40">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />
          <input
            aria-label={`Rename ${account.name}`}
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-xs text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/40"
            onBlur={() => { if (cancelled.current) { cancelled.current = false; return; } void save(); }}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              else if (event.key === "Escape") { cancelled.current = true; setDraft(account.name); setEditing(false); }
            }}
            placeholder={account.name}
            value={draft}
          />
        </div>
      </li>
    );
  }

  return (
    <li className={cn("rounded-lg", active && "bg-sidebar-accent/70")} ref={rowRef}>
      <Link
        aria-current={active ? "page" : undefined}
        aria-label={`Open account page for ${account.name}`}
        className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/60"
        href={href}
        title={`${account.name} · right-click to rename`}
        unstable_dynamicOnHover
      >
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />
        <span className="min-w-0 flex-1 truncate text-sidebar-foreground/70">{account.name}</span>
        <span className="shrink-0 font-medium tabular-nums">
          {formatCurrency(Math.abs(account.currentBalance), account.currency)}
        </span>
      </Link>
    </li>
  );
}
