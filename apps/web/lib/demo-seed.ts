import { assertDemoReceipts, createDemoReceipts, type DemoReceipts } from "@/lib/demo-receipts";
import type {
  Account,
  FinancialGoal,
  InvestmentPosition,
  ProviderConnection,
  Transaction
} from "@ai-finances/schema";
import { categoryPaletteColor } from "@/lib/category-style";
import type { AccountBalanceSnapshot, Ledger } from "@/lib/finance-data";
import { internalAmountSignConvention } from "@/lib/ledger-normalization";

export const demoSeedConfirmation = "REPLACE_EXPLICIT_DEMO_DATABASE";
export const demoSeedMarker = "koban_demo_seed_v1";
export const demoDatabaseTables = new Set([
  "account", "account_balance_snapshots", "accounts", "agent_conversation_turns", "agent_conversations",
  "apikey", "app_sync_runs", "categories", "embedding_models", "enrichment_suggestions", "external_sources",
  "financial_goals", "investment_positions", "passkey", "provider_connections", "semantic_documents",
  "semantic_embeddings", "session", "source_item_lines", "source_items", "source_sync_runs", "sync_run_items", "sync_runs",
  "sync_schedules", "sync_state", "tag_registry", "transaction_evidence_links", "transaction_rules",
  "transactions", "twoFactor", "user", "verification"
]);
export const demoUser = {
  id: "demo_user_koban",
  name: "Alex Morgan",
  email: "demo@koban.finance",
  password: "Koban-Demo-2026!"
} as const;

export interface DemoCategory {
  color: string;
  emoji: string;
  id: string;
  name: string;
  sortOrder: number;
}

export interface DemoRule {
  categoryId: string;
  id: string;
  markReviewed: boolean;
  matchField: "merchant_name" | "description" | "merchant_or_description";
  matchOperator: "contains" | "equals" | "regex";
  name: string;
  pattern: string;
  tags: string[];
}

export interface DemoSuggestion {
  categoryId: string;
  confidence: number;
  id: string;
  reason: string;
  transactionId: string;
}

export interface DemoDataset {
  budgetOverrides: Record<string, number>;
  categories: DemoCategory[];
  goals: FinancialGoal[];
  investmentPositions: InvestmentPosition[];
  ledger: Ledger;
  /** Itemized receipts and orders behind the household's grocery, warehouse and marketplace charges. */
  receipts: DemoReceipts;
  rules: DemoRule[];
  subscriptionNames: string[];
  suggestions: DemoSuggestion[];
  tagColors: Record<string, string>;
}

export interface DemoSeedSafetyInput {
  confirmation?: string;
  demoDatabaseUrl?: string;
  workspaceDatabaseUrl?: string;
}

export interface DemoDatabasePreflight {
  marker?: string;
  nonDemoRowCounts: Record<string, number>;
  tableNames: string[];
  users: Array<{ email: string; id: string }>;
}

// The original fixed window. A public demo passes yesterday instead so the
// current month always has activity.
export const defaultDemoAsOfDate = "2026-07-31";
const demoMonthCount = 24;
// Colon-namespaced, so classifyTagKind files it as a source tag and row chips
// stay clean.
const demoTag = "koban:demo";

const plaidConnectionId = "demo_provider_plaid";
const manualConnectionId = "demo_provider_manual";
const investmentConnectionId = "demo_provider_snaptrade";

interface DemoWindow {
  endDate: string;
  months: string[];
  startDate: string;
  syncedAt: string;
}

export function demoWindow(asOfDate: string = defaultDemoAsOfDate): DemoWindow {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) || Number.isNaN(Date.parse(`${asOfDate}T12:00:00.000Z`))) {
    throw new Error(`Demo as-of date must be YYYY-MM-DD: ${asOfDate}.`);
  }
  const first = new Date(`${asOfDate.slice(0, 7)}-01T12:00:00.000Z`);
  first.setUTCMonth(first.getUTCMonth() - (demoMonthCount - 1));
  const startDate = first.toISOString().slice(0, 10);
  return { startDate, endDate: asOfDate, months: monthsBetween(startDate, asOfDate), syncedAt: `${asOfDate}T18:00:00.000Z` };
}

function demoProviderConnections(window: DemoWindow): ProviderConnection[] {
  const staleAfter = new Date(Date.parse(window.syncedAt) + 14 * 86_400_000).toISOString();
  return [
    { id: plaidConnectionId, provider: "plaid", displayName: "Northstar Financial (Demo)", status: "connected", configured: true, lastSyncedAt: window.syncedAt, staleAfter },
    { id: manualConnectionId, provider: "manual", displayName: "Demo manual accounts", status: "connected", configured: true, lastSyncedAt: window.syncedAt },
    { id: investmentConnectionId, provider: "snaptrade", displayName: "Northstar Brokerage (Demo)", status: "connected", configured: true, lastSyncedAt: window.syncedAt }
  ];
}

// The Morgans: Alex (product designer, paid every other Friday) and Jordan
// (nurse, paid every other Thursday), their daughter Maya in daycare, and
// Biscuit the dog. Two paychecks land in Household Checking, which pays the
// bills, funds three savings goals, invests every month, and pays both cards in
// full on the 8th. Each partner gets a small monthly allowance in their own
// checking account.
type AccountKey =
  | "joint" | "alex" | "jordan" | "emergency" | "travel" | "home" | "cash"
  | "visa" | "amex" | "mortgage" | "auto" | "student" | "brokerage" | "roth" | "retirement";

const accountSpecs: Array<Omit<Account, "currentBalance" | "lastUpdatedAt"> & { key: AccountKey; openingBalance: number }> = [
  account("joint", "checking_household", "Household Checking", "Northstar Bank", "checking", "1042", 27_500),
  account("alex", "checking_alex", "Alex's Checking", "Northstar Bank", "checking", "7721", 1_400),
  account("jordan", "checking_jordan", "Jordan's Checking", "Harbor Credit Union", "checking", "3308", 1_100),
  account("emergency", "savings_emergency", "Emergency Fund", "Northstar Bank", "savings", "8820", 0),
  account("travel", "savings_travel", "Vacation Fund", "Northstar Bank", "savings", "6164", 0),
  account("home", "savings_home", "Home Projects", "Harbor Credit Union", "savings", "4409", 0),
  account("cash", "cash_wallet", "Cash", "Manual", "cash", undefined, 120, manualConnectionId),
  account("visa", "credit_visa", "Everyday Rewards Visa", "Northstar Bank", "credit_card", "4242", 0),
  account("amex", "credit_amex", "Travel Rewards Card", "Beacon Card Services", "credit_card", "1009", 0),
  account("mortgage", "loan_mortgage", "Townhouse Mortgage", "Northstar Bank", "loan", "0911", 296_000),
  account("auto", "loan_auto", "Car Loan", "Harbor Credit Union", "loan", "2846", 24_800),
  account("student", "loan_student", "Jordan's Student Loan", "Civic Education Finance", "loan", "6390", 16_400),
  account("brokerage", "invest_brokerage", "Joint Brokerage", "Northstar Brokerage", "investment", "5100", 0, investmentConnectionId),
  account("roth", "invest_roth", "Alex's Roth IRA", "Northstar Brokerage", "investment", "8675", 0, investmentConnectionId),
  account("retirement", "invest_403b", "Jordan's 403(b)", "Northstar Brokerage", "investment", "3021", 0, investmentConnectionId)
];
const accountByKey = new Map(accountSpecs.map((spec) => [spec.key, spec]));

