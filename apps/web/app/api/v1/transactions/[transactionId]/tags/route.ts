import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { modifyTransactionTags, TransactionTagLimitError } from "@/lib/db/finance-db";
import { serializeTransaction } from "@/lib/finance-api";
import { getFinanceData } from "@/lib/finance-data";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ transactionId: string }> }) {
  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const isTags = (value: unknown): value is string[] =>
    Array.isArray(value) && value.length <= 100 && value.every((tag) =>
      typeof tag === "string" && tag.trim().length > 0 && tag.length <= 100);
  if (Object.keys(body).some((key) => key !== "add" && key !== "remove") ||
      (body.add !== undefined && !isTags(body.add)) ||
      (body.remove !== undefined && !isTags(body.remove))) {
    return NextResponse.json({ error: "add and remove must be arrays of nonempty tags (up to 100 tags, 100 characters each)." }, { status: 400 });
  }
  const add = isTags(body.add) ? body.add : [];
  const remove = isTags(body.remove) ? body.remove : [];
  if (add.length === 0 && remove.length === 0) {
    return NextResponse.json({ error: "Provide at least one tag to add or remove." }, { status: 400 });
  }
  const { transactionId } = await params;
  let transaction;
  try {
    transaction = await modifyTransactionTags(decodeURIComponent(transactionId), { add, remove });
  } catch (error) {
    if (error instanceof TransactionTagLimitError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  if (!transaction) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
  const { accounts, categories } = await getFinanceData();
  return NextResponse.json(serializeTransaction(transaction, { accounts, categories }));
}
