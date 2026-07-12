"use client";

import { Check, Copy, CreditCard, ShieldCheck } from "lucide-react";
import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Card as IconiqCard, CardContent as IconiqCardContent } from "@/components/ui/iconiq-card";
import { cn } from "@/lib/utils";

const REVEAL_TTL_MS = 60_000;

interface RevealedDetails {
  accountNumber: string | null;
  routingAch?: string;
}

type RevealPhase = "hidden" | "challenge" | "pending" | "revealed";

export function AccountCardDialog({ accountId, institutionName, mask, name }: {
  accountId: string;
  institutionName: string;
  mask?: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<RevealPhase>("hidden");
  const [code, setCode] = useState("");
  const [details, setDetails] = useState<RevealedDetails | null>(null);
  const [error, setError] = useState<{ kind: string; message: string } | null>(null);
  const hideTimer = useRef<number | null>(null);

  // Revealed numbers evaporate on close, timeout, or unmount.
  const conceal = () => {
    setPhase("hidden");
    setDetails(null);
    setCode("");
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  useEffect(() => () => conceal(), []);

  async function reveal() {
    setPhase("pending");
    setError(null);

    const response = await fetch(`/api/v1/accounts/${encodeURIComponent(accountId)}/details`, {
      body: JSON.stringify({ totp_code: code }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const payload = (await response.json().catch(() => null)) as
      | { account_number?: string | null; routing_numbers?: Record<string, string>; error?: string; message?: string }
      | null;

    if (!response.ok || !payload || payload.error) {
      setPhase("challenge");
      setCode("");
      setError({
        kind: payload?.error ?? "unknown",
        message: payload?.message ?? "Could not reveal the numbers. Try again."
      });
      return;
    }

    setDetails({ accountNumber: payload.account_number ?? null, routingAch: payload.routing_numbers?.ach });
    setPhase("revealed");
    setCode("");
    hideTimer.current = window.setTimeout(conceal, REVEAL_TTL_MS);
  }

  const revealed = phase === "revealed" && details !== null;

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          conceal();
          setError(null);
        }
      }}
      open={open}
    >
      <DialogTrigger
        render={
          <Button
            aria-label={`Show card and numbers for ${name}`}
            className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            size="icon-sm"
            title="Account & routing numbers"
            type="button"
            variant="ghost"
          />
        }
      >
        <CreditCard className="size-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>{institutionName}</DialogDescription>
        </DialogHeader>

        <div className="relative flex aspect-[8/5] w-full flex-col justify-between rounded-3xl p-6 text-white shadow-xl ring-1 ring-white/10" style={{ background: "linear-gradient(145deg, oklch(0.3 0.008 270), oklch(0.22 0.006 270))" }}>
          <div className="flex items-start justify-between">
            <span className="text-sm font-medium text-white/70">{institutionName}</span>
            <span aria-hidden="true" className="flex">
              <span className="size-7 rounded-full border-2 border-white/50" />
              <span className="-ml-3 size-7 rounded-full border-2 border-white/50" />
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "text-xl font-semibold tracking-[0.12em] tabular-nums transition-[filter] duration-300 select-none motion-reduce:transition-none",
                  revealed ? "blur-0" : "blur-[6px]"
                )}
              >
                {revealed && details.accountNumber
                  ? formatNumberGroups(details.accountNumber)
                  : `01298 3408 ${mask ?? "0000"}`}
              </span>
              {revealed && details.accountNumber ? (
                <CopyChip label="Copy account number" value={details.accountNumber} />
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 text-sm text-white/70">
              <span className="flex items-center gap-2">
                Routing
                <span
                  className={cn(
                    "font-medium text-white tabular-nums transition-[filter] duration-300 select-none motion-reduce:transition-none",
                    revealed ? "blur-0" : "blur-[5px]"
                  )}
                >
                  {revealed ? (details.routingAch ?? "—") : "083000000"}
                </span>
              </span>
              {revealed && details.routingAch ? <CopyChip label="Copy routing number" value={details.routingAch} /> : null}
            </div>
            <div className="flex items-center justify-between text-sm text-white/80">
              <span className="truncate">{name}</span>
              {mask ? <span className="tabular-nums text-white/60">···· {mask}</span> : null}
            </div>
          </div>
        </div>

        {phase === "hidden" ? (
          <Button onClick={() => setPhase("challenge")} type="button" variant="outline">
            <ShieldCheck className="size-4" />
            Reveal numbers
          </Button>
        ) : null}

        {phase === "challenge" || phase === "pending" ? (
          <IconiqCard className="rounded-xl border-border/60 bg-card/95 py-0 shadow-[var(--ic-card-rest-shadow)]">
            <IconiqCardContent className="px-4 py-4">
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (/^\d{6}$/.test(code)) {
                    void reveal();
                  }
                }}
              >
                <label className="text-sm text-muted-foreground" htmlFor="account-details-totp">
                  Enter the 6-digit code from your authenticator app
                </label>
                <div className="flex gap-2">
                  <Input
                    autoComplete="one-time-code"
                    autoFocus
                    className="tabular-nums tracking-[0.3em]"
                    id="account-details-totp"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                    pattern="\d{6}"
                    placeholder="••••••"
                    value={code}
                  />
                  <Button disabled={phase === "pending" || !/^\d{6}$/.test(code)} type="submit">
                    {phase === "pending" ? "Verifying…" : "Verify"}
                  </Button>
                </div>
                {error ? (
                  <p className="text-sm text-[var(--negative)]">
                    {error.message}{" "}
                    {error.kind === "two_factor_not_enrolled" ? (
                      <Link className="underline underline-offset-4" href="/settings">
                        Open Settings
                      </Link>
                    ) : null}
                  </p>
                ) : null}
              </form>
            </IconiqCardContent>
          </IconiqCard>
        ) : null}

        {revealed ? (
          <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Numbers hide automatically in 60 seconds. They are fetched live and never stored.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      aria-label={label}
      className="flex shrink-0 items-center gap-1 rounded-lg bg-white/90 px-2 py-1 text-xs font-medium text-zinc-900 transition-transform hover:scale-105 motion-reduce:transition-none"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
      type="button"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function formatNumberGroups(value: string): string {
  return value.replace(/(.{4})/g, "$1 ").trim();
}