const cat = {
  income: "cat_income",
  housing: "cat_housing",
  food: "cat_food",
  transportation: "cat_transportation",
  software: "cat_software",
  shopping: "cat_shopping",
  travel: "cat_travel",
  transfer: "cat_transfer",
  other: "cat_other",
  utilities: "cat_custom_utilities",
  childcare: "cat_custom_childcare",
  health: "cat_custom_health",
  entertainment: "cat_custom_entertainment",
  pets: "cat_custom_pets",
  gifts: "cat_custom_gifts"
} as const;

const demoCategories: DemoCategory[] = [
  { id: cat.utilities, name: "Utilities", emoji: "💡", color: categoryPaletteColor(1), sortOrder: 25 },
  { id: cat.childcare, name: "Childcare", emoji: "🧸", color: categoryPaletteColor(5), sortOrder: 26 },
  { id: cat.health, name: "Health & Fitness", emoji: "🩺", color: categoryPaletteColor(9), sortOrder: 55 },
  { id: cat.entertainment, name: "Entertainment", emoji: "🎬", color: categoryPaletteColor(4), sortOrder: 56 },
  { id: cat.pets, name: "Pets", emoji: "🐾", color: categoryPaletteColor(6), sortOrder: 57 },
  { id: cat.gifts, name: "Gifts & Giving", emoji: "🎁", color: categoryPaletteColor(8), sortOrder: 58 }
];

// Monthly budgets sized to the household's typical month, so most months land
// under budget with room left, and seasonal months (July trip, December gifts)
// visibly run over.
const budgetOverrides: Record<string, number> = {
  [cat.housing]: 1_500,
  [cat.food]: 1_300,
  [cat.transportation]: 420,
  [cat.software]: 25,
  [cat.shopping]: 550,
  [cat.travel]: 300,
  [cat.other]: 120,
  [cat.utilities]: 420,
  [cat.childcare]: 1_450,
  [cat.health]: 150,
  [cat.entertainment]: 100,
  [cat.pets]: 110,
  [cat.gifts]: 75
};

const tagColors: Record<string, string> = {
  kids: categoryPaletteColor(5),
  vacation: categoryPaletteColor(1),
  gift: categoryPaletteColor(8),
  home: categoryPaletteColor(9),
  reimbursable: categoryPaletteColor(7),
  subscription: categoryPaletteColor(3)
};

const subscriptionNames = [
  "Netflix.com", "Spotify", "Apple iCloud+", "nytimes.com", "Riverside YMCA",
  "Figma.com", "Chewy.com", "Kidtales", "Amazon Prime", "Fiberlane Internet", "ChatGPT Plus", "YouTube Premium"
];

const goalIds = {
  emergency: "demo_goal_emergency",
  travel: "demo_goal_travel",
  home: "demo_goal_home"
} as const;

export function assertDemoSeedTarget(input: DemoSeedSafetyInput): URL {
  const rawUrl = input.demoDatabaseUrl?.trim();
  if (!rawUrl) throw new Error("AI_FINANCES_DEMO_DATABASE_URL is required; the demo seed never uses the default store.");
  if (input.confirmation !== demoSeedConfirmation) {
    throw new Error(`AI_FINANCES_DEMO_SEED_CONFIRM must equal ${demoSeedConfirmation}.`);
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error("AI_FINANCES_DEMO_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (!/^postgres(?:ql)?:$/.test(target.protocol)) {
    throw new Error("AI_FINANCES_DEMO_DATABASE_URL must use postgres:// or postgresql://.");
  }
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, "")).toLowerCase();
  if (!databaseName || !databaseName.includes("demo")) {
    throw new Error("Refusing target: the PostgreSQL database name must contain 'demo'.");
  }
  if (sameDatabaseTarget(rawUrl, input.workspaceDatabaseUrl)) {
    throw new Error("Refusing target: AI_FINANCES_DEMO_DATABASE_URL matches the workspace DATABASE_URL.");
  }
  return target;
}

export function assertDemoDatabasePreflight(input: DemoDatabasePreflight): "empty" | "owned" {
  if (input.tableNames.length === 0) return "empty";
  const unknown = input.tableNames.filter((table) => !demoDatabaseTables.has(table));
  if (unknown.length > 0) throw new Error(`Refusing target: unknown public tables exist (${unknown.sort().join(", ")}).`);
  if (input.marker !== `${demoSeedMarker}:seeding` && input.marker !== `${demoSeedMarker}:complete`) {
    throw new Error("Refusing target: existing tables are not owned by the Koban demo seed.");
  }
  for (const [table, count] of Object.entries(input.nonDemoRowCounts)) {
    if (count > 0) throw new Error(`Refusing target: ${table} contains non-demo rows.`);
  }
  if (input.users.some((user) => user.id !== demoUser.id || user.email.toLowerCase() !== demoUser.email)) {
    throw new Error("Refusing target: Better Auth contains a non-demo user.");
  }
  return "owned";
}

interface TransactionExtras {
  financialGoalId?: string;
  notes?: string;
  tags?: string[];
}

