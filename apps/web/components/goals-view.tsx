import { GoalManager, type GoalView } from "@/components/goal-manager";
import { PageHeader, pageFrameClassName } from "@/components/page-header";

export interface GoalsViewProps {
  goalViews: GoalView[];
}

export function GoalsView({ goalViews }: GoalsViewProps) {
  return (
    <main className={pageFrameClassName} data-testid="goals-page">
      <PageHeader
        description="Group transactions under a goal to see how much you've set aside. Goal assignments stay put when your bank syncs."
        title="Goals"
      />
      <GoalManager initialGoals={goalViews} />
    </main>
  );
}
