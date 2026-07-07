import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import { StatefulButton } from "@/components/ui/stateful-button";

describe("StatefulButton", () => {
  it("disables the button and marks it busy while loading", () => {
    render(
      <StatefulButton loadingText="Saving" state="loading">
        Save note
      </StatefulButton>
    );

    const button = screen.getByRole("button", { name: "Saving" });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("exposes success and error labels for state changes", () => {
    const { rerender } = render(
      <StatefulButton state="success" successText="Saved">
        Save note
      </StatefulButton>
    );

    expect(screen.getByRole("button", { name: "Saved" })).toBeEnabled();

    rerender(
      <StatefulButton errorText="Failed" state="error">
        Save note
      </StatefulButton>
    );

    expect(screen.getByRole("button", { name: "Failed" })).toBeEnabled();
  });
});
