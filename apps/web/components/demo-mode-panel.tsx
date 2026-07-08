"use client";

import { useRouter } from "next/navigation";
import React, { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";

const DEMO_MODE_COOKIE = "koban_demo";

export function DemoModePanel({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initialEnabled);

  function toggle(next: boolean) {
    setEnabled(next);
    document.cookie = next
      ? `${DEMO_MODE_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 30}`
      : `${DEMO_MODE_COOKIE}=; path=/; max-age=0`;
    startTransition(() => router.refresh());
  }

  return (
    <section aria-label="Demo mode" className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">Demo mode</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Scrambles every money figure (balances, transactions, positions, goals) with a stable per-account factor
            so charts keep their shape but no number is real — for screenshots and demos. A Demo badge shows in the
            sidebar while it is on. Applies to this browser only.
          </p>
        </div>
        <Switch aria-label="Toggle demo mode" checked={enabled} onCheckedChange={toggle} />
      </div>
    </section>
  );
}
