import { describe, expect, it } from "vitest";
import {
  isIncomeTransaction,
  isLikelyGroceryTransaction,
  isLikelyIncomeTransaction,
  isLikelyTransferLikeTransaction,
  isReviewActionableTransaction,
  isSpendingTransaction
} from "@/lib/transaction-classification";

describe("transaction classification", () => {
  it("recognizes internal transfers and credit-card payments without treating every payment as transfer", () => {
    expect(
      isLikelyTransferLikeTransaction({
        description: "SoFi Bank TRANSFER VSrinivasan WEB ID: 9039430511",
        merchantName: "SOFI BANK",
        transactionType: "ach"
      })
    ).toBe(true);
    expect(
      isLikelyTransferLikeTransaction({
        description: "AMERICAN EXPRESS ACH PMT A8676 WEB ID: 9493560001",
        merchantName: "AMERICAN EXPRESS",
        transactionType: "ach"
      })
    ).toBe(true);
    expect(
      isLikelyTransferLikeTransaction({
        description: "Payment to Chase card ending in 7238 05/15",
        merchantName: "ENDING",
        transactionType: "digital_payment"
      })
    ).toBe(true);
    expect(
      isLikelyTransferLikeTransaction({
        description:
          "REAL TIME PAYMENT CREDIT RECD FROM ABA/CONTR BNK-114094384 FROM: XOOM, A PAYPAL SERVICE INFO: TEXT-RMTINF-ACCTVERIFY",
        merchantName: "XOOM",
        transactionType: "ach"
      })
    ).toBe(true);
    expect(
      isLikelyTransferLikeTransaction({
        description: "Pirate Ship payment payment WEB ID: 1882511058",
        merchantName: "PIRATE SHIP",
        transactionType: "ach"
      })
    ).toBe(false);
  });

  it("excludes transfer categories from spending and income rollups", () => {
    expect(isSpendingTransaction({ amount: -100, categoryId: "cat_food" })).toBe(true);
    expect(isSpendingTransaction({ amount: -100, categoryId: "cat_transfer" })).toBe(false);
    expect(isIncomeTransaction({ amount: 100, categoryId: "cat_income" })).toBe(true);
    expect(isIncomeTransaction({ amount: 100, categoryId: "cat_transfer" })).toBe(false);
  });

  it("recognizes payroll income and keeps review counts focused on actionable rows", () => {
    expect(
      isLikelyIncomeTransaction({
        description: "BNYMELLON PAYROLL PPD ID: 0251233834",
        merchantName: "BNYMELLON"
      })
    ).toBe(true);
    expect(isReviewActionableTransaction({ amount: -100, categoryId: "cat_other", reviewed: false })).toBe(true);
    expect(isReviewActionableTransaction({ amount: -100, categoryId: "cat_transfer", reviewed: false })).toBe(false);
    expect(isReviewActionableTransaction({ amount: 100, categoryId: "cat_income", reviewed: false })).toBe(false);
    expect(isReviewActionableTransaction({ amount: -100, categoryId: "cat_food", reviewed: true })).toBe(false);
  });

  it("recognizes Instacart and grocery merchants before provider category noise", () => {
    expect(
      isLikelyGroceryTransaction({
        description: "IC* INSTACART 888-246-7822",
        merchantName: "INSTACART",
        providerCategory: "software"
      })
    ).toBe(true);
    expect(
      isLikelyGroceryTransaction({
        description: "EAST END FOOD CO-OP",
        merchantName: "EAST END FOOD"
      })
    ).toBe(true);
  });
});
