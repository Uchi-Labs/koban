import type { Account, Transaction } from "@ai-finances/schema";
import { describe, expect, it } from "vitest";
import {
  buildInternalTransferPairMatchPlan,
  buildOneSidedInternalTransferPlan,
  internalTransferPairDateWindowDays
} from "@/lib/internal-transfer-pairing";

const checkingAccount = account({ id: "acct_checking", name: "Checking", type: "checking" });
const savingsAccount = account({ id: "acct_savings", name: "Savings", type: "savings" });
const cardAccount = account({ groupId: "group_credit", id: "acct_card", name: "Card", type: "credit_card" });
const secondCardAccount = account({
  groupId: "group_credit",
  id: "acct_second_card",
  name: "Second Card",
  type: "credit_card"
});

describe("internal transfer pair matching", () => {
  it("auto-applies an exact unique transfer pair with card-payment text", () => {
    const plan = buildInternalTransferPairMatchPlan({
      accounts: [checkingAccount, cardAccount],
      transactions: [
        transaction({
          accountId: checkingAccount.id,
          amount: -3781.31,
          description: "Payment to Chase card ending in 1234",
          id: "txn_checking_payment",
          merchantName: "CHASE"
        }),
        transaction({
          accountId: cardAccount.id,
          amount: 3781.31,
          description: "Payment Thank You-Mobile",
          id: "txn_card_payment",
          merchantName: "CHASE CARD"
        })
      ]
    });

    expect(plan.candidatePairs).toHaveLength(1);
    expect(plan.autoApplyPairs).toHaveLength(1);
    expect(plan.pendingPairs).toHaveLength(0);
    expect(plan.autoApplySuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ categoryId: "cat_transfer", transactionId: "txn_checking_payment" }),
        expect.objectContaining({ categoryId: "cat_transfer", transactionId: "txn_card_payment" })
      ])
    );
  });

  it("does not pair amount mismatches", () => {
    const plan = buildInternalTransferPairMatchPlan({
      accounts: [checkingAccount, cardAccount],
      transactions: [
        transaction({ accountId: checkingAccount.id, amount: -100, id: "txn_out" }),
        transaction({
          accountId: cardAccount.id,
          amount: 99.99,
          description: "Automatic Payment - Thank You",
          id: "txn_in"
        })
      ]
    });

    expect(plan.candidatePairs).toHaveLength(0);
    expect(plan.autoApplySuggestions).toHaveLength(0);
  });

  it("includes the five-day date edge and excludes older matches", () => {
    const withinWindow = buildInternalTransferPairMatchPlan({
      accounts: [checkingAccount, cardAccount],
      transactions: [
        transaction({ accountId: checkingAccount.id, amount: -250, date: "2026-05-01", id: "txn_out" }),
        transaction({
          accountId: cardAccount.id,
          amount: 250,
          date: "2026-05-06",
          description: "Autopay Payment",
          id: "txn_in"
        })
      ]
    });
    const outsideWindow = buildInternalTransferPairMatchPlan({
      accounts: [checkingAccount, cardAccount],
      transactions: [
        transaction({ accountId: checkingAccount.id, amount: -250, date: "2026-05-01", id: "txn_out" }),
        transaction({
          accountId: cardAccount.id,
          amount: 250,
          date: "2026-05-07",
          description: "Autopay Payment",
          id: "txn_in"
        })
      ]
    });

    expect(withinWindow.autoApplyPairs[0]).toMatchObject({
      dateDistanceDays: internalTransferPairDateWindowDays
    });
    expect(outsideWindow.candidatePairs).toHaveLength(0);
  });

  it("queues multi-candidate matches instead of auto-applying them", () => {
    const plan = buildInternalTransferPairMatchPlan({
      accounts: [checkingAccount, cardAccount, secondCardAccount],
      transactions: [
        transaction({
          accountId: checkingAccount.id,
          amount: -100,
          description: "Payment to card ending in 1111",
          id: "txn_out"
        }),
        transaction({
          accountId: cardAccount.id,
          amount: 100,
          description: "Payment Thank You-Mobile",
          id: "txn_card_a"
        }),
        transaction({
          accountId: secondCardAccount.id,
          amount: 100,
          description: "Automatic Payment - Thank You",
          id: "txn_card_b"
        })
      ]
    });

    expect(plan.candidatePairs).toHaveLength(2);
    expect(plan.autoApplyPairs).toHaveLength(0);
    expect(plan.pendingPairs).toHaveLength(2);
    expect(plan.pendingSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transactionId: "txn_out" }),
        expect.objectContaining({ transactionId: "txn_card_a" }),
        expect.objectContaining({ transactionId: "txn_card_b" })
      ])
    );
  });

  it("protects reviewed and non-other user-overlaid categories", () => {
    const reviewedPlan = buildInternalTransferPairMatchPlan({
      accounts: [checkingAccount, cardAccount],
      transactions: [
        transaction({ accountId: checkingAccount.id, amount: -400, id: "txn_out" }),
        transaction({
          accountId: cardAccount.id,
          amount: 400,
          description: "Payment Thank You-Mobile",
          id: "txn_reviewed",
          reviewed: true
        })
      ]
    });
    const userCategoryPlan = buildInternalTransferPairMatchPlan({
      accounts: [checkingAccount, cardAccount],
      transactions: [
        transaction({ accountId: checkingAccount.id, amount: -500, id: "txn_out" }),
        transaction({
          accountId: cardAccount.id,
          amount: 500,
          categoryId: "cat_shopping",
          description: "Payment Thank You-Mobile",
          id: "txn_user_category"
        })
      ]
    });

    expect(reviewedPlan.candidatePairs).toHaveLength(0);
    expect(userCategoryPlan.candidatePairs).toHaveLength(0);
  });

  it("does not turn same-account merchant refunds into transfers", () => {
    const plan = buildInternalTransferPairMatchPlan({
      accounts: [cardAccount],
      transactions: [
        transaction({
          accountId: cardAccount.id,
          amount: -45.28,
          description: "AMAZON MARKETPLACE",
          id: "txn_amazon_charge",
          merchantName: "AMAZON"
        }),
        transaction({
          accountId: cardAccount.id,
          amount: 45.28,
          description: "AMAZON CREDIT",
          id: "txn_amazon_refund",
          merchantName: "AMAZON"
        })
      ]
    });

    expect(plan.candidatePairs).toHaveLength(0);
  });

  it("can use paired statement-credit text without direct-classifying it alone", () => {
    const withPair = buildInternalTransferPairMatchPlan({
      accounts: [checkingAccount, cardAccount],
      transactions: [
        transaction({
          accountId: checkingAccount.id,
          amount: -600,
          description: "Payment to card ending in 1234",
          id: "txn_out"
        }),
        transaction({
          accountId: cardAccount.id,
          amount: 600,
          description: "Statement Credit",
          id: "txn_statement_credit"
        })
      ]
    });
    const withoutPair = buildInternalTransferPairMatchPlan({
      accounts: [cardAccount],
      transactions: [
        transaction({
          accountId: cardAccount.id,
          amount: 600,
          description: "Statement Credit",
          id: "txn_statement_credit"
        })
      ]
    });

    expect(withPair.autoApplyPairs).toHaveLength(1);
    expect(withoutPair.candidatePairs).toHaveLength(0);
  });
});

