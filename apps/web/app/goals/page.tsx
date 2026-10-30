import type { GoalView } from "@/components/goal-manager";
import { GoalsView } from "@/components/goals-view";
import { listFinancialGoals } from "@/lib/db/finance-db";
import { isDemoModeEnabled, squashAmount } from "@/lib/demo-mode";

export default async function GoalsPage() {
  const goals = await listFinancialGoals();
  const demoMode = await isDemoModeEnabled();
  const scrambleCents = (cents: number, seed: string) => Math.round(squashAmount(cents / 100, seed) * 100);
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

  return <GoalsView goalViews={goalViews} />;
}