export function createDemoDataset(asOfDate: string = defaultDemoAsOfDate): DemoDataset {
  const window = demoWindow(asOfDate);
  const { startDate, endDate, syncedAt, months } = window;
  const random = mulberry32(0x4b4f4241);
  const between = (minimum: number, maximum: number) => roundMoney(minimum + random() * (maximum - minimum));
  // Routine charges in the last month stay inside their usual range so the
  // unusual-charge insight surfaces the one real surprise, not ordinary noise.
  const recentFrom = addDays(endDate, -31);
  const routine = (date: string, minimum: number, maximum: number) =>
    between(minimum, date > recentFrom ? minimum + (maximum - minimum) * 0.8 : maximum);
  const chance = (probability: number) => random() < probability;
  const transactions: Transaction[] = [];
  let sequence = 0;

  const add = (key: AccountKey, date: string, merchantName: string, description: string, amount: number, categoryId: string, extras: TransactionExtras = {}) => {
    // A mid-month as-of date leaves the rest of the month's schedule unwritten.
    if (date < startDate || date > endDate || roundMoney(amount) === 0) return undefined;
    const spec = accountByKey.get(key)!;
    const transaction: Transaction = {
      id: `demo_txn_${String(sequence++).padStart(5, "0")}`,
      accountId: spec.id,
      providerConnectionId: spec.providerConnectionId,
      date,
      authorizedDate: date,
      postedDate: date,
      merchantName,
      description,
      amount: roundMoney(amount),
      currency: "USD",
      status: "posted",
      categoryId,
      reviewed: true,
      tags: [demoTag, ...(extras.tags ?? [])],
      ...(extras.notes ? { notes: extras.notes } : {}),
      ...(extras.financialGoalId ? { financialGoalId: extras.financialGoalId } : {})
    };
    transactions.push(transaction);
    return transaction;
  };

  // Both legs share the transfer category; a goal counts money that leaves
  // checking toward it and subtracts money brought back out of it.
  const transfer = (from: AccountKey, to: AccountKey, date: string, amount: number, merchantName: string, goal?: { id: string; leg: "outgoing" | "incoming" }) => {
    if (date < startDate || date > endDate || amount <= 0) return;
    const fromName = accountByKey.get(from)!.name;
    const toName = accountByKey.get(to)!.name;
    const outgoing = add(from, date, merchantName, `To ${toName}`, -amount, cat.transfer, goal?.leg === "outgoing" ? { financialGoalId: goal.id } : {})!;
    const incoming = add(to, date, merchantName, `From ${fromName}`, amount, cat.transfer, goal?.leg === "incoming" ? { financialGoalId: goal.id } : {})!;
    outgoing.pairedTransactionId = incoming.id;
    incoming.pairedTransactionId = outgoing.id;
  };

  for (const spec of accountSpecs.filter((candidate) => candidate.type !== "investment" && candidate.openingBalance !== 0)) {
    add(
      spec.key,
      startDate,
      "Opening Balance",
      "Balance when the account was connected",
      spec.type === "credit_card" || spec.type === "loan" ? -spec.openingBalance : spec.openingBalance,
      cat.transfer
    );
  }
  // The savings goals already had money in them when the accounts were linked.
  transfer("joint", "emergency", startDate, 14_000, "Internal Transfer", { id: goalIds.emergency, leg: "outgoing" });
  transfer("joint", "travel", startDate, 1_800, "Internal Transfer", { id: goalIds.travel, leg: "outgoing" });
  transfer("joint", "home", startDate, 2_500, "Internal Transfer", { id: goalIds.home, leg: "outgoing" });

  const goals: FinancialGoal[] = [
    goal(window, goalIds.emergency, "Six-month emergency fund", "🛟", 30_000_00),
    goal(window, goalIds.travel, "Lisbon, summer 2027", "✈️", 6_000_00),
    goal(window, goalIds.home, "Kitchen refresh", "🏡", 15_000_00)
  ];

  // Paychecks: Alex every other Friday, Jordan every other Thursday on the
  // opposite week. Both get a raise each March.
  const raiseFactor = (date: string) => {
    const year = Number(date.slice(0, 4)) - Number(startDate.slice(0, 4)) + (date.slice(5) >= "03-01" ? 1 : 0);
    return Math.pow(1.035, Math.max(0, year - (startDate.slice(5) >= "03-01" ? 1 : 0)));
  };
  for (let date = nextWeekday(startDate, 5); date <= endDate; date = addDays(date, 14)) {
    add("joint", date, "Lumen Studio Payroll", "Alex · direct deposit", roundMoney(2_780 * raiseFactor(date)), cat.income);
  }
  for (let date = addDays(nextWeekday(startDate, 4), 7); date <= endDate; date = addDays(date, 14)) {
    const overtime = chance(0.3) ? 165 : 0;
    add("joint", date, "Riverside Health Payroll", overtime ? "Jordan · direct deposit incl. overtime" : "Jordan · direct deposit", roundMoney(2_210 * raiseFactor(date) + overtime), cat.income);
  }

  const monthCount = months.length;
  for (const [index, month] of months.entries()) {
    const monthsAgo = monthCount - 1 - index;
    const monthNumber = Number(month.slice(5, 7));
    const winter = monthNumber === 12 || monthNumber <= 2;
    const heatingSeason = monthNumber >= 11 || monthNumber <= 3;
    const summer = monthNumber >= 6 && monthNumber <= 8;
    // Daycare raises tuition each January.
    const januariesSoFar = months.slice(1, index + 1).filter((candidate) => candidate.endsWith("-01")).length;

    add("joint", day(month, 1), "Northstar Mortgage", "Mortgage interest and escrow", -1_465, cat.housing);
    transfer("joint", "mortgage", day(month, 1), 735, "Mortgage Payment");
    add("joint", day(month, 1), "Little Acorns Early Learning", "Maya · monthly tuition", -(1_340 + 40 * januariesSoFar), cat.childcare, { tags: ["kids"] });
    transfer("joint", "alex", day(month, 1), 200, "Allowance");
    transfer("joint", "jordan", day(month, 1), 200, "Allowance");
    transfer("joint", "cash", day(month, 1), 40, "ATM Withdrawal");
    add("visa", day(month, 1), "Riverside YMCA", "Family membership", -64, cat.health, { tags: ["subscription"] });

    transfer("joint", "emergency", day(month, 2), 500, "Internal Transfer", { id: goalIds.emergency, leg: "outgoing" });
    transfer("joint", "travel", day(month, 2), 350, "Internal Transfer", { id: goalIds.travel, leg: "outgoing" });
    add("visa", day(month, 3), "Apple iCloud+", "iCloud+ 200 GB", -2.99, cat.software, { tags: ["subscription"] });
    add("amex", day(month, 5), "ChatGPT Plus", "Monthly plan", -20, cat.software, { tags: ["subscription"] });
    transfer("joint", "roth", day(month, 5), 583, "Brokerage Contribution");
    add("joint", day(month, 6), "Greenlight Energy", "Electric", -roundMoney(92 + (summer ? 68 : winter ? 34 : 0) + between(-9, 14)), cat.utilities);
    add("amex", day(month, 7), "Netflix.com", "Standard plan", monthsAgo < 8 ? -17.99 : -15.49, cat.entertainment, { tags: ["subscription"] });
    add("joint", day(month, 9), "Clearwater Utilities", "Water and sewer", -routine(day(month, 9), 58, 72), cat.utilities);
    add("amex", day(month, 10), "Figma.com", "Professional seat", -15, cat.software, { tags: ["subscription", "reimbursable"] });
    add("joint", day(month, 11), "GEICO", "Auto insurance", -146, cat.transportation);
    add("joint", day(month, 12), "Keystone Gas", "Natural gas", -(heatingSeason ? between(118, 168) : between(31, 46)), cat.utilities);
    add("visa", day(month, 13 + Math.floor(random() * 5)), "CVS Pharmacy", "Prescriptions and essentials", -routine(day(month, 13), 14, 39), cat.health);
    add("amex", day(month, 14), "Spotify", "Family plan", -16.99, cat.entertainment, { tags: ["subscription"] });
    transfer("joint", "home", day(month, 16), 300, "Internal Transfer", { id: goalIds.home, leg: "outgoing" });
    transfer("joint", "brokerage", day(month, 16), 1_500, "Brokerage Contribution");
    transfer("joint", "auto", day(month, 17), 465, "Car Loan Payment");
    add("joint", day(month, 18), "Fiberlane Internet", "Fiber 500", monthsAgo < 5 ? -75 : -70, cat.utilities, { tags: ["subscription"] });
    add("alex", day(month, 19), "Sharp & Co Barbers", "Haircut", -32, cat.other);
    add("visa", day(month, 20), "Chewy.com", "Biscuit's food and treats", -routine(day(month, 20), 54, 63), cat.pets, { tags: ["subscription"] });
    transfer("joint", "student", day(month, 21), 280, "Student Loan Payment");
    add("joint", day(month, 22), "Cedar Mobile", "Two lines", -92, cat.utilities);
    // YouTube Premium includes YouTube Music, on top of the Spotify family plan.
    add("amex", day(month, 22), "YouTube Premium", "Family plan", monthsAgo < 6 ? -22.99 : -19.99, cat.entertainment, { tags: ["subscription"] });
    add("visa", day(month, 24), "nytimes.com", "Digital subscription", -8, cat.entertainment, { tags: ["subscription"] });
    add("visa", day(month, 25), "Food Bank of Riverside", "Monthly donation", -25, cat.gifts);
    if (index % 2 === 1) add("jordan", day(month, 27), "Lumière Salon", "Cut and color", -routine(day(month, 27), 64, 82), cat.other);
    const costcoDay = nextWeekday(day(month, 8), 0);
    add("visa", costcoDay, "Costco", "Bulk groceries and household", -routine(costcoDay, 165, 255), cat.food);

    const lastDay = monthEnd(month);
    add("emergency", lastDay, "Northstar Interest", "High-yield savings interest", roundMoney((14_000 + 500 * index) * 0.041 / 12), cat.income);
    add("home", lastDay, "Harbor Interest", "Savings interest", roundMoney((2_500 + 300 * index) * 0.035 / 12), cat.income);
  }

  for (const date of datesBetween(startDate, endDate)) {
    const weekday = weekdayOf(date);
    const monthNumber = Number(date.slice(5, 7));
    const weekIndex = Math.floor(daysBetween(startDate, date) / 7);
    if (weekday === 6 && chance(0.95)) add("visa", date, "Juniper Market", "Weekly groceries", -routine(date, 104, 168), cat.food);
    if (weekday === 2 && chance(0.85)) add("visa", date, "Sunline Fuel", "Fuel", -routine(date, 38, 56), cat.transportation);
    if ((weekday === 1 || weekday === 3 || weekday === 5) && chance(0.7)) add("alex", date, "Starbucks", "Coffee", -routine(date, 5.25, 7.85), cat.food);
    if (weekday >= 2 && weekday <= 4 && chance(0.7)) add("jordan", date, "Riverside Hospital Café", "Lunch on shift", -routine(date, 7, 12.5), cat.food);
    if (weekday === 4 && chance(0.65)) add("visa", date, "Lotus Noodle House", "Takeout", -routine(date, 34, 52), cat.food);
    if (weekday === 6 && weekIndex % 2 === 0 && chance(0.8)) add("amex", date, "Copper Spoon", "Date night", -routine(date, 62, 118), cat.food);
    if (weekday === 0 && chance(0.25)) add("amex", date, "Target", "Household and kids", -routine(date, 28, 118), cat.shopping);
    if (chance(0.09)) add("amex", date, "Amazon", "Online order", -routine(date, 14, 86), cat.shopping);
    if (weekday >= 1 && weekday <= 5 && chance(0.05)) add("alex", date, "ParkMobile", "Downtown parking", -routine(date, 3.5, 12), cat.transportation);
    if (weekday === 3 && chance(0.3)) add("visa", date, "Walmart", "Household supplies", -routine(date, 22, 88), cat.shopping);
    if (weekday === 6 && chance(0.15)) add("visa", date, "Home Depot", "House projects", -routine(date, 24, 140), cat.shopping, { tags: ["home"] });
    if (weekday === 5 && chance(0.12)) add("amex", date, "Brightside Cinema", "Movie night", -routine(date, 28, 46), cat.entertainment);
    if (weekday === 6 && monthNumber >= 5 && monthNumber <= 10 && chance(0.5)) add("cash", date, "Farmers Market", "Produce and flowers", -routine(date, 12, 28), cat.food);
  }

  for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year += 1) {
    const refund = year % 2 === 0 ? 1_860 : 2_140;
    add("amex", `${year}-02-09`, "Amazon Prime", "Annual membership", -139, cat.shopping, { tags: ["subscription"] });
    add("amex", `${year}-02-20`, "Coastline Air", "2 round trips · July beach week", -684, cat.travel, { tags: ["vacation"], notes: "Booked early for the July beach week." });
    add("joint", `${year}-03-12`, "IRS Tax Refund", "Federal tax refund", refund, cat.income);
    add("visa", `${year}-03-10`, "Riverside Animal Hospital", "Biscuit · annual checkup", -between(168, 212), cat.pets);
    add("visa", `${year}-09-10`, "Riverside Animal Hospital", "Biscuit · vaccines", -between(96, 132), cat.pets);
    add("visa", `${year}-04-12`, "Party City", "Birthday party supplies", -86.4, cat.gifts, { tags: ["kids", "gift"], notes: "Maya's birthday party, dinosaur theme." });
    add("amex", `${year}-04-13`, "Story Corner Books", "Birthday books", -44.18, cat.gifts, { tags: ["kids", "gift"] });
    for (const visit of ["01-15", "05-15", "09-15"]) {
      add("visa", `${year}-${visit}`, "Little Sprouts Pediatrics", "Copay", -30, cat.health, { tags: ["kids"] });
    }
    add("visa", `${year}-06-03`, "Bright Smile Dental", "Cleaning copay", -45, cat.health);
    add("visa", `${year}-12-03`, "Bright Smile Dental", "Cleaning copay", -45, cat.health);
    for (const service of ["02-05", "06-05", "10-05"]) {
      add("visa", `${year}-${service}`, "Jiffy Lube", "Oil change", -between(79, 95), cat.transportation);
    }
    add("joint", `${year}-10-04`, "State DMV", "Vehicle registration", -47, cat.transportation);
    add("visa", `${year}-03-21`, "Tiny Threads Kids", "Spring clothes", -between(64, 110), cat.shopping, { tags: ["kids"] });
    add("visa", `${year}-08-22`, "Tiny Threads Kids", "Fall clothes", -between(64, 110), cat.shopping, { tags: ["kids"] });

    // July beach week, paid for out of the Vacation Fund.
    transfer("travel", "joint", `${year}-07-08`, 3_400, "Internal Transfer", { id: goalIds.travel, leg: "incoming" });
    add("amex", `${year}-07-12`, "Seabreeze Inn", "Beach week · 6 nights", -1_240, cat.travel, { tags: ["vacation"], notes: "Beach week with Maya and Jordan's parents." });
    add("visa", `${year}-07-11`, "Sunline Fuel", "Road trip fuel", -62.4, cat.transportation, { tags: ["vacation"] });
    add("amex", `${year}-07-14`, "Island Kayak Tours", "Family kayak tour", -140, cat.entertainment, { tags: ["vacation"] });
    for (const tripDay of ["07-12", "07-13", "07-15", "07-16", "07-17"]) {
      add("amex", `${year}-${tripDay}`, "Dune Street Grill", "Dinner on vacation", -between(38, 96), cat.food, { tags: ["vacation"] });
    }

    add("amex", `${year}-09-23`, "The Ember Room", "Birthday dinner", -168.5, cat.food, { notes: "Jordan's birthday dinner." });
    add("visa", `${year}-11-26`, "Juniper Market", "Thanksgiving groceries", -96.2, cat.food, { notes: "Hosting Thanksgiving this year." });

    // December: gifts, a toy drive, and Alex's year-end bonus.
    for (const giftDay of ["12-02", "12-05", "12-09", "12-14"]) {
      add("amex", `${year}-${giftDay}`, "Amazon", "Holiday gifts", -between(40, 120), cat.gifts, { tags: ["gift"] });
    }
    add("amex", `${year}-12-07`, "Target", "Holiday gifts", -between(60, 140), cat.gifts, { tags: ["gift"] });
    add("amex", `${year}-12-11`, "Etsy.com", "Handmade ornament set", -64, cat.gifts, { tags: ["gift"] });
    add("visa", `${year}-12-10`, "Riverside Toy Drive", "Holiday donation", -50, cat.gifts);
    add("joint", `${year}-12-15`, "Lumen Studio Payroll", "Alex · year-end bonus", 2_500, cat.income);
  }

  // The last few weeks, written relative to the as-of date so every reseed has
  // the same story: a new subscription, a surprise vet bill, and a handful of
  // card descriptors that need a human to recognize them.
  const daysAgo = (count: number) => addDays(endDate, -count);
  for (const offset of [74, 44, 14]) {
    add("amex", daysAgo(offset), "Kidtales", "Kids story app · monthly", -7.99, cat.entertainment, { tags: ["subscription", "kids"] });
  }
  add("visa", daysAgo(11), "Riverside Animal Hospital", "Biscuit · X-ray and follow-up", -412.6, cat.pets, { notes: "Biscuit ate a sock. He's fine." });

  const ambiguous: Array<{ account: AccountKey; daysAgo: number; merchant: string; description: string; amount: number; suggestion: string; confidence: number; reason: string }> = [
    { account: "visa", daysAgo: 1, merchant: "SQ *MAPLE ST MARKET", description: "Square purchase", amount: -23.4, suggestion: cat.food, confidence: 0.82, reason: "Square seller on Maple St; similar weekend purchases were groceries." },
    { account: "amex", daysAgo: 2, merchant: "TST* RIVERFRONT TACOS", description: "Toast purchase", amount: -41.7, suggestion: cat.food, confidence: 0.91, reason: "Toast is a restaurant point-of-sale system." },
    { account: "amex", daysAgo: 3, merchant: "AMZN MKTP US*2K4LQ", description: "Marketplace order", amount: -64.18, suggestion: cat.shopping, confidence: 0.88, reason: "Amazon Marketplace orders are usually Shopping in this household." },
    { account: "joint", daysAgo: 4, merchant: "VENMO PAYMENT 1023", description: "Venmo", amount: -60, suggestion: cat.childcare, confidence: 0.64, reason: "Friday-evening Venmo payments of $60 match past babysitting." },
    { account: "amex", daysAgo: 6, merchant: "PAYPAL *HANDMADEBYLU", description: "PayPal purchase", amount: -38, suggestion: cat.gifts, confidence: 0.58, reason: "This PayPal seller was last used for gifts." },
    { account: "joint", daysAgo: 9, merchant: "CHECK 1043", description: "Paper check", amount: -150, suggestion: cat.childcare, confidence: 0.41, reason: "Checks this size have gone to Maya's swim lessons." }
  ];
  const ambiguousIds = new Set<string>();
  const suggestedCategory = new Map<string, { categoryId: string; confidence: number; reason: string }>();
  for (const item of ambiguous) {
    const transaction = add(item.account, daysAgo(item.daysAgo), item.merchant, item.description, item.amount, cat.other);
    if (!transaction) continue;
    ambiguousIds.add(transaction.id);
    suggestedCategory.set(transaction.id, { categoryId: item.suggestion, confidence: item.confidence, reason: item.reason });
  }

  // Both cards are paid in full on the 8th for the previous month's charges.
  for (const [index, month] of months.entries()) {
    if (index === 0) continue;
    const previous = months[index - 1];
    for (const card of ["visa", "amex"] as const) {
      const cardId = accountByKey.get(card)!.id;
      const charges = -transactions
        .filter((transaction) => transaction.accountId === cardId && transaction.date.startsWith(previous) && transaction.amount < 0)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      transfer("joint", card, day(month, 8), roundMoney(charges), "Credit Card Payment");
    }
  }

  // The household reviews on Sundays: everything from the last few days is
  // still waiting, along with the descriptors above. Each item carries a
  // suggestion the review deck can accept in one tap.
  const reviewCutoff = daysAgo(4);
  const merchantHistory = new Map<string, number>();
  for (const transaction of transactions) {
    merchantHistory.set(transaction.merchantName ?? "", (merchantHistory.get(transaction.merchantName ?? "") ?? 0) + 1);
  }
  const categoryNames = new Map<string, string>([
    ...demoCategories.map((category) => [category.id, category.name] as const),
    [cat.food, "Food & Dining"], [cat.transportation, "Transportation"], [cat.shopping, "Shopping"],
    [cat.software, "Software"], [cat.housing, "Housing"], [cat.travel, "Travel"], [cat.other, "Other"]
  ]);
  for (const transaction of transactions) {
    const recent = transaction.date > reviewCutoff && transaction.categoryId !== cat.transfer && transaction.categoryId !== cat.income;
    if (!recent && !ambiguousIds.has(transaction.id)) continue;
    transaction.reviewed = false;
    if (!suggestedCategory.has(transaction.id)) {
      const priorCount = (merchantHistory.get(transaction.merchantName ?? "") ?? 1) - 1;
      suggestedCategory.set(transaction.id, {
        categoryId: transaction.categoryId ?? cat.other,
        confidence: priorCount >= 3 ? 0.97 : 0.8,
        reason: priorCount >= 3
          ? `Matches ${priorCount} earlier ${transaction.merchantName} charges in ${categoryNames.get(transaction.categoryId ?? "") ?? "this category"}.`
          : `${transaction.merchantName} is usually ${categoryNames.get(transaction.categoryId ?? "") ?? "this category"}.`
      });
    }
  }
  const suggestions: DemoSuggestion[] = [...suggestedCategory.entries()].map(([transactionId, suggestion]) => ({
    id: `demo_suggestion_${transactionId.replace("demo_txn_", "")}`,
    transactionId,
    ...suggestion
  }));

  // Every transaction carries a context note, the way a careful household
  // annotates its ledger; the assistant reads these when it answers.
  for (const transaction of transactions) {
    transaction.notes ??= contextNoteFor(transaction, accountByKey);
  }

  transactions.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));

  const investmentPositions = createInvestmentPositions();
  const investmentBalances = new Map<string, number>();
  for (const position of investmentPositions) {
    investmentBalances.set(position.accountId, roundMoney((investmentBalances.get(position.accountId) ?? 0) + position.marketValue));
  }

  const accounts: Account[] = accountSpecs.map(({ openingBalance: _openingBalance, key: _key, ...spec }) => {
    const flow = transactions.filter((transaction) => transaction.accountId === spec.id).reduce((sum, transaction) => sum + transaction.amount, 0);
    const currentBalance = spec.type === "investment"
      ? investmentBalances.get(spec.id) ?? 0
      : spec.type === "credit_card" || spec.type === "loan"
        ? -flow
        : flow;
    return {
      ...spec,
      currentBalance: roundMoney(currentBalance),
      availableBalance: spec.type === "credit_card" ? roundMoney(20_000 - currentBalance) : undefined,
      lastUpdatedAt: syncedAt
    };
  });

  const rules = createRules(transactions);
  const balanceSnapshots = createBalanceSnapshots(window, accounts, transactions);
  const ledger: Ledger = {
    source: "koban",
    version: 1,
    lastSyncedAt: syncedAt,
    syncStartDate: startDate,
    enrollmentCount: 1,
    accounts,
    balanceSnapshots,
    transactions,
    providerConnections: demoProviderConnections(window),
    normalization: { amountSignConvention: internalAmountSignConvention },
    syncSummary: { accountCount: accounts.length, transactionCount: transactions.length, errors: [] }
  };

  const dataset: DemoDataset = {
    budgetOverrides,
    categories: demoCategories,
    goals,
    investmentPositions,
    ledger,
    receipts: createDemoReceipts(transactions),
    rules,
    subscriptionNames,
    suggestions,
    tagColors
  };
  assertDemoDataset(dataset);
  return dataset;
}

