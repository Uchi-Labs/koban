import { NextResponse } from "next/server";

export function errorResponse(error: unknown, fallbackMessage: string, fallbackStatus = 500): NextResponse {
  const status = domainStatus(error);

  if (status !== null) {
    return NextResponse.json({ error: errorMessage(error, fallbackMessage) }, { status });
  }

  console.error(error);
  return NextResponse.json({ error: fallbackMessage }, { status: fallbackStatus });
}

function domainStatus(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }

  const status = error.status;
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status < 500 ? status : null;
}

function errorMessage(error: unknown, fallbackMessage: string): string {
  if (!isRecord(error) || typeof error.message !== "string" || !error.message.trim()) {
    return fallbackMessage;
  }

  return error.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
