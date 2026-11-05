import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

describe("cn with the custom type scale", () => {
  it("keeps a small primary button's text colour beside text-ui", () => {
    const classes = cn(buttonVariants({ size: "sm" })).split(" ");
    expect(classes).toContain("text-ui");
    expect(classes).toContain("text-primary-foreground");
  });

  it("treats text-ui, text-2xs and text-3xs as sizes, not colours", () => {
    expect(cn("text-sm", "text-ui")).toBe("text-ui");
    expect(cn("text-ui", "text-muted-foreground")).toBe("text-ui text-muted-foreground");
    expect(cn("text-2xs text-destructive", "text-3xs")).toBe("text-destructive text-3xs");
  });
});
