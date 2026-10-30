import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { readJsonObject } from "@/lib/api-request";
import { streamFinanceAnswer, type AgentStreamEvent } from "@/lib/finance-assistant";
import { isPublicDemo } from "@/lib/public-demo";
import { publicDemoVisitorKey, takePublicDemoQuestion } from "@/lib/public-demo-rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body as { local_only?: unknown; question?: unknown };
  const question = typeof body.question === "string" ? body.question.trim() : "";

  if (!question) {
    return NextResponse.json({ error: "Question is required." }, { status: 400 });
  }

  if (question.length > 500) {
    return NextResponse.json({ error: "Question must be 500 characters or fewer." }, { status: 400 });
  }

  if (isPublicDemo() && body.local_only !== true) {
    const limit = takePublicDemoQuestion(publicDemoVisitorKey(request.headers));
    if (!limit.allowed) {
      return NextResponse.json(
        { error: limit.message },
        { headers: { "Retry-After": String(limit.retryAfterSeconds) }, status: 429 }
      );
    }
  }

  const events = streamFinanceAnswer(question, { forceLocal: body.local_only === true });
  let firstEvent: IteratorResult<AgentStreamEvent>;

  try {
    firstEvent = await events.next();
  } catch (error) {
    return errorResponse(error, "Finance agent stream failed.");
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (!firstEvent.done) {
          controller.enqueue(encoder.encode(encodeEvent(firstEvent.value)));
        }

        for await (const event of events) {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        }
      } catch (error) {
        controller.enqueue(encoder.encode(encodeEvent({ message: streamErrorMessage(error), type: "error" })));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson"
    }
  });
}

function encodeEvent(event: AgentStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function streamErrorMessage(error: unknown): string {
  console.error(error);
  return "Finance agent stream failed.";
}
