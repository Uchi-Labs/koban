import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { BottomSheet } from "@/components/ui/bottom-sheet";

describe("motion correctness", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an animated number at its supplied value on first mount", () => {
    render(<AnimatedNumber format={(value) => Math.round(value).toString()} startOnView={false} value={42} />);

    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("moves focus into a bottom sheet and restores it to the opener", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">Open sheet</button>
          <BottomSheet onOpenChange={setOpen} open={open} title="Transaction details">
            <button onClick={() => setOpen(false)} type="button">Close sheet</button>
          </BottomSheet>
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open sheet" });
    await user.click(opener);

    const closer = await screen.findByRole("button", { name: "Close sheet" });
    await waitFor(() => expect(closer).toHaveFocus());
    await user.click(closer);
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