export function assertDemoDataset(dataset: DemoDataset): void {
  const { accounts, transactions } = dataset.ledger;
  assertDemoReceipts(dataset.receipts, transactions);
  if (accounts.length < 12 || accounts.length > 18) throw new Error(`Demo account count out of range: ${accounts.length}.`);
  if (transactions.length < 2_000) throw new Error(`Demo transaction count is too small: ${transactions.length}.`);
  if (dataset.subscriptionNames.length < 8 || dataset.subscriptionNames.length > 15) throw new Error("Demo subscription count out of range.");
  if (dataset.goals.length < 2 || dataset.goals.length > 3) throw new Error("Demo goal count out of range.");
  for (const goal of dataset.goals) {
    if (!transactions.some((transaction) => transaction.financialGoalId === goal.id && transaction.amount < 0)) {
      throw new Error(`Demo goal has no contribution history: ${goal.id}.`);
    }
  }
  if (!transactions.some((transaction) => !transaction.reviewed)) throw new Error("Demo review queue is empty.");
  if (!dataset.investmentPositions.length) throw new Error("Demo investment portfolio is empty.");
  const unreviewed = new Set(transactions.filter((transaction) => !transaction.reviewed).map((transaction) => transaction.id));
  if (dataset.suggestions.some((suggestion) => !unreviewed.has(suggestion.transactionId)) || dataset.suggestions.length !== unreviewed.size) {
    throw new Error("Every review item needs exactly one suggestion.");
  }
  const categoryIds = new Set([...Object.values(cat), ...dataset.categories.map((category) => category.id)]);
  for (const transaction of transactions) {
    if (!categoryIds.has(transaction.categoryId ?? "")) throw new Error(`Unknown demo category on ${transaction.id}.`);
  }

  const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  for (const transaction of transactions.filter((candidate) => candidate.pairedTransactionId)) {
    const pair = byId.get(transaction.pairedTransactionId!);
    if (!pair || pair.pairedTransactionId !== transaction.id || pair.categoryId !== "cat_transfer" || transaction.categoryId !== "cat_transfer" || roundMoney(pair.amount + transaction.amount) !== 0) {
      throw new Error(`Broken demo transfer pair at ${transaction.id}.`);
    }
  }
  for (const account of accounts.filter((candidate) => candidate.type !== "investment")) {
    const flow = roundMoney(transactions.filter((transaction) => transaction.accountId === account.id).reduce((sum, transaction) => sum + transaction.amount, 0));
    const expected = account.type === "credit_card" || account.type === "loan" ? -flow : flow;
    if (roundMoney(account.currentBalance) !== roundMoney(expected)) throw new Error(`Balance does not reconcile for ${account.id}.`);
    if ((account.type === "checking" || account.type === "savings" || account.type === "cash") && account.currentBalance < 0) {
      throw new Error(`Demo asset balance is negative for ${account.id}.`);
    }
    if ((account.type === "credit_card" || account.type === "loan") && account.currentBalance < 0) {
      throw new Error(`Demo liability balance is negative for ${account.id}.`);
    }
    if (account.type === "credit_card" && (account.currentBalance > 20_000 || (account.availableBalance ?? -1) < 0)) {
      throw new Error(`Demo credit utilization is invalid for ${account.id}.`);
    }
    for (const snapshot of (dataset.ledger.balanceSnapshots ?? []).filter((candidate) => candidate.accountId === account.id)) {
      const snapshotFlow = roundMoney(transactions
        .filter((transaction) => transaction.accountId === account.id && transaction.date <= snapshot.asOfDate)
        .reduce((sum, transaction) => sum + transaction.amount, 0));
      const snapshotExpected = account.type === "credit_card" || account.type === "loan" ? -snapshotFlow : snapshotFlow;
      if (roundMoney(snapshot.ledgerBalance) !== roundMoney(snapshotExpected)) {
        throw new Error(`Balance snapshot does not reconcile for ${account.id} at ${snapshot.asOfDate}.`);
      }
      if ((account.type === "checking" || account.type === "savings" || account.type === "cash") && snapshot.ledgerBalance < 0) {
        throw new Error(`Demo asset balance dips below zero for ${account.id} at ${snapshot.asOfDate}.`);
      }
    }
  }
  for (const account of accounts.filter((candidate) => candidate.type === "investment")) {
    const positions = roundMoney(dataset.investmentPositions.filter((position) => position.accountId === account.id).reduce((sum, position) => sum + position.marketValue, 0));
    if (positions !== roundMoney(account.currentBalance)) throw new Error(`Investment positions do not reconcile for ${account.id}.`);
    const snapshots = (dataset.ledger.balanceSnapshots ?? [])
      .filter((snapshot) => snapshot.accountId === account.id)
      .sort((left, right) => left.asOfDate.localeCompare(right.asOfDate) || left.capturedAt.localeCompare(right.capturedAt));
    if (snapshots.length < 18) throw new Error(`Investment history is too short for ${account.id}.`);
    if (!snapshots.some((snapshot, index) => index > 0 && snapshot.ledgerBalance < snapshots[index - 1].ledgerBalance)) {
      throw new Error(`Investment history has no market drawdown for ${account.id}.`);
    }
    if (roundMoney(snapshots.at(-1)!.ledgerBalance) !== roundMoney(account.currentBalance)) {
      throw new Error(`Final investment snapshot does not match ${account.id}.`);
    }
  }
  const netWorth = accounts.reduce((sum, account) => sum + (account.type === "credit_card" || account.type === "loan" ? -account.currentBalance : account.currentBalance), 0);
  if (netWorth <= 0) throw new Error(`Demo household net worth should be positive: ${roundMoney(netWorth)}.`);
}

