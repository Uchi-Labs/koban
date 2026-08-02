import type {
  Account,
  FinancialGoal,
  InvestmentPosition,
  ProviderConnection,
  Transaction
} from "@ai-finances/schema";
import type { AccountBalanceSnapshot, Ledger } from "@/lib/finance-data";
import { internalAmountSignConvention } from "@/lib/ledger-normalization";

export const demoSeedConfirmation = "REPLACE_EXPLICIT_DEMO_DATABASE";
export const demoSeedMarker = "koban_demo_seed_v1";
export const demoDatabaseTables = new Set([
  "account", "account_balance_snapshots", "accounts", "agent_conversation_turns", "agent_conversations",
  "apikey", "app_sync_runs", "categories", "embedding_models", "enrichment_suggestions", "external_sources",
  "financial_goals", "investment_positions", "passkey", "provider_connections", "semantic_documents",
  "semantic_embeddings", "session", "source_items", "source_sync_runs", "sync_run_items", "sync_runs",
  "sync_schedules", "sync_state", "tag_registry", "transaction_evidence_links", "transaction_rules",
  "transactions", "twoFactor", "user", "verification"
]);
export const demoUser = {
  id: "demo_user_koban",
  name: "Alex Morgan",
  email: "demo@koban.finance",
  password: "Koban-Demo-2026!"
} as const;