describe("one-sided internal transfer marking", () => {
  function markedIds(transactions: Transaction[], accounts: Account[], excludeTransactionIds?: Set<string>): string[] {
    return buildOneSidedInternalTransferPlan({ accounts, transactions, excludeTransactionIds }).autoApplySuggestions.map(
      (suggestion) => suggestion.transactionId
    );
  }

  it("marks a credit-card payment credit that has no connected counterpart (any provider tag)", () => {
    const marks = markedIds(
      [
        transaction({
          accountId: cardAccount.id,
          amount: 731.25,
          description: "Auto Pay Thank You",
          id: "txn_card_autopay",
          merchantName: "Auto Pay Thank You",
          tags: ["plaid"]
        })
      ],
      [cardAccount]
    );

    expect(marks).toEqual(["txn_card_autopay"]);
  });

  it("marks the bank-side card payment debit and vault/reward moves", () => {
    const marks = markedIds(
      [
        transaction({
          accountId: checkingAccount.id,
          amount: -2067.51,
          description: "",
          id: "txn_bank_cardpmt",
          merchantName: "CHASE CREDIT CRD",
          tags: ["simplefin"]
        }),
        transaction({
          accountId: savingsAccount.id,
          amount: -500,
          description: "To Emergency Fund Vault",
          id: "txn_vault_move",
          merchantName: "To Emergency Fund Vault"
        }),
        transaction({
          accountId: savingsAccount.id,
          amount: 20.19,
          description: "SoFi Rewards Redemption",
          id: "txn_reward",
          merchantName: "SoFi"
        })
      ],
      [checkingAccount, savingsAccount]
    );

    expect(marks.sort()).toEqual(["txn_bank_cardpmt", "txn_reward", "txn_vault_move"]);
  });

  it("does NOT mark a genuine bare-issuer purchase or a merchant refund credit", () => {
    const marks = markedIds(
      [
        // Bare "DISCOVER" purchase debit on a bank account — no card/payment token,
        // so the issuer name alone must never qualify (Copilot's caution).
        transaction({
          accountId: checkingAccount.id,
          amount: -48.9,
          description: "DISCOVER",
          id: "txn_discover_purchase",
          merchantName: "DISCOVER"
        }),
        // Positive credit on a card from a real merchant — a refund, not a payment.
        transaction({
          accountId: cardAccount.id,
          amount: 45.28,
          description: "AMAZON CREDIT",
          id: "txn_amazon_refund",
          merchantName: "AMAZON"
        })
      ],
      [checkingAccount, cardAccount]
    );

    expect(marks).toEqual([]);
  });

  it("never re-marks a user-recategorized, reviewed, or user-tagged transaction", () => {
    const marks = markedIds(
      [
        transaction({
          accountId: cardAccount.id,
          amount: 500,
          categoryId: "cat_shopping",
          description: "Auto Pay Thank You",
          id: "txn_user_category"
        }),
        transaction({
          accountId: cardAccount.id,
          amount: 500,
          description: "Auto Pay Thank You",
          id: "txn_reviewed",
          reviewed: true
        }),
        transaction({
          accountId: cardAccount.id,
          amount: 500,
          description: "Auto Pay Thank You",
          id: "txn_user_tag",
          tags: ["plaid", "my-custom-tag"]
        })
      ],
      [cardAccount]
    );

    expect(marks).toEqual([]);
  });

  it("yields any transaction already owned by the pair matcher", () => {
    const clearPayment = transaction({
      accountId: cardAccount.id,
      amount: 500,
      description: "Auto Pay Thank You",
      id: "txn_paired"
    });

    expect(markedIds([clearPayment], [cardAccount])).toEqual(["txn_paired"]);
    expect(markedIds([clearPayment], [cardAccount], new Set(["txn_paired"]))).toEqual([]);
  });
});

function account(input: Partial<Account>): Account {
  return {
    availableBalance: 900,
    currency: "USD",
    currentBalance: 1000,
    groupId: "group_cash",
    id: "acct",
    includedInNetWorth: true,
    institutionName: "Test Bank",
    lastUpdatedAt: "2026-05-31T00:00:00.000Z",
    mask: "1234",
    name: "Account",
    providerConnectionId: "provider_teller_test",
    type: "checking",
    ...input
  };
}

function transaction(input: Partial<Transaction>): Transaction {
  return {
    accountId: checkingAccount.id,
    amount: -100,
    categoryId: "cat_other",
    currency: "USD",
    date: "2026-05-30",
    description: "Transfer",
    id: "txn",
    merchantName: "Test Merchant",
    postedDate: "2026-05-30",
    providerConnectionId: "provider_teller_test",
    reviewed: false,
    status: "posted",
    tags: ["teller"],
    ...input
  };
}
