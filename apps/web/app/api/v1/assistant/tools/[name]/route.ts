import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { readJsonObject } from "@/lib/api-request";
import { isAssistantDataToolName, runAssistantDataTool } from "@/lib/finance-assistant";

export const runtime = "nodejs";

/**
 * Runs one of Ask's read-only ledger tools for a model running in the browser.
 * Body: the tool's input object, checked against the schema the model was given.
 */
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  if (!isAssistantDataToolName(name)) {
    return NextResponse.json({ error: `No assistant tool named ${name}.` }, { status: 404 });
  }

  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const run = await runAssistantDataTool(name, parsed.body);

    if (!run.ok) {
      return NextResponse.json({ error: run.error }, { status: 400 });
    }

    return NextResponse.json({ name, object: "assistant_tool_result", result: run.result });
  } catch (error) {
    return errorResponse(error, "Assistant tool failed.");
  }
}
