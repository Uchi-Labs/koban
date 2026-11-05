import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { readJsonObject } from "@/lib/api-request";
import { buildAssistantPrompt } from "@/lib/finance-assistant";

export const runtime = "nodejs";

/**
 * Body: `{ question }`. Returns what server Ask would send its model, for a
 * model that runs in the browser: messages, tools as JSON Schema, the step cap,
 * and the meta event the answer opens with. No model is called here.
 */
export async function POST(request: Request) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const question = typeof parsed.body.question === "string" ? parsed.body.question.trim() : "";

  if (!question) {
    return NextResponse.json({ error: "Question is required." }, { status: 400 });
  }

  if (question.length > 500) {
    return NextResponse.json({ error: "Question must be 500 characters or fewer." }, { status: 400 });
  }

  try {
    return NextResponse.json({ object: "assistant_prompt", ...(await buildAssistantPrompt(question)) });
  } catch (error) {
    return errorResponse(error, "Could not prepare the question.");
  }
}
