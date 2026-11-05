"use client";

import { Archive, ArchiveRestore, Plus, Trash2 } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, EmptyState } from "@/components/ui/card";
import { Card as IconiqCard, CardContent as IconiqCardContent } from "@/components/ui/iconiq-card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/b-progress";
import { RollingDigits } from "@/components/ui/rolling-digits";
import { ScrollArea } from "@/components/ui/scroll-area";
import { financeEmojiOptions } from "@/lib/category-style";
import { formatCurrency } from "@/lib/format";
import { EASE_OUT, ROLLING_DIGITS_HERO } from "@/lib/motion";

export interface GoalView {
  emoji: string | null;
  id: string;
  name: string;
  savedAmountCents: number;
  state: "active" | "archived";
  targetAmountCents: number | null;
  transactionCount: number;
}

const defaultGoalEmoji = "🎯";

export function GoalManager({ initialGoals }: { initialGoals: GoalView[] }) {
  const activeGoals = initialGoals.filter((goal) => goal.state === "active");
  const archivedGoals = initialGoals.filter((goal) => goal.state === "archived");

  return (
    <div className="flex flex-col gap-6">
      <GoalCreateForm />

      {activeGoals.length === 0 ? (
        <EmptyState
          actions={
            <a className={buttonVariants({ variant: "outline" })} data-slot="button" href="#new-goal">
              Name your first goal
            </a>
          }
          description="Name a goal above, then assign transactions to it from any transaction's details."
          mascot
          title="No goals yet"
        />
      ) : (
        <section aria-label="Active goals" className="flex flex-col gap-3">
          {activeGoals.map((goal) => (
            <GoalRow goal={goal} key={goal.id} />
          ))}
        </section>
      )}

      {archivedGoals.length > 0 ? (
        <section aria-label="Archived goals" className="flex flex-col gap-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Archived</p>
          {archivedGoals.map((goal) => (
            <GoalRow goal={goal} key={goal.id} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function GoalCreateForm() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(defaultGoalEmoji);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setMessage("Goal name is required.");
      return;
    }
    setBusy(true);
    setMessage("");
    const targetDollars = Number(target.replace(/[$,\s]/g, ""));
    const targetAmountCents =
      target.trim() === "" || !Number.isFinite(targetDollars) || targetDollars <= 0
        ? undefined
        : Math.round(targetDollars * 100);

    try {
      const response = await fetch("/api/v1/goals", {
        body: JSON.stringify({
          emoji,
          name: name.trim(),
          target_amount_cents: targetAmountCents ?? null
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to create goal.");
      }
      setName("");
      setEmoji(defaultGoalEmoji);
      setTarget("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create goal.");
    } finally {
      setBusy(false);
    }
  }

  // overflow-visible so the emoji popover is not clipped. Card sets
  // overflow-hidden globally (components/ui/card.tsx) to clip images to its
  // rounded corners; this card holds no images, and the picker is an
  // absolutely positioned child that the clip was swallowing entirely.
  return (
    <Card className="overflow-visible" id="new-goal" size="sm">
      <CardContent>
        <form className="@container/goalform flex flex-col gap-3" onSubmit={create}>
          {/* On a narrow card the Create button drops to its own full-width row. */}
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 @lg/goalform:grid-cols-[auto_1fr_auto_auto]">
            <div className="relative">
              <Button
                aria-label="Choose goal emoji"
                className="text-base"
                onClick={() => setEmojiOpen((current) => !current)}
                size="icon"
                type="button"
                variant="outline"
              >
                <span aria-hidden="true">{emoji}</span>
              </Button>
              <LazyMotion features={domAnimation}>
                <AnimatePresence initial={false}>
                  {emojiOpen ? (
                    <m.div
                      animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
                      className="absolute top-11 left-0 z-30 w-72 origin-top-left overflow-hidden rounded-2xl border border-border bg-popover shadow-lg"
                      exit={reduce
                        ? { opacity: 0, transition: { duration: 0.1, ease: EASE_OUT } }
                        : { opacity: 0, transform: "translateY(0) scale(0.99)", transition: { duration: 0.1, ease: EASE_OUT } }}
                      initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(-4px) scale(0.96)" }}
                      transition={{ duration: reduce ? 0.1 : 0.15, ease: EASE_OUT }}
                    >
                      <ScrollArea
                        className="max-h-56"
                        viewportClassName="scroll-fade-y scroll-fade-sm h-fit max-h-56 overscroll-contain"
                      >
                        <div className="grid grid-cols-6 gap-1 p-2">
                          {financeEmojiOptions.map((option, index) => (
                            <button
                              aria-label={`Use ${option}`}
                              className="grid size-11 place-items-center rounded-lg text-base transition-colors hover:bg-muted motion-reduce:transition-none sm:size-10"
                              key={`${option}-${index}`}
                              onClick={() => {
                                setEmoji(option);
                                setEmojiOpen(false);
                              }}
                              type="button"
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </ScrollArea>
                    </m.div>
                  ) : null}
                </AnimatePresence>
              </LazyMotion>
            </div>

            <Input
              aria-label="Goal name"
              className="h-9"
              onChange={(event) => setName(event.target.value)}
              placeholder="Goal name (e.g. Emergency fund)"
              value={name}
            />

            <span className="flex h-9 items-center gap-1 rounded-2xl border border-border bg-input/40 px-2.5 text-sm tabular-nums">
              <span className="text-muted-foreground">$</span>
              <input
                aria-label="Target amount"
                className="w-20 bg-transparent text-right text-base outline-hidden placeholder:text-muted-foreground/50 md:text-sm"
                inputMode="decimal"
                onChange={(event) => setTarget(event.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="Target"
                value={target}
              />
            </span>

            <Button className="col-span-3 @lg/goalform:col-span-1" disabled={busy} size="sm" type="submit">
              <Plus className="size-4" />
              {busy ? "Creating…" : "Create goal"}
            </Button>
          </div>

          {message ? (
            <p aria-live="polite" className="text-xs text-[var(--negative)]">
              {message}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function GoalRow({ goal }: { goal: GoalView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"archive" | "delete" | null>(null);
  const [message, setMessage] = useState("");
  const saved = goal.savedAmountCents / 100;
  const target = goal.targetAmountCents === null ? null : goal.targetAmountCents / 100;
  const percent =
    target && target > 0 ? Math.max(0, Math.min(100, Math.round((saved / target) * 100))) : null;

  async function setState(nextState: "active" | "archived") {
    setBusy("archive");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/goals/${encodeURIComponent(goal.id)}`, {
        body: JSON.stringify({ state: nextState }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to update goal.");
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update goal.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/goals/${encodeURIComponent(goal.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to delete goal.");
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete goal.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <IconiqCard className="rounded-xl border-border/60 bg-card/95 py-4 shadow-[var(--ic-card-rest-shadow)]" data-state={goal.state} interactive>
      <IconiqCardContent className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-2xl bg-muted text-lg"
          >
            {goal.emoji ?? defaultGoalEmoji}
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Link
              aria-label={`View transactions for ${goal.name}`}
              className="truncate text-sm font-medium tracking-tight transition-colors hover:text-primary"
              href="/transactions"
            >
              {goal.name}
            </Link>
            <span className="text-xs text-muted-foreground">
              {goal.transactionCount.toLocaleString()} {goal.transactionCount === 1 ? "transaction" : "transactions"}
            </span>
          </div>

          <div className="flex flex-col items-end gap-0.5">
            <b className="inline-flex items-baseline text-sm font-semibold tabular-nums">
              $
              <RollingDigits
                animationDelay={ROLLING_DIGITS_HERO.animationDelay}
                coalesceUpdates
                direction="dynamic"
                enterDamping={ROLLING_DIGITS_HERO.enterDamping}
                enterStiffness={ROLLING_DIGITS_HERO.enterStiffness}
                enterY={ROLLING_DIGITS_HERO.enterY}
                format={(value) => Math.round(value).toLocaleString("en-US")}
                gap={0}
                startOnView={false}
                value={saved}
              />
            </b>
            {target !== null ? (
              <span className="text-xs text-muted-foreground tabular-nums">of {formatCurrency(target)}</span>
            ) : (
              <span className="text-xs text-muted-foreground">saved</span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {goal.state === "active" ? (
              <Button
                aria-label={`Archive ${goal.name}`}
                disabled={busy !== null}
                onClick={() => setState("archived")}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Archive className="size-4" />
              </Button>
            ) : (
              <Button
                aria-label={`Restore ${goal.name}`}
                disabled={busy !== null}
                onClick={() => setState("active")}
                size="icon"
                type="button"
                variant="ghost"
              >
                <ArchiveRestore className="size-4" />
              </Button>
            )}
            <Button
              aria-label={`Delete ${goal.name}`}
              disabled={busy !== null}
              onClick={remove}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        {percent !== null ? (
          <div className="flex flex-col gap-1">
            <Progress
              ariaLabel={`${goal.name} funding progress`}
              getValueLabel={() => `${percent}% of target`}
              max={target ?? 100}
              showValue={false}
              size="sm"
              tone="success"
              value={saved}
            />
            <small className="text-xs text-muted-foreground tabular-nums">{percent}% of target</small>
          </div>
        ) : null}

        {message ? (
          <p aria-live="polite" className="text-xs text-[var(--negative)]">
            {message}
          </p>
        ) : null}
      </IconiqCardContent>
    </IconiqCard>
  );
}
