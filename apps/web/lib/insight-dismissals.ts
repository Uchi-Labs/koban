import { readSyncStateValue, withLockedSyncStateValue } from "@/lib/db/finance-db";

const KEY = "dismissed_insight_ids";

export async function getDismissedInsightIds(): Promise<Set<string>> {
  return parse(await readSyncStateValue(KEY));
}

export async function dismissInsight(id: string): Promise<void> {
  await withLockedSyncStateValue(KEY, async (value) => {
    const ids = parse(value);
    ids.add(id);
    return { result: undefined, value: JSON.stringify(Array.from(ids).slice(-500)) };
  });
}

function parse(value: string | undefined): Set<string> {
  if (!value) return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}
