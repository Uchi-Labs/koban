import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { appCategories } from "@/lib/categories";
import { serializeTransaction } from "@/lib/finance-api";
import { getFinanceData, updateStoredTransactionInDb } from "@/lib/finance-data";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params;
  const { accounts, categories, transactions } = await getFinanceData();
  const transaction = transactions.find((candidate) => candidate.id === decodeURIComponent(transactionId));

  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found in the local Teller ledger." }, { status: 404 });
  }

  return NextResponse.json(serializeTransaction(transaction, { accounts, categories }));
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params;
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body as {
    category_id?: unknown;
    categoryId?: unknown;
    notes?: unknown;
    reviewed?: unknown;
    tags?: unknown;
  };
  const update: Parameters<typeof updateStoredTransactionInDb>[1] = {};
  const categoryId = typeof body.category_id === "string" ? body.category_id : body.categoryId;

  if (Array.isArray(body.tags)) {
    update.tags = body.tags.flatMap((tag) => (typeof tag === "string" ? [tag] : []));
  }

  if (typeof body.notes === "string") {
    update.notes = body.notes;
  }

  if (typeof body.reviewed === "boolean") {
    update.reviewed = body.reviewed;
  }

  if (typeof categoryId === "string") {
    if (!appCategories.some((category) => category.id === categoryId)) {
      return NextResponse.json({ error: "Unknown category." }, { status: 400 });
    }

    update.categoryId = categoryId;
  }

  const transaction = await updateStoredTransactionInDb(decodeURIComponent(transactionId), update);

  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found in the local Teller ledger." }, { status: 404 });
  }

  const { accounts, categories } = await getFinanceData();
  return NextResponse.json(serializeTransaction(transaction, { accounts, categories }));
}
