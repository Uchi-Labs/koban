import { FinanceAssistantPanel } from "@/components/finance-assistant-panel";
import { answerFinanceQuestion } from "@/lib/finance-assistant";

const suggestedQuestions = [
  "Where did my money go this month?",
  "What transactions need review first?",
  "How are source syncs doing?",
  "What rules would clean this up?"
];

export default async function AssistantPage() {
  const initialResponse = await answerFinanceQuestion("Where should I focus next?");

  return (
    <main className="flex min-h-svh flex-col" data-testid="assistant-page">
      <header className="flex items-center border-b border-border px-6 py-3.5">
        <span className="text-[13px] font-semibold tracking-tight">Finance agent</span>
      </header>
      <FinanceAssistantPanel initialResponse={initialResponse} suggestedQuestions={suggestedQuestions} />
    </main>
  );
}