const merchantNotes: Record<string, string[]> = {
  "Juniper Market": [
    "Weekly shop: produce, oat milk, eggs, and Maya's yogurt pouches.",
    "Weekly shop plus snacks for Maya's daycare share day.",
    "Groceries for the week; stocked up on chicken and rice.",
    "Weekly shop. Picked up coffee beans and dish soap too.",
    "Groceries, plus ingredients for Sunday batch cooking."
  ],
  Costco: [
    "Monthly bulk run: paper towels, diapers for the neighbor's baby shower, frozen fruit.",
    "Bulk run: rice, olive oil, Biscuit's treats, and a rotisserie chicken.",
    "Warehouse trip for staples; split the coffee with Jordan's sister."
  ],
  Starbucks: [
    "Alex's oat latte before the morning standup.",
    "Coffee on the walk to the studio.",
    "Coffee and a croissant; client call ran early."
  ],
  "Riverside Hospital Café": [
    "Jordan's lunch between shifts.",
    "Quick salad on a long ER shift.",
    "Soup and coffee during a double shift."
  ],
  "Lotus Noodle House": [
    "Thursday takeout: pad see ew and dumplings.",
    "Takeout night; Maya picked the spring rolls.",
    "Thursday takeout after a long week."
  ],
  "Copper Spoon": [
    "Date night while Jordan's parents watched Maya.",
    "Dinner out with friends from the hospital.",
    "Date night; shared the tasting plates."
  ],
  "Sunline Fuel": ["Filled up the car for the week.", "Gas on the way to daycare drop-off.", "Topped off before the weekend."],
  Target: ["Household restock and a few things for Maya.", "Kids' socks, shampoo, and a birthday card.", "Cleaning supplies and storage bins."],
  Amazon: ["Household order: filters and batteries.", "Order: replacement charger and a kids' book.", "Order: kitchen towels and a phone case."],
  Walmart: ["Household supplies and a new laundry basket.", "Pantry restock and paper goods."],
  "Home Depot": ["Paint samples for the kitchen refresh.", "Hardware for the garden bed.", "Weatherstripping and a new faucet cartridge."],
  "Brightside Cinema": ["Family movie night.", "Movie with Maya's friends from daycare."],
  ParkMobile: ["Downtown parking for a client meeting.", "Parking near the studio."],
  "Farmers Market": ["Saturday market: berries, bread, and flowers.", "Market haul: tomatoes and local honey."],
  "CVS Pharmacy": ["Prescriptions and allergy medicine.", "Vitamins and sunscreen.", "Children's Tylenol and bandages."],
  "Sharp & Co Barbers": ["Alex's monthly haircut."],
  "Lumière Salon": ["Jordan's cut and color."],
  "Chewy.com": ["Biscuit's monthly food delivery.", "Biscuit's food plus a chew toy."],
  "Riverside YMCA": ["Family membership; Maya's swim class is included."],
  "Apple iCloud+": ["Family photo storage plan."],
  "Netflix.com": ["Streaming plan the family shares."],
  Spotify: ["Family music plan."],
  "ChatGPT Plus": ["Alex's ChatGPT plan for planning and work."],
  "YouTube Premium": ["Ad-free YouTube for the family; includes YouTube Music."],
  "nytimes.com": ["Digital news subscription."],
  "Figma.com": ["Alex's design seat; expensed back through Lumen."],
  Kidtales: ["New bedtime story app Maya loves; trial converted to paid."],
  "Northstar Mortgage": ["Monthly mortgage interest and escrow (taxes and insurance)."],
  "Little Acorns Early Learning": ["Maya's monthly daycare tuition."],
  "Greenlight Energy": ["Electric bill for the townhouse."],
  "Keystone Gas": ["Natural gas bill; heating season runs higher."],
  "Clearwater Utilities": ["Water and sewer for the townhouse."],
  "Fiberlane Internet": ["Home fiber internet."],
  "Cedar Mobile": ["Two phone lines on the family plan."],
  GEICO: ["Monthly auto insurance for the car."],
  "Food Bank of Riverside": ["Recurring monthly donation."],
  "Lumen Studio Payroll": ["Alex's paycheck after taxes and 401(k)."],
  "Riverside Health Payroll": ["Jordan's paycheck after taxes and 403(b)."],
  "Northstar Interest": ["Interest on the high-yield emergency fund."],
  "Harbor Interest": ["Interest on the home projects savings."],
  "Little Sprouts Pediatrics": ["Maya's checkup copay."],
  "Bright Smile Dental": ["Routine cleaning copay."],
  "Jiffy Lube": ["Oil change and tire rotation."],
  "State DMV": ["Annual vehicle registration."],
  "Tiny Threads Kids": ["Maya outgrew everything again."],
  "Riverside Animal Hospital": ["Biscuit's routine vet visit."],
  "Dune Street Grill": ["Dinner on the beach trip."],
  "Island Kayak Tours": ["Family kayak tour on the beach trip."],
  "Amazon Prime": ["Annual Prime renewal."],
  "IRS Tax Refund": ["Federal refund; most of it went to the vacation fund."],
  "Story Corner Books": ["Books for Maya's birthday."],
  "Party City": ["Maya's birthday party supplies."],
  "Etsy.com": ["Handmade gift for Jordan's mom."],
  "Riverside Toy Drive": ["Holiday toy drive donation."],
  "Coastline Air": ["Flights for the July beach week."],
  "Seabreeze Inn": ["Beach week lodging."],
  "The Ember Room": ["Birthday dinner."],
  "SQ *MAPLE ST MARKET": ["Square receipt: sourdough loaf and local honey from the Maple St stand."],
  "TST* RIVERFRONT TACOS": ["Toast receipt: tacos for three after Maya's swim class."],
  "AMZN MKTP US*2K4LQ": ["Marketplace order: replacement stroller wheel."],
  "VENMO PAYMENT 1023": ["Venmo to Sam for Friday-night babysitting."],
  "PAYPAL *HANDMADEBYLU": ["Handmade earrings, a gift for Jordan's sister."],
  "CHECK 1043": ["Check for Maya's swim lessons, fall session."]
};

