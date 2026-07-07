"use client";

import { SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/format";
import type { NetWorthToggleAccount, NetWorthToggleGroup } from "@/lib/net-worth-toggles";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export function NetWorthAccountsDialog({ groups }: { groups: NetWorthToggleGroup[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [includedById, setIncludedById] = useState<Record<string, boolean>>({});

  const isIncluded = (account: NetWorthToggleAccount) => includedById[account.id] ?? account.included;

  const includedTotal = groups
    .flatMap((group) => group.accounts)
    .reduce((total, account) => total + (isIncluded(account) ? account.contribution : 0), 0);

  async function toggle(account: NetWorthToggleAccount, included: boolean) {
    setIncludedById((current) => ({ ...current, [account.id]: included }));

    const response = await fetch(`/api/v1/accounts/${encodeURIComponent(account.id)}`, {
      body: JSON.stringify({ included_in_net_worth: included }),
      headers: { "content-type": "application/json" },
      method: "PATCH"
    });

    if (!response.ok) {
      setIncludedById((current) => ({ ...current, [account.id]: !included }));
      showToast({
        description: `Could not update ${account.name}.`,
        status: "error",
        title: "Net worth update failed"
      });
      return;
    }

    startTransition(() => router.refresh());
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button
            aria-label="Choose accounts included in net worth"
            className="text-muted-foreground"
            size="icon-sm"
            title="Choose accounts included in net worth"
            type="button"
            variant="ghost"
          >
            <SlidersHorizontal className="size-4" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Net worth accounts</DialogTitle>
          <DialogDescription>
            Toggle which accounts count toward net worth and spending metrics. Choices survive provider resyncs.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-2 flex max-h-[55vh] flex-col gap-4 overflow-y-auto px-2">
          {groups.map((group) => (
            <section aria-label={group.name} key={group.id}>
              <h3 className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {group.name}
              </h3>
              <ul className="flex flex-col">
                {group.accounts.map((account) => {
                  const included = isIncluded(account);
                  return (
                    <li
                      className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/50"
                      key={account.id}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{account.name}</span>
                        {account.mask ? (
                          <span className="text-xs text-muted-foreground">•••• {account.mask}</span>
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          "text-sm tabular-nums",
                          included
                            ? account.contribution < 0
                              ? "text-[var(--negative)]"
                              : "text-foreground"
                            : "text-muted-foreground line-through opacity-60"
                        )}
                      >
                        {formatCurrency(account.contribution, account.currency)}
                      </span>
                      <Switch
                        aria-label={`Include ${account.name} in net worth`}
                        checked={included}
                        onCheckedChange={(checked) => void toggle(account, checked)}
                        size="sm"
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
          <span className="text-muted-foreground">Included net worth</span>
          <span className="font-semibold tabular-nums">{formatCurrency(Math.round(includedTotal))}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
