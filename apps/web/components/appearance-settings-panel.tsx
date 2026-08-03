"use client";

import { Moon, Sun } from "lucide-react";

import { useThemeToggle } from "@/components/motion/theme-toggle";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

/**
 * Appearance control for the light/dark palette.
 *
 * The palette itself has existed since the theme work (`app/shadcn.css:7` for
 * light, `:90`/`:316` for dark) and `app/layout.tsx:45` already reads a
 * `koban_theme` cookie — but nothing ever rendered a control, so light mode was
 * only reachable by setting the cookie by hand and the app always booted dark.
 *
 * `fade` variant: a straight cross-fade rather than the wipe/circle reveals, so
 * the palette dissolves in place. useThemeToggle falls back to an instant swap
 * under prefers-reduced-motion or where the View Transitions API is missing.
 */
export function AppearanceSettingsPanel() {
  const { isDark, mounted, toggle } = useThemeToggle({ variant: "fade" });

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b pb-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Appearance</h2>
          <p className="text-sm text-muted-foreground">Switch between the light and dark palette.</p>
        </div>
        <label className="flex items-center gap-2 text-sm" htmlFor="ui-theme-dark">
          <span aria-hidden="true" className="t-icon-swap text-muted-foreground" data-state={mounted && isDark ? "a" : "b"}>
            <span className="t-icon" data-icon="a">
              <Moon className="size-4" />
            </span>
            <span className="t-icon" data-icon="b">
              <Sun className="size-4" />
            </span>
          </span>
          <span className="text-muted-foreground">{mounted && isDark ? "Dark" : "Light"}</span>
          <Switch
            aria-label="Dark mode"
            checked={mounted ? isDark : true}
            id="ui-theme-dark"
            onCheckedChange={() => toggle()}
          />
        </label>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Stored on this device. The choice is read on the server, so pages render in the right palette on first
          paint instead of flashing.
        </p>
      </CardContent>
    </Card>
  );
}