const transferNotes: Record<string, string> = {
  "Internal Transfer": "Automatic transfer between the household's own accounts.",
  "Brokerage Contribution": "Automatic monthly investment contribution.",
  "Credit Card Payment": "Autopay: previous month's statement paid in full.",
  "Mortgage Payment": "Principal portion of the monthly mortgage payment.",
  "Car Loan Payment": "Monthly car loan payment.",
  "Student Loan Payment": "Monthly payment on Jordan's student loan.",
  Allowance: "Monthly personal spending money.",
  "ATM Withdrawal": "Cash for the farmers market and tips.",
  "Opening Balance": "Balance when the account was first connected."
};

function contextNoteFor(transaction: Transaction, accounts: Map<AccountKey, { id: string; name: string }>): string {
  const merchant = transaction.merchantName ?? "";
  const variants = merchantNotes[merchant];
  if (variants?.length) {
    const index = [...transaction.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % variants.length;
    return variants[index]!;
  }
  const transfer = transferNotes[merchant];
  if (transfer) {
    const toName = [...accounts.values()].find((account) => account.id === transaction.accountId)?.name;
    return transaction.amount > 0 && toName ? `${transfer} Into ${toName}.` : transfer;
  }
  return transaction.description ?? "Household purchase.";
}

function account(key: AccountKey, id: string, name: string, institutionName: string, type: Account["type"], mask: string | undefined, openingBalance: number, providerConnectionId = plaidConnectionId) {
  return { key, id: `demo_account_${id}`, providerConnectionId, groupId: `demo_group_${type}`, name, institutionName, type, mask, currency: "USD", openingBalance, includedInNetWorth: true } as const;
}

function goal(window: DemoWindow, id: string, name: string, emoji: string, targetAmountMinor: number): FinancialGoal {
  return { id, name, emoji, targetAmountMinor, state: "active", createdAt: `${window.startDate}T12:00:00.000Z`, updatedAt: window.syncedAt };
}

// Rules the household set up over time; their counts reflect what they match
// in the ledger.
function createRules(transactions: Transaction[]): DemoRule[] {
  const specs: Array<Omit<DemoRule, "id">> = [
    { name: "Groceries at Juniper Market", matchField: "merchant_name", matchOperator: "contains", pattern: "Juniper Market", categoryId: cat.food, tags: [], markReviewed: true },
    { name: "Daycare tuition", matchField: "merchant_name", matchOperator: "equals", pattern: "Little Acorns Early Learning", categoryId: cat.childcare, tags: ["kids"], markReviewed: true },
    { name: "Home utilities", matchField: "merchant_name", matchOperator: "regex", pattern: "greenlight energy|keystone gas|clearwater|fiberlane|cedar mobile", categoryId: cat.utilities, tags: [], markReviewed: true },
    { name: "Streaming and music", matchField: "merchant_name", matchOperator: "regex", pattern: "netflix|spotify|nytimes", categoryId: cat.entertainment, tags: ["subscription"], markReviewed: true },
    { name: "Biscuit's food", matchField: "merchant_name", matchOperator: "contains", pattern: "Chewy", categoryId: cat.pets, tags: ["subscription"], markReviewed: true },
    { name: "Work software (expensed)", matchField: "merchant_name", matchOperator: "contains", pattern: "Figma", categoryId: cat.software, tags: ["reimbursable"], markReviewed: true },
    { name: "Coffee runs", matchField: "merchant_name", matchOperator: "contains", pattern: "Starbucks", categoryId: cat.food, tags: [], markReviewed: false }
  ];
  return specs.map((spec, index) => {
    const rule = { ...spec, id: `demo_rule_${String(index + 1).padStart(2, "0")}` };
    if (demoRuleMatchCount(rule, transactions) === 0) throw new Error(`Demo rule matches nothing: ${rule.name}.`);
    return rule;
  });
}

export function demoRuleMatchCount(rule: DemoRule, transactions: Transaction[]): number {
  const pattern = rule.pattern.toLowerCase();
  return transactions.filter((transaction) => {
    const value = (transaction.merchantName ?? "").toLowerCase();
    return rule.matchOperator === "regex" ? new RegExp(rule.pattern, "i").test(value) : rule.matchOperator === "equals" ? value === pattern : value.includes(pattern);
  }).length;
}

function createInvestmentPositions(): InvestmentPosition[] {
  const positions = [
    ["brokerage", "VTI", "Total US Stock Market ETF", 230, 322.4, 238.2],
    ["brokerage", "VXUS", "Total International Stock ETF", 320, 78.15, 61.4],
    ["brokerage", "BND", "Total Bond Market ETF", 180, 75.1, 71.8],
    ["roth", "VTI", "Total US Stock Market ETF", 110, 322.4, 211.7],
    ["roth", "AVUV", "US Small Cap Value ETF", 95, 103.9, 84.5],
    ["roth", "VXUS", "Total International Stock ETF", 90, 78.15, 59.1],
    ["403b", "VFIFX", "Target Retirement 2050 Fund", 2_350, 58.2, 44.1]
  ] as const;
  return positions.map(([accountSuffix, symbol, description, units, price, costBasis]) => ({
    id: `demo_position_${accountSuffix}_${symbol.toLowerCase()}`,
    accountId: `demo_account_invest_${accountSuffix}`,
    symbol,
    description,
    units,
    price,
    costBasis,
    currency: "USD",
    marketValue: roundMoney(units * price)
  }));
}

// Month-end snapshots for the whole window plus daily snapshots for the last
// 90 days, so the account charts' 1W and 1M ranges have points.
function createBalanceSnapshots(window: DemoWindow, accounts: Account[], transactions: Transaction[]): AccountBalanceSnapshot[] {
  const dates = new Set<string>(window.months.map((month) => monthEnd(month)).filter((date) => date <= window.endDate));
  for (let offset = 0; offset < 90; offset += 1) dates.add(addDays(window.endDate, -offset));
  const snapshotDates = [...dates].filter((date) => date >= window.startDate).sort();
  const snapshots: AccountBalanceSnapshot[] = [];
  for (const account of accounts) {
    const accountTransactions = transactions.filter((transaction) => transaction.accountId === account.id);
    for (const asOfDate of snapshotDates) {
      const daysBefore = daysBetween(asOfDate, window.endDate);
      const flow = accountTransactions.filter((transaction) => transaction.date <= asOfDate).reduce((sum, transaction) => sum + transaction.amount, 0);
      const ledgerBalance = account.type === "investment"
        ? account.currentBalance * investmentGrowth(daysBefore)
        : account.type === "credit_card" || account.type === "loan"
          ? -flow
          : flow;
      snapshots.push({
        id: `demo_snapshot_${account.id}_${asOfDate}`,
        accountId: account.id,
        asOfDate,
        capturedAt: `${asOfDate}T18:00:00.000Z`,
        ledgerBalance: roundMoney(ledgerBalance),
        availableBalance: account.type === "credit_card" ? roundMoney(20_000 - ledgerBalance) : undefined,
        currency: "USD",
        source: account.type === "investment" ? "snaptrade" : "plaid"
      });
    }
  }
  return snapshots;
}

// About 7.5% a year with ordinary wobble and one correction roughly 14 months
// back; exactly 1 on the as-of date.
function investmentGrowth(daysBefore: number): number {
  if (daysBefore === 0) return 1;
  const trend = 1 / Math.pow(1.075, daysBefore / 365);
  const correction = daysBefore >= 380 && daysBefore <= 470 ? -0.09 * Math.sin(((daysBefore - 380) / 90) * Math.PI) : 0;
  const wobble = 0.012 * Math.sin(daysBefore / 9) + 0.006 * Math.sin(daysBefore / 3.7);
  return trend * (1 + correction + wobble);
}

function day(month: string, dayOfMonth: number): string {
  const last = Number(monthEnd(month).slice(8, 10));
  return `${month}-${String(Math.min(dayOfMonth, last)).padStart(2, "0")}`;
}

function addDays(date: string, count: number): string {
  const cursor = new Date(`${date}T12:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + count);
  return cursor.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / 86_400_000);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

function nextWeekday(date: string, weekday: number): string {
  return addDays(date, (weekday - weekdayOf(date) + 7) % 7);
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0, 12)).toISOString().slice(0, 10);
}

function datesBetween(start: string, end: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${start}T12:00:00.000Z`);
  const last = new Date(`${end}T12:00:00.000Z`);
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function monthsBetween(start: string, end: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${start.slice(0, 7)}-01T12:00:00.000Z`);
  const last = new Date(`${end.slice(0, 7)}-01T12:00:00.000Z`);
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

function sameDatabaseTarget(left: string, right?: string): boolean {
  if (!right?.trim()) return false;
  try {
    const normalize = (value: string) => {
      const url = new URL(value);
      return `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || "5432"}${url.pathname}`;
    };
    return normalize(left) === normalize(right);
  } catch {
    return left.trim() === right.trim();
  }
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
