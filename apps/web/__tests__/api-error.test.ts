// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResponse } from "@/lib/api-error";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("errorResponse", () => {
  it("preserves status-bearing domain errors in the 4xx range", async () => {
    const error = new Error("Domain validation failed.") as Error & { status: number };
    error.status = 422;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = errorResponse(error, "Fallback message.");

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "Domain validation failed." });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("returns a generic response for plain errors", async () => {
    const error = new Error("Internal provider detail.");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = errorResponse(error, "Unable to complete request.");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Unable to complete request." });
    expect(consoleError).toHaveBeenCalledWith(error);
  });

  it("returns a generic response for non-Error throws", async () => {
    const thrown = "internal-provider-detail";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = errorResponse(thrown, "Unable to complete request.");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Unable to complete request." });
    expect(consoleError).toHaveBeenCalledWith(thrown);
  });
});
