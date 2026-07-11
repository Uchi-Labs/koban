import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "@/components/ui/toast";

function ToastStackHarness() {
  const { showToast } = useToast();

  return (
    <button
      onClick={() => {
        showToast({ duration: 0, status: "info", title: "First toast" });
        showToast({ duration: 0, status: "success", title: "Second toast" });
        showToast({ duration: 0, status: "error", title: "Third toast" });
      }}
      type="button"
    >
      Show stack
    </button>
  );
}

describe("ToastProvider", () => {
  it("renders multiple useToast calls through the animated stack", async () => {
    render(
      <ToastProvider>
        <ToastStackHarness />
      </ToastProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: "Show stack" }));

    expect(screen.getByText("First toast")).toBeInTheDocument();
    expect(screen.getByText("Second toast")).toBeInTheDocument();
    expect(screen.getByText("Third toast")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
