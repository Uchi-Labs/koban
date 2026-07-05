import { NextResponse } from "next/server";

export type JsonObject = Record<string, unknown>;

export type JsonObjectReadResult =
  | {
      body: JsonObject;
      ok: true;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export async function readJsonObject(request: Request): Promise<JsonObjectReadResult> {
  const text = await request.text();

  if (!text.trim()) {
    return invalidJsonBody("Request body must be a JSON object.");
  }

  return parseJsonObjectText(text);
}

export async function readOptionalJsonObject(request: Request): Promise<JsonObjectReadResult> {
  const text = await request.text();

  if (!text.trim()) {
    return {
      body: {},
      ok: true
    };
  }

  return parseJsonObjectText(text);
}

function parseJsonObjectText(text: string): JsonObjectReadResult {
  let value: unknown;

  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return invalidJsonBody("Request body must be valid JSON.");
  }

  if (!isJsonObject(value)) {
    return invalidJsonBody("Request body must be a JSON object.");
  }

  return {
    body: value,
    ok: true
  };
}

function invalidJsonBody(message: string): JsonObjectReadResult {
  return {
    ok: false,
    response: NextResponse.json({ error: message }, { status: 400 })
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
