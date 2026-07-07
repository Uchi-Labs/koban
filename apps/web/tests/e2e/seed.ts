import type { Account, InvestmentPosition, ProviderConnection, Transaction } from "@ai-finances/schema";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  closeFinanceDbForTests,
  readFinanceDbSnapshot,
  replaceSnapTradeInvestmentSnapshot,
  replaceTellerLedgerInDb
} from "@/lib/db/finance-db";
import type { TellerLedger } from "@/lib/finance-data";
import { tellerInternalAmountSignConvention } from "@/lib/teller-normalization";

const e2eDbRelativePath = path.join("tests", "e2e", ".e2e-data", "pglite");
const e2eDataRoot = path.join(process.cwd(), "tests", "e2e", ".e2e-data");
const e2eDbPath = path.join(e2eDataRoot, "pglite");
const e2eTellerBackupPath = path.join(e2eDataRoot, "teller-ledger-backup.json");
const syncedAt = "2026-06-30T12:00:00.000Z";

const providerConnection: ProviderConnection = {
  id: "provider_e2e_teller",
  provider: "teller",
  displayName: "Synthetic E2E Teller Connection",
  status: "connected",
  configured: true,
  lastSyncedAt: syncedAt,
  staleAfter: "2026-07-15T12:00:00.000Z"
};

const accounts: Account[] = [
  {
    id: "acct_e2e_checking",
    providerConnectionId: providerConnection.id,
    groupId: "group_cash",
    name: "E2E Checking",
    institutionName: "E2E Bank",
    type: "checking",
    mask: "1001",
    currency: "USD",
    currentBalance: 6420.15,
    availableBalance: 6400.15,
    includedInNetWorth: true,
    lastUpdatedAt: syncedAt
  },
  {
    id: "acct_e2e_visa",
    providerConnectionId: providerConnection.id,
    groupId: "group_credit",
    name: "E2E Visa",
    institutionName: "E2E Bank",
    type: "credit_card",
    mask: "4242",
    currency: "USD",
    currentBalance: 1284.88,
    availableBalance: 8715.12,
    includedInNetWorth: true,
    lastUpdatedAt: syncedAt
  }
];

const investmentProviderConnection: ProviderConnection = {
  id: "provider_e2e_snaptrade",
  provider: "snaptrade",
  displayName: "Synthetic E2E Brokerage",
  status: "connected",
  configured: true,
  lastSyncedAt: syncedAt
};

const investmentAccount: Account = {
  id: "acct_e2e_brokerage",
  providerConnectionId: investmentProviderConnection.id,
  groupId: "group_investments",
  name: "E2E Brokerage",
  institutionName: "E2E Brokerage",
  type: "investment",
  mask: "9001",
  currency: "USD",
  currentBalance: 12500,
  includedInNetWorth: true,
  lastUpdatedAt: syncedAt
};

const investmentPosition: InvestmentPosition = {
  id: "pos_e2e_aapl",
  accountId: investmentAccount.id,
  symbol: "AAPL",
  description: "Synthetic E2E Apple holding",
  units: 10,
  price: 250,
  currency: "USD",
  marketValue: 2500
};

export default async function globalSetup(): Promise<void> {
  await seedE2eDatabase();
}

export async function seedE2eDatabase(): Promise<void> {
  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
  process.env.AI_FINANCES_PGLITE_DIR = e2eDbRelativePath;
  process.env.AI_FINANCES_TELLER_BACKUP_PATH = e2eTellerBackupPath;

  rmSync(e2eDataRoot, { force: true, recursive: true });
  mkdirSync(e2eDbPath, { recursive: true });

  try {
    await replaceTellerLedgerInDb(createSyntheticE2eLedger());
    await replaceSnapTradeInvestmentSnapshot({
      accounts: [investmentAccount],
      balanceSnapshots: [
        {
          id: `${investmentAccount.id}_20260601120000`,
          accountId: investmentAccount.id,
          asOfDate: "2026-06-01",
          capturedAt: "2026-06-01T12:00:00.000Z",
          ledgerBalance: 12000,
          currency: "USD",
          source: "snaptrade"
        },
        {
          id: `${investmentAccount.id}_20260630120000`,
          accountId: investmentAccount.id,
          asOfDate: "2026-06-30",
          capturedAt: syncedAt,
          ledgerBalance: investmentAccount.currentBalance,
          currency: "USD",
          source: "snaptrade"
        }
      ],
      errors: [],
      finishedAt: syncedAt,
      positionAccountIds: [investmentAccount.id],
      positions: [investmentPosition],
      providerConnections: [investmentProviderConnection],
      startedAt: syncedAt,
      successfulProviderConnectionIds: [investmentProviderConnection.id]
    });
    const snapshot = await readFinanceDbSnapshot();

    if (!snapshot || snapshot.accounts.length !== accounts.length + 1 || snapshot.transactions.length !== transactions.length) {
      throw new Error("E2E seed did not write the expected synthetic ledger.");
    }
  } finally {
    await closeFinanceDbForTests();
  }
}

