import type { SourceItemLine, Transaction } from "@ai-finances/schema";
import type { SourceItemInput } from "@/lib/db/finance-db";

// The demo household's itemized context: the grocery orders, warehouse receipts and marketplace
// orders behind its charges, each linked to the charge it was paid in. Every order's lines add up
// to that charge to the cent (assertDemoReceipts), so line-item answers agree with the ledger.

export interface DemoContextSource {
  command: string;
  displayName: string;
  id: string;
  items: SourceItemInput[];
  kind: "amazon_orders" | "gmail" | "instacart";
}

export interface DemoEvidenceLink {
  confidence: number;
  relationship: "order" | "receipt";
  sourceItemId: string;
  status: "accepted" | "suggested";
  transactionId: string;
}

/** A receipt line filed under its own category: the user's split of a mixed charge. */
export interface DemoLineCategory {
  categoryId: string;
  position: number;
  sourceItemId: string;
}

export interface DemoReceipts {
  lineCategories: DemoLineCategory[];
  links: DemoEvidenceLink[];
  sources: DemoContextSource[];
}

type Product = [name: string, unitPrice: number];

const juniperShelf: Product[] = [
  ["Oat milk, barista edition", 3.99],
  ["Eggs, dozen", 4.49],
  ["Greek yogurt pouches, 8 pack", 5.99],
  ["Sourdough loaf", 6.5],
  ["Chicken thighs, 2 lb", 11.8],
  ["Jasmine rice, 5 lb", 8.99],
  ["Coffee beans, 12 oz", 13.99],
  ["Baby spinach", 3.49],
  ["Honeycrisp apples, 3 lb", 5.49],
  ["Sharp cheddar", 6.29],
  ["Spaghetti", 2.19],
  ["Cherry tomatoes", 4.29],
  ["Dish soap", 3.99],
  ["Bananas", 1.89]
];

const costcoShelf: Product[] = [
  ["Paper towels, 12 rolls", 23.99],
  ["Frozen berry blend, 4 lb", 13.49],
  ["Rotisserie chicken", 4.99],
  ["Coffee beans, 2.5 lb", 17.99],
  ["Extra virgin olive oil, 2 L", 18.99],
  ["Jasmine rice, 25 lb", 21.99],
  ["Dog treats", 16.99],
  ["Oat milk, 6 pack", 11.99],
  ["Laundry detergent", 19.99]
];

// A warehouse run is groceries, household supplies and the dog's treats in one
// charge; each Costco line is filed under the category it belongs to.
const costcoLineCategory: Record<string, string> = {
  "Dog treats": "cat_custom_pets",
  "Kirkland household restock": "cat_household",
  "Laundry detergent": "cat_household",
  "Paper towels, 12 rolls": "cat_household"
};

const sourceIdFor = (sourceId: string, externalId: string) => `src_demo_${sourceId.replace(/^source_/, "")}_${externalId}`;
const cents = (value: number) => Math.round(value * 100);

/** Deterministic per-charge picks, so every reseed writes the same receipts. */
function seeded(seed: string) {
  let state = [...seed].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 2166136261);
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * Lines from `shelf` that add up to exactly `total`: whole products while they fit, then the
 * remainder as one weighed or loose line, the way a grocery receipt ends in produce by weight.
 */
function fillBasket(shelf: Product[], total: number, seed: string, remainderName: string): SourceItemLine[] {
  const random = seeded(seed);
  const lines: SourceItemLine[] = [];
  let left = cents(total);
  const order = shelf.map((product) => ({ product, key: random() })).sort((a, b) => a.key - b.key).map(({ product }) => product);
  for (const [name, unitPrice] of order) {
    const quantity = random() < 0.25 ? 2 : 1;
    const amount = cents(unitPrice) * quantity;
    if (amount > left - 150) continue;
    lines.push({ amount: amount / 100, name, quantity, unitPrice });
    left -= amount;
  }
  if (left > 0) {
    lines.push({ amount: left / 100, name: remainderName, quantity: 1 });
  }
  return lines;
}

