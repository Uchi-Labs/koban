"use client";

import { useEffect, useState } from "react";

import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { UI_MODE_COOKIE, type UiMode } from "@/lib/ui-mode";

/**
 * Switches the whole app between the Ink & Mint design and the quiet register.
 *
 * Migration scaffolding — this control and `components/ui/` are removed
 * together once every surface has been rebuilt. Until then it exists so any
 * page can be compared against its original side by side.
 *
 * The swap is a cross-fade rather than a wipe, for the same reason the theme
 * toggle uses one: a palette change reads better dissolving in place than
 * arriving from an edge. Browsers without the View Transitions API, and anyone
 * who asked for reduced motion, get the instant swap instead.
 */

const VT_STYLE_ID = "koban-ui-mode-vt";

const VT_CSS = `
html[data-ui-vt="fade"]::view-transition-old(root) {
  mix-blend-mode: normal;
  animation: koban-ui-fade-out 260ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
html[data-ui-vt="fade"]::view-transition-new(root) {
  mix-blend-mode: normal;
  animation: koban-ui-fade-in 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes koban-ui-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes koban-ui-fade-in  { from { opacity: 0; } to { opacity: 1; } }
`;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useUiMode() {
  const [mode, setMode] = useState<UiMode>("ink");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = document.documentElement.dataset.ui;
    setMode(current === "quiet" ? "quiet" : "ink");
    setMounted(true);
  }, []);

  useEffect(() => {
    if (document.getElementById(VT_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = VT_STYLE_ID;
    style.textContent = VT_CSS;
    document.head.appendChild(style);
  }, []);

  const apply = (next: UiMode) => {
    document.documentElement.dataset.ui = next;
    document.cookie = `${UI_MODE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setMode(next);
  };

  const toggle = () => {
    const next: UiMode = mode === "quiet" ? "ink" : "quiet";

    if (prefersReducedMotion() || !("startViewTransition" in document)) {
      apply(next);
      return;
    }

    const root = document.documentElement;
    root.dataset.uiVt = "fade";

    const transition = (
      document as Document & {
        startViewTransition(callback: () => void): { finished: Promise<void> };
      }
    ).startViewTransition(() => apply(next));

    transition.finished.finally(() => {
      delete root.dataset.uiVt;
    });
  };

  return { isQuiet: mode === "quiet", mounted, toggle };
}

export function UiModeSettingsPanel() {
  const { isQuiet, mounted, toggle } = useUiMode();

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b pb-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Design</h2>
          <p className="text-sm text-muted-foreground">
            Preview the quiet redesign across the whole app.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm" htmlFor="ui-mode-quiet">
          <span className="text-muted-foreground">{mounted && isQuiet ? "Quiet" : "Ink & Mint"}</span>
          <Switch
            aria-label="Quiet redesign"
            checked={mounted ? isQuiet : false}
            id="ui-mode-quiet"
            onCheckedChange={() => toggle()}
          />
        </label>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Work in progress. Stored on this device and read on the server, so pages render in the
          chosen design on first paint. This control goes away once the redesign is finished.
        </p>
      </CardContent>
    </Card>
  );
}