function createSyntheticE2eLedger(): TellerLedger {
  return {
    source: "teller",
    version: 1,
    lastSyncedAt: syncedAt,
    syncStartDate: "2026-04-01",
    enrollmentCount: 1,
    accounts: [...accounts, investmentAccount],
    transactions,
    providerConnections: [providerConnection, investmentProviderConnection],
    balanceSnapshots: [
      {
        id: `${investmentAccount.id}_20260601120000`,
        accountId: investmentAccount.id,
        asOfDate: "2026-06-01",
        capturedAt: "2026-06-01T12:00:00.000Z",
        ledgerBalance: 12000,
        currency: "USD",
        source: "snaptrade"
      },
      {
        id: `${investmentAccount.id}_20260630120000`,
        accountId: investmentAccount.id,
        asOfDate: "2026-06-30",
        capturedAt: syncedAt,
        ledgerBalance: investmentAccount.currentBalance,
        currency: "USD",
        source: "snaptrade"
      }
    ],
    normalization: {
      amountSignConvention: tellerInternalAmountSignConvention
    },
    syncSummary: {
      accountCount: accounts.length,
      transactionCount: transactions.length,
      errors: []
    }
  };
}

const transactions: Transaction[] = [
  e2eTransaction({
    id: "txn_e2e_040",
    accountId: "acct_e2e_checking",
    date: "2026-06-28",
    merchantName: "E2E Grocer Market",
    description: "Synthetic E2E grocery basket needing review",
    amount: -96.42,
    categoryId: "cat_food",
    reviewed: false,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_039",
    accountId: "acct_e2e_visa",
    date: "2026-06-27",
    merchantName: "E2E Cloud Tools",
    description: "Synthetic E2E OpenAI monthly software subscription needing review",
    amount: -29.99,
    categoryId: "cat_other",
    reviewed: false,
    tags: ["synthetic-e2e", "subscription"]
  }),
  e2eTransaction({
    id: "txn_e2e_038",
    accountId: "acct_e2e_visa",
    date: "2026-06-25",
    merchantName: "E2E Design Suite",
    description: "Synthetic E2E software renewal",
    amount: -48,
    categoryId: "cat_software",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_037",
    accountId: "acct_e2e_checking",
    date: "2026-06-23",
    merchantName: "E2E Noodle Bar",
    description: "Synthetic E2E lunch receipt",
    amount: -18.75,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_036",
    accountId: "acct_e2e_checking",
    date: "2026-06-21",
    merchantName: "E2E Meal Prep",
    description: "Synthetic E2E prepared meals",
    amount: -64.2,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_035",
    accountId: "acct_e2e_checking",
    date: "2026-06-19",
    merchantName: "E2E Grocer Market",
    description: "Synthetic E2E grocery run needing review",
    amount: -88.13,
    categoryId: "cat_food",
    reviewed: false,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_034",
    accountId: "acct_e2e_visa",
    date: "2026-06-18",
    merchantName: "E2E Video Service",
    description: "Synthetic E2E streaming subscription",
    amount: -16.49,
    categoryId: "cat_software",
    reviewed: true,
    tags: ["synthetic-e2e", "subscription"]
  }),
  e2eTransaction({
    id: "txn_e2e_033",
    accountId: "acct_e2e_checking",
    date: "2026-06-16",
    merchantName: "E2E Coffee Stand",
    description: "Synthetic E2E coffee",
    amount: -7.25,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_032",
    accountId: "acct_e2e_visa",
    date: "2026-06-14",
    merchantName: "E2E App Store",
    description: "Synthetic E2E app purchase needing review",
    amount: -12.99,
    categoryId: "cat_software",
    reviewed: false,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_031",
    accountId: "acct_e2e_checking",
    date: "2026-06-12",
    merchantName: "E2E Grocer Market",
    description: "Synthetic E2E grocery basket",
    amount: -92.31,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_030",
    accountId: "acct_e2e_visa",
    date: "2026-06-10",
    merchantName: "E2E Office Snacks",
    description: "Synthetic E2E office snack order",
    amount: -33.8,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_029",
    accountId: "acct_e2e_visa",
    date: "2026-06-08",
    merchantName: "E2E Code Hosting",
    description: "Synthetic E2E developer hosting",
    amount: -18,
    categoryId: "cat_software",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_028",
    accountId: "acct_e2e_checking",
    date: "2026-06-05",
    merchantName: "E2E Grocer Market",
    description: "Synthetic E2E grocery run",
    amount: -81.44,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_027",
    accountId: "acct_e2e_visa",
    date: "2026-06-05",
    merchantName: "E2E Cloud Tools",
    description: "Synthetic E2E monthly software subscription",
    amount: -29.99,
    categoryId: "cat_software",
    reviewed: true,
    tags: ["synthetic-e2e", "subscription"]
  }),
  e2eTransaction({
    id: "txn_e2e_026",
    accountId: "acct_e2e_checking",
    date: "2026-06-02",
    merchantName: "E2E Bakery",
    description: "Synthetic E2E bakery receipt",
    amount: -22.1,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_025",
    accountId: "acct_e2e_checking",
    date: "2026-05-30",
    merchantName: "E2E Grocer Market",
    description: "Synthetic E2E grocery basket",
    amount: -84.02,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_024",
    accountId: "acct_e2e_visa",
    date: "2026-05-28",
    merchantName: "E2E Design Suite",
    description: "Synthetic E2E software renewal",
    amount: -48,
    categoryId: "cat_software",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_023",
    accountId: "acct_e2e_checking",
    date: "2026-05-26",
    merchantName: "E2E Taco Shop",
    description: "Synthetic E2E dinner receipt",
    amount: -27.65,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_022",
    accountId: "acct_e2e_visa",
    date: "2026-05-24",
    merchantName: "E2E Learning Platform",
    description: "Synthetic E2E learning software",
    amount: -39,
    categoryId: "cat_software",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_021",
    accountId: "acct_e2e_checking",
    date: "2026-05-22",
    merchantName: "E2E Grocer Market",
    description: "Synthetic E2E grocery run",
    amount: -79.55,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_020",
    accountId: "acct_e2e_visa",
    date: "2026-05-20",
    merchantName: "E2E App Store",
    description: "Synthetic E2E app purchase",
    amount: -11.99,
    categoryId: "cat_software",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_019",
    accountId: "acct_e2e_checking",
    date: "2026-05-18",
    merchantName: "E2E Coffee Stand",
    description: "Synthetic E2E coffee",
    amount: -6.95,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_018",
    accountId: "acct_e2e_checking",
    date: "2026-05-15",
    merchantName: "E2E Grocer Market",
    description: "Synthetic E2E grocery basket",
    amount: -86.44,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_017",
    accountId: "acct_e2e_visa",
    date: "2026-05-13",
    merchantName: "E2E Office Snacks",
    description: "Synthetic E2E office snack order",
    amount: -34.1,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_016",
    accountId: "acct_e2e_checking",
    date: "2026-05-10",
    merchantName: "E2E Meal Prep",
    description: "Synthetic E2E prepared meals",
    amount: -62.8,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_015",
    accountId: "acct_e2e_checking",
    date: "2026-05-08",
    merchantName: "E2E Grocer Market",
    description: "Synthetic E2E grocery run",
    amount: -82.77,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_014",
    accountId: "acct_e2e_visa",
    date: "2026-05-05",
    merchantName: "E2E Cloud Tools",
    description: "Synthetic E2E monthly software subscription",
    amount: -29.99,
    categoryId: "cat_software",
    reviewed: true,
    tags: ["synthetic-e2e", "subscription"]
  }),
  e2eTransaction({
    id: "txn_e2e_013",
    accountId: "acct_e2e_checking",
    date: "2026-05-01",
    merchantName: "E2E Grocer Market",
    description: "Synthetic E2E grocery basket",
    amount: -77.46,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_012",
    accountId: "acct_e2e_checking",
    date: "2026-04-29",
    merchantName: "E2E Grocer Market",
    description: "Synthetic E2E grocery run",
    amount: -73.14,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_011",
    accountId: "acct_e2e_visa",
    date: "2026-04-27",
    merchantName: "E2E Design Suite",
    description: "Synthetic E2E software renewal",
    amount: -48,
    categoryId: "cat_software",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_010",
    accountId: "acct_e2e_checking",
    date: "2026-04-24",
    merchantName: "E2E Grocer Market",
    description: "Synthetic E2E grocery basket",
    amount: -75.66,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_009",
    accountId: "acct_e2e_visa",
    date: "2026-04-22",
    merchantName: "E2E Learning Platform",
    description: "Synthetic E2E learning software",
    amount: -39,
    categoryId: "cat_software",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_008",
    accountId: "acct_e2e_checking",
    date: "2026-04-19",
    merchantName: "E2E Coffee Stand",
    description: "Synthetic E2E coffee",
    amount: -6.5,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_007",
    accountId: "acct_e2e_checking",
    date: "2026-04-17",
    merchantName: "E2E Grocer Market",
    description: "Synthetic E2E grocery run",
    amount: -72.05,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_006",
    accountId: "acct_e2e_visa",
    date: "2026-04-15",
    merchantName: "E2E App Store",
    description: "Synthetic E2E app purchase",
    amount: -9.99,
    categoryId: "cat_software",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_005",
    accountId: "acct_e2e_checking",
    date: "2026-04-12",
    merchantName: "E2E Meal Prep",
    description: "Synthetic E2E prepared meals",
    amount: -61.3,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_004",
    accountId: "acct_e2e_checking",
    date: "2026-04-10",
    merchantName: "E2E Grocer Market",
    description: "Synthetic E2E grocery basket",
    amount: -70.84,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_003",
    accountId: "acct_e2e_visa",
    date: "2026-04-08",
    merchantName: "E2E Office Snacks",
    description: "Synthetic E2E office snack order",
    amount: -31.9,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  }),
  e2eTransaction({
    id: "txn_e2e_002",
    accountId: "acct_e2e_visa",
    date: "2026-04-05",
    merchantName: "E2E Cloud Tools",
    description: "Synthetic E2E monthly software subscription",
    amount: -29.99,
    categoryId: "cat_software",
    reviewed: true,
    tags: ["synthetic-e2e", "subscription"]
  }),
  e2eTransaction({
    id: "txn_e2e_001",
    accountId: "acct_e2e_checking",
    date: "2026-04-03",
    merchantName: "E2E Grocer Market",
    description: "Synthetic E2E grocery run",
    amount: -68.22,
    categoryId: "cat_food",
    reviewed: true,
    tags: ["synthetic-e2e"]
  })
];

function e2eTransaction({
  accountId,
  amount,
  categoryId,
  date,
  description,
  id,
  merchantName,
  reviewed,
  status = "posted",
  tags
}: {
  accountId: string;
  amount: number;
  categoryId: "cat_food" | "cat_other" | "cat_software";
  date: string;
  description: string;
  id: string;
  merchantName: string;
  reviewed: boolean;
  status?: Transaction["status"];
  tags: string[];
}): Transaction {
  return {
    id,
    accountId,
    providerConnectionId: providerConnection.id,
    date,
    authorizedDate: date,
    postedDate: status === "posted" ? date : undefined,
    merchantName,
    description,
    amount,
    currency: "USD",
    categoryId,
    status,
    reviewed,
    tags
  };
}
