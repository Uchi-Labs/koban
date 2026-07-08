import { GoalManager, type GoalView } from "@/components/goal-manager";
import { listFinancialGoals } from "@/lib/db/finance-db";
import { isDemoModeEnabled, scrambleAmount } from "@/lib/demo-mode";

export default async function GoalsPage() {
  const goals = await listFinancialGoals();
  const demoMode = await isDemoModeEnabled();
  const scrambleCents = (cents: number, seed: string) => Math.round(scrambleAmount(cents / 100, seed) * 100);
  const goalViews: GoalView[] = goals.map((goal) => ({
    emoji: goal.emoji ?? null,
    id: goal.id,
    name: goal.name,
    savedAmountCents: demoMode ? scrambleCents(goal.savedAmountMinor, goal.id) : goal.savedAmountMinor,
    state: goal.state,
    targetAmountCents:
      goal.targetAmountMinor === undefined
        ? null
        : demoMode
          ? scrambleCents(goal.targetAmountMinor, goal.id)
          : goal.targetAmountMinor,
    transactionCount: goal.transactionCount
  }));

  return (
    <main className="flex min-h-svh flex-col" data-testid="goals-page">
      <header className="flex items-center border-b border-border px-6 py-3.5">
        <span className="text-[13px] font-semibold tracking-tight">Goals</span>
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
        <section>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Savings goals</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Goals</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Group transactions under a goal to track money set aside. Assignments live on the transaction as a user
            overlay and survive every provider resync.
          </p>
        </section>

        <GoalManager initialGoals={goalViews} />
      </div>
    </main>
  );
}