export interface DemoDataset {
  goals: FinancialGoal[];
  investmentPositions: InvestmentPosition[];
  ledger: Ledger;
  subscriptionNames: string[];
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

const startDate = "2024-08-01";
const endDate = "2026-07-31";
const syncedAt = "2026-07-31T18:00:00.000Z";
const demoTag = "demo-data";

const plaidConnection: ProviderConnection = {
  id: "demo_provider_plaid",
  provider: "plaid",
  displayName: "Northstar Financial (Demo)",
  status: "connected",
  configured: true,
  lastSyncedAt: syncedAt,
  staleAfter: "2026-08-14T18:00:00.000Z"
};

const manualConnection: ProviderConnection = {
  id: "demo_provider_manual",
  provider: "manual",
  displayName: "Demo manual accounts",
  status: "connected",
  configured: true,
  lastSyncedAt: syncedAt
};

const investmentConnection: ProviderConnection = {
  id: "demo_provider_snaptrade",
  provider: "snaptrade",
  displayName: "Northstar Brokerage (Demo)",
  status: "connected",
  configured: true,
  lastSyncedAt: syncedAt
};

const accountSpecs: Array<Omit<Account, "currentBalance" | "lastUpdatedAt"> & { openingBalance: number }> = [
  account("checking_primary", "Everyday Checking", "Northstar Bank", "checking", "1042", 8_600),
  account("checking_joint", "Household Checking", "Northstar Bank", "checking", "7721", 4_200),
  account("checking_side", "Side Project Checking", "Harbor Credit Union", "checking", "3308", 2_400),
  account("savings_emergency", "Emergency Fund", "Northstar Bank", "savings", "8820", 15_000),
  account("savings_travel", "Travel Fund", "Northstar Bank", "savings", "6164", 2_500),
  account("savings_home", "Home Projects", "Harbor Credit Union", "savings", "4409", 5_000),
  account("cash_wallet", "Cash Wallet", "Manual", "cash", undefined, 1_200, manualConnection.id),
  account("credit_visa", "Everyday Rewards Visa", "Northstar Bank", "credit_card", "4242", 0),
  account("credit_amex", "Travel Rewards Card", "Beacon Card Services", "credit_card", "1009", 0),
  account("credit_store", "Home & Garden Card", "Harbor Retail Bank", "credit_card", "7788", 0),
  account("loan_mortgage", "Townhouse Mortgage", "Northstar Bank", "loan", "0911", 318_000),
  account("loan_auto", "Electric Car Loan", "Harbor Credit Union", "loan", "2846", 31_500),
  account("loan_student", "Student Loan", "Civic Education Finance", "loan", "6390", 18_200),
  account("invest_brokerage", "Taxable Brokerage", "Northstar Brokerage", "investment", "5100", 0, investmentConnection.id),
  account("invest_roth", "Roth IRA", "Northstar Brokerage", "investment", "8675", 0, investmentConnection.id)
];

const subscriptionSpecs = [
  ["StreamWave", 15.49, "cat_other"],
  ["TuneBox", 10.99, "cat_other"],
  ["CloudKeep", 2.99, "cat_software"],
  ["Design Desk", 12, "cat_software"],
  ["Newsroom Digital", 8, "cat_other"],
  ["Neighborhood Gym", 64, "cat_other"],
  ["Language Garden", 13.99, "cat_software"],
  ["Meal Map Plus", 5.99, "cat_food"],
  ["Home Secure", 21.5, "cat_housing"],
  ["Trail Maps Pro", 29.99, "cat_software"],
  ["Cedar Mobile", 72, "cat_other"]
] as const;

const discretionary = [
  ["Juniper Market", "Weekly groceries", "cat_food", 38, 142],
  ["Oak & Ember Cafe", "Coffee and breakfast", "cat_food", 5, 24],
  ["Copper Spoon", "Dinner", "cat_food", 24, 96],
  ["Metro Transit", "Transit fare", "cat_transportation", 3, 18],
  ["Sunline Fuel", "Fuel", "cat_transportation", 31, 76],
  ["Paper Kite Books", "Books and gifts", "cat_shopping", 12, 84],
  ["Civic Hardware", "Household supplies", "cat_shopping", 14, 185],
  ["Willow Pharmacy", "Pharmacy purchase", "cat_other", 8, 67],
  ["Brightside Cinema", "Movie tickets", "cat_other", 18, 54],
  ["Harbor Outfitters", "Clothing", "cat_shopping", 25, 160],
  ["Pine Street Bakery", "Bakery", "cat_food", 7, 31],
  ["Parcel Post", "Shipping", "cat_other", 6, 29]
] as const;

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

export function createDemoDataset(): DemoDataset {
  const random = mulberry32(0x4b4f4241);
  const transactions: Transaction[] = [];
  let sequence = 0;
  const add = (transaction: Omit<Transaction, "id" | "providerConnectionId" | "currency" | "status" | "tags"> & { tags?: string[] }) => {
    const spec = accountSpecs.find((candidate) => candidate.id === transaction.accountId);
    if (!spec) throw new Error(`Unknown demo account ${transaction.accountId}.`);
    transactions.push({
      ...transaction,
      id: `demo_txn_${String(sequence++).padStart(5, "0")}`,
      providerConnectionId: spec.providerConnectionId,
      currency: "USD",
      status: "posted",
      tags: [demoTag, ...(transaction.tags ?? [])]
    });
    return transactions.at(-1)!;
  };

  for (const spec of accountSpecs.filter((candidate) => candidate.type !== "investment")) {
    add({
      accountId: spec.id,
      date: startDate,
      authorizedDate: startDate,
      postedDate: startDate,
      merchantName: "Opening Balance",
      description: "Synthetic opening balance for demo history",
      amount: spec.type === "credit_card" || spec.type === "loan" ? -spec.openingBalance : spec.openingBalance,
      categoryId: "cat_transfer",
      reviewed: true
    });
  }

  const goals: FinancialGoal[] = [
    goal("emergency", "Six-month emergency fund", "🛟", 45_000_00),
    goal("travel", "Japan trip", "🗾", 8_500_00),
    goal("home", "Kitchen refresh", "🏡", 18_000_00)
  ];

  for (const month of monthsBetween(startDate, endDate)) {
    const salaryDate = `${month}-01`;
    add(baseTransaction("checking_primary", salaryDate, "Lumen Studio Payroll", "Direct deposit", 7_850, "cat_income", true));
    add(baseTransaction("checking_joint", `${month}-15`, "Lumen Studio Payroll", "Household allocation", 3_600, "cat_income", true));
    if (random() > 0.25) {
      add(baseTransaction("checking_side", `${month}-20`, "Mosaic Consulting", "Client payment", roundMoney(900 + random() * 1_900), "cat_income", true));
    }
    add(baseTransaction("checking_joint", `${month}-03`, "Northstar Mortgage", "Mortgage interest and escrow", -1_700, "cat_housing", true));
    add(baseTransaction("checking_joint", `${month}-06`, "Greenlight Energy", "Electric utility", -roundMoney(92 + random() * 68), "cat_housing", true));
    add(baseTransaction("checking_joint", `${month}-09`, "Clearwater Utilities", "Water and waste", -roundMoney(54 + random() * 26), "cat_housing", true));
    add(baseTransaction("checking_primary", `${month}-11`, "Cedar Insurance", "Insurance premiums", -284, "cat_other", true));
    add(baseTransaction("credit_store", `${month}-14`, "Hearth & Hammer", "Home improvement supplies", -350, "cat_shopping", true));

    for (const [index, [name, amount, categoryId]] of subscriptionSpecs.entries()) {
      if (name === "Trail Maps Pro" && !month.endsWith("-05")) continue;
      add(baseTransaction(index % 3 === 0 ? "credit_amex" : "credit_visa", `${month}-${String(4 + (index * 2) % 23).padStart(2, "0")}`, name, `${name} subscription`, -amount, categoryId, true, ["subscription"]));
    }

    addTransfer(add, "checking_primary", "savings_emergency", `${month}-02`, 525, goals[0].id);
    addTransfer(add, "checking_primary", "savings_travel", `${month}-08`, 225, goals[1].id);
    addTransfer(add, "checking_joint", "savings_home", `${month}-13`, 300, goals[2].id);
    addTransfer(add, "checking_joint", "loan_mortgage", `${month}-03`, 760);
    addTransfer(add, "checking_primary", "loan_auto", `${month}-17`, 515);
    addTransfer(add, "checking_primary", "loan_student", `${month}-21`, 280);

  }

  for (const date of datesBetween(startDate, endDate)) {
    const count = 2 + Math.floor(random() * 3);
    for (let index = 0; index < count; index += 1) {
      const [merchant, description, categoryId, minimum, maximum] = discretionary[Math.floor(random() * discretionary.length)];
      const accountId = random() < 0.56 ? "credit_visa" : random() < 0.78 ? "credit_amex" : random() < 0.92 ? "checking_primary" : "cash_wallet";
      const reviewed = random() > 0.075;
      add(baseTransaction(
        accountId,
        date,
        merchant,
        description,
        -roundMoney(minimum + random() * (maximum - minimum)),
        reviewed ? categoryId : "cat_other",
        reviewed
      ));
    }
  }

  // Pay 92% of each month's posted card charges, leaving a believable small
  // statement balance while keeping every payment paired to its cash outflow.
  for (const month of monthsBetween(startDate, endDate)) {
    for (const card of ["credit_visa", "credit_amex", "credit_store"] as const) {
      const accountId = `demo_account_${card}`;
      const charges = -transactions
        .filter((transaction) => transaction.accountId === accountId && transaction.date.startsWith(month) && transaction.amount < 0)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      addTransfer(add, card === "credit_store" ? "checking_joint" : "checking_primary", card, `${month}-25`, roundMoney(charges * 0.92));
    }
  }

  const investmentPositions = createInvestmentPositions();
  const investmentBalances = new Map<string, number>();
  for (const position of investmentPositions) {
    investmentBalances.set(position.accountId, roundMoney((investmentBalances.get(position.accountId) ?? 0) + position.marketValue));
  }

  const accounts: Account[] = accountSpecs.map(({ openingBalance: _openingBalance, ...spec }) => {
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

  const balanceSnapshots = createBalanceSnapshots(accounts, transactions);
  const ledger: Ledger = {
    source: "koban",
    version: 1,
    lastSyncedAt: syncedAt,
    syncStartDate: startDate,
    enrollmentCount: 1,
    accounts,
    balanceSnapshots,
    transactions,
    providerConnections: [plaidConnection, manualConnection, investmentConnection],
    normalization: { amountSignConvention: internalAmountSignConvention },
    syncSummary: { accountCount: accounts.length, transactionCount: transactions.length, errors: [] }
  };

  const dataset = { goals, investmentPositions, ledger, subscriptionNames: subscriptionSpecs.map(([name]) => name) };
  assertDemoDataset(dataset);
  return dataset;
}

export function assertDemoDataset(dataset: DemoDataset): void {
  const { accounts, transactions } = dataset.ledger;
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
}

function account(id: string, name: string, institutionName: string, type: Account["type"], mask: string | undefined, openingBalance: number, providerConnectionId = plaidConnection.id) {
  return { id: `demo_account_${id}`, providerConnectionId, groupId: `demo_group_${type}`, name, institutionName, type, mask, currency: "USD", openingBalance, includedInNetWorth: true } as const;
}

function goal(id: string, name: string, emoji: string, targetAmountMinor: number): FinancialGoal {
  return { id: `demo_goal_${id}`, name, emoji, targetAmountMinor, state: "active", createdAt: `${startDate}T12:00:00.000Z`, updatedAt: syncedAt };
}

function baseTransaction(accountSuffix: string, date: string, merchantName: string, description: string, amount: number, categoryId: string, reviewed: boolean, tags: string[] = []) {
  return { accountId: `demo_account_${accountSuffix}`, date, authorizedDate: date, postedDate: date, merchantName, description, amount, categoryId, reviewed, tags };
}

function addTransfer(add: (transaction: any) => Transaction, fromSuffix: string, toSuffix: string, date: string, amount: number, financialGoalId?: string) {
  const outgoing = add({ ...baseTransaction(fromSuffix, date, "Internal Transfer", `Transfer to ${toSuffix}`, -amount, "cat_transfer", true), pairedTransactionId: "pending", financialGoalId });
  const incoming = add({ ...baseTransaction(toSuffix, date, "Internal Transfer", `Transfer from ${fromSuffix}`, amount, "cat_transfer", true), pairedTransactionId: outgoing.id });
  outgoing.pairedTransactionId = incoming.id;
}

function createInvestmentPositions(): InvestmentPosition[] {
  const positions = [
    ["brokerage", "VTI", "Total US Stock Market ETF", 185, 322.4, 238.2],
    ["brokerage", "VXUS", "Total International Stock ETF", 210, 78.15, 61.4],
    ["brokerage", "BND", "Total Bond Market ETF", 120, 75.1, 71.8],
    ["brokerage", "AAPL", "Apple Inc.", 42, 231.6, 158.3],
    ["roth", "VTI", "Total US Stock Market ETF", 94, 322.4, 211.7],
    ["roth", "AVUV", "US Small Cap Value ETF", 80, 103.9, 84.5],
    ["roth", "VXUS", "Total International Stock ETF", 65, 78.15, 59.1],
    ["roth", "BND", "Total Bond Market ETF", 55, 75.1, 70.3]
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

function createBalanceSnapshots(accounts: Account[], transactions: Transaction[]): AccountBalanceSnapshot[] {
  const snapshots: AccountBalanceSnapshot[] = [];
  for (const account of accounts) {
    for (const [index, month] of monthsBetween(startDate, endDate).entries()) {
      const progress = (index + 1) / 24;
      const asOfDate = monthEnd(month);
      const drawdown = index === 10 ? -0.05 : index === 11 ? -0.11 : index === 12 ? -0.07 : 0;
      const investmentGrowth = index === 23 ? 1 : 0.56 + 0.44 * progress + Math.sin(index * 0.8) * 0.018 + drawdown;
      const flow = transactions
        .filter((transaction) => transaction.accountId === account.id && transaction.date <= asOfDate)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      const ledgerBalance = account.type === "investment"
        ? account.currentBalance * investmentGrowth
        : account.type === "credit_card" || account.type === "loan"
          ? -flow
          : flow;
      snapshots.push({
        id: `demo_snapshot_${account.id}_${month}`,
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
