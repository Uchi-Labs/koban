import { GoalManager, type GoalView } from "@/components/goal-manager";

export interface GoalsViewProps {
  goalViews: GoalView[];
}

export function GoalsView({ goalViews }: GoalsViewProps) {
  return (
    <main className="flex min-h-svh flex-col" data-testid="goals-page">
      <header className="flex items-center h-14 shrink-0 border-b border-border px-6">
        <span className="text-[13px] font-semibold tracking-tight">Goals</span>
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
        <section>
          <h1 className="app-page-title">Goals</h1>
          <p className="app-page-description mt-1.5">
            Group transactions under a goal to track money set aside. Assignments live on the transaction as a user
            overlay and survive every provider resync.
          </p>
        </section>

        <GoalManager initialGoals={goalViews} />
      </div>
    </main>
  );
}
