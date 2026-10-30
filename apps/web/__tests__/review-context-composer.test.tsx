import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewContextComposer } from "@/components/review-context-composer";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReviewContextComposer", () => {
  it("adds typed context on top of the existing context and saves it as a context note", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify({ transaction: { notes: JSON.parse(String(init?.body)).body } }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();

    render(<ReviewContextComposer existing="Coffee on the walk to the studio." onSaved={onSaved} transactionId="txn_1" />);
    const field = screen.getByRole("textbox", { name: "Add context" });
    fireEvent.change(field, { target: { value: "Bought for the team offsite." } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/transactions/txn_1/context-notes");
    expect(JSON.parse(String(init?.body))).toEqual({
      body: "Coffee on the walk to the studio.\n\nBought for the team offsite."
    });
    expect(onSaved).toHaveBeenCalledWith("Coffee on the walk to the studio.\n\nBought for the team offsite.");
    expect(field).toHaveValue("");
  });

  it("keeps Shift+Enter as a new line instead of saving", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ReviewContextComposer existing={undefined} onSaved={vi.fn()} transactionId="txn_1" />);
    const field = screen.getByRole("textbox", { name: "Add context" });
    fireEvent.change(field, { target: { value: "Line one" } });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
