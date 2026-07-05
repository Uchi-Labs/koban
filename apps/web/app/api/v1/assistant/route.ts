import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { answerFinanceQuestion } from "@/lib/finance-assistant";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const question = request.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json(await answerFinanceQuestion(question));
}

export async function POST(request: NextRequest) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body as { local_only?: unknown; message?: unknown; question?: unknown; use_llm?: unknown };
  const question =
    typeof body.question === "string" ? body.question : typeof body.message === "string" ? body.message : "";
  const forceLocal = body.local_only === true || body.use_llm === false;

  if (question.length > 500) {
    return NextResponse.json({ error: "Question must be 500 characters or fewer." }, { status: 400 });
  }

  return NextResponse.json(await answerFinanceQuestion(question, { forceLocal }));
}