export function createDemoReceipts(transactions: Transaction[]): DemoReceipts {
  const instacart: SourceItemInput[] = [];
  const gmail: SourceItemInput[] = [];
  const amazon: SourceItemInput[] = [];
  const links: DemoEvidenceLink[] = [];
  const lineCategories: DemoLineCategory[] = [];
  const paid = (transaction: Transaction) => Math.abs(transaction.amount);

  for (const transaction of transactions) {
    const merchant = transaction.merchantName;
    if (merchant === "Juniper Market") {
      const externalId = `ic_${transaction.id.replace(/^demo_txn_/, "")}`;
      const lines = fillBasket(juniperShelf, paid(transaction), transaction.id, "Produce, by weight");
      instacart.push({
        amount: paid(transaction),
        currency: "USD",
        externalId,
        id: sourceIdFor("source_instacart", externalId),
        kind: "grocery_order",
        lines,
        merchantName: "Juniper Market",
        occurredAt: `${transaction.date}T17:00:00.000Z`,
        sourceId: "source_instacart",
        summary: `Retailer: Juniper Market. Items: ${lines.length}.`,
        title: lines.slice(0, 3).map((line) => line.name).join(", ")
      });
      links.push({ confidence: 0.96, relationship: "order", sourceItemId: sourceIdFor("source_instacart", externalId), status: "accepted", transactionId: transaction.id });
    } else if (merchant === "Costco") {
      const externalId = `costco_${transaction.id.replace(/^demo_txn_/, "")}`;
      const lines = fillBasket(costcoShelf, paid(transaction), transaction.id, "Kirkland household restock");
      gmail.push({
        amount: paid(transaction),
        currency: "USD",
        externalId,
        id: sourceIdFor("source_gmail", externalId),
        kind: "receipt",
        lines,
        merchantName: "Costco",
        occurredAt: `${transaction.date}T19:30:00.000Z`,
        sourceId: "source_gmail",
        summary: "From: Costco Wholesale. Your warehouse receipt.",
        title: "Costco warehouse receipt"
      });
      links.push({ confidence: 0.93, relationship: "receipt", sourceItemId: sourceIdFor("source_gmail", externalId), status: "accepted", transactionId: transaction.id });
      for (const [position, line] of lines.entries()) {
        lineCategories.push({
          categoryId: costcoLineCategory[line.name] ?? "cat_groceries",
          position,
          sourceItemId: sourceIdFor("source_gmail", externalId)
        });
      }
    } else if (merchant === "AMZN MKTP US*2K4LQ") {
      const externalId = "113-4471902-8835461";
      const batteries = (cents(paid(transaction)) - cents(38.99) - cents(14.99)) / 100;
      amazon.push({
        amount: paid(transaction),
        currency: "USD",
        externalId,
        id: sourceIdFor("source_amazon_orders", externalId),
        kind: "order",
        lines: [
          { amount: 38.99, name: "Replacement stroller wheel, front, 7 in", quantity: 1, unitPrice: 38.99 },
          { amount: 14.99, name: "Stroller cup holder", quantity: 1, unitPrice: 14.99 },
          { amount: batteries, name: "AA batteries, 24 pack", quantity: 1, unitPrice: batteries }
        ],
        merchantName: "Amazon",
        occurredAt: `${transaction.date}T09:12:00.000Z`,
        sourceId: "source_amazon_orders",
        summary: `Order: ${externalId}. Status: Delivered.`,
        title: "Replacement stroller wheel, front, 7 in"
      });
      // still in the review queue: the matcher's suggestion, above the trust bar
      links.push({ confidence: 0.88, relationship: "order", sourceItemId: sourceIdFor("source_amazon_orders", externalId), status: "suggested", transactionId: transaction.id });
    } else if (merchant === "SQ *MAPLE ST MARKET") {
      const externalId = `square_${transaction.id.replace(/^demo_txn_/, "")}`;
      const honey = Math.round((paid(transaction) - 9.5) * 100) / 100;
      gmail.push({
        amount: paid(transaction),
        currency: "USD",
        externalId,
        id: sourceIdFor("source_gmail", externalId),
        kind: "receipt",
        lines: [
          { amount: 9.5, name: "Sourdough loaf", quantity: 1, unitPrice: 9.5 },
          { amount: honey, name: "Local wildflower honey, 12 oz", quantity: 1, unitPrice: honey }
        ],
        merchantName: "Maple St Market",
        occurredAt: `${transaction.date}T10:40:00.000Z`,
        sourceId: "source_gmail",
        summary: "From: Square. Receipt from Maple St Market.",
        title: "Receipt from Maple St Market"
      });
      links.push({ confidence: 0.82, relationship: "receipt", sourceItemId: sourceIdFor("source_gmail", externalId), status: "suggested", transactionId: transaction.id });
    }
  }

  return {
    lineCategories,
    links,
    sources: [
      { command: "instacart-pp-cli", displayName: "Instacart groceries", id: "source_instacart", items: instacart, kind: "instacart" },
      { command: "gog", displayName: "Gmail receipts", id: "source_gmail", items: gmail, kind: "gmail" },
      { command: "amazon-pp-cli", displayName: "Amazon orders", id: "source_amazon_orders", items: amazon, kind: "amazon_orders" }
    ]
  };
}

/** Every receipt's lines add up to its charge, and every link names a charge in the ledger. */
export function assertDemoReceipts(receipts: DemoReceipts, transactions: Transaction[]): void {
  const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const items = new Map(receipts.sources.flatMap((source) => source.items).map((item) => [item.id, item]));
  for (const link of receipts.links) {
    const transaction = byId.get(link.transactionId);
    const item = items.get(link.sourceItemId);
    if (!transaction || !item) throw new Error(`Demo receipt link ${link.sourceItemId} -> ${link.transactionId} is dangling.`);
    const sum = (item.lines ?? []).reduce((total, line) => total + cents(line.amount ?? 0), 0);
    if (sum !== cents(Math.abs(transaction.amount))) {
      throw new Error(`Demo receipt ${item.id} lines add to ${sum / 100}, not the charge's ${Math.abs(transaction.amount)}.`);
    }
  }
  if (!receipts.links.some((link) => link.status === "suggested")) throw new Error("The review queue should show a matched receipt.");
}
