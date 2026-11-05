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

/** 400 for a `starting_after` cursor that names no row in the list; null for any other error. */
export function unknownCursorResponse(error: unknown): NextResponse | null {
  if (!isRecord(error) || error.name !== "UnknownCursorError" || typeof error.message !== "string") {
    return null;
  }

  return NextResponse.json(
    { code: error.code, error: error.message, param: error.param },
    { status: 400 }
  );
}

/** 409 when a sync is requested while another sync holds the sync lock. */
export function syncInProgressResponse(): NextResponse {
  return NextResponse.json(
    {
      code: "sync_in_progress",
      error: "A sync is already running. Wait for it to finish, then check the latest run."
    },
    { status: 409 }
  );
}
