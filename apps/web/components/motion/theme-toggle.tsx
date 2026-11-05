"use client";
// beui.dev/components/motion/theme-toggle

import { Moon, Sun } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import { ActionSwapIcon } from "@/components/ui/action-swap";
import { cn } from "@/lib/utils";

export type ThemeVariant = "rectangle" | "circle" | "circle-blur" | "fade";

export type RectStart =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center"
  | "bottom-up";

export interface ThemeToggleProps
  extends Omit<ComponentPropsWithoutRef<"button">, "children" | "onClick"> {
  /** Animation variant. Default: "rectangle". */
  variant?: ThemeVariant;
  /** Origin direction for the reveal. Default: "bottom-up". */
  start?: RectStart;
  iconClassName?: string;
}

const VT_STYLE_ID = "beui-theme-toggle-vt";

// Duration/easing is component-specific: View Transition API uses CSS, not
// motion springs, so it consumes the shared CSS easing tokens directly.
const VT_CSS = `
html[data-beui-vt="rect"]::view-transition-old(root) {
  animation: none;
  mix-blend-mode: normal;
}
html[data-beui-vt="rect"]::view-transition-new(root) {
  mix-blend-mode: normal;
  animation: beui-rect-reveal 280ms var(--ease-smooth-out);
}
html[data-beui-vt="circle"]::view-transition-old(root),
html[data-beui-vt="circle-blur"]::view-transition-old(root) {
  animation: none;
  mix-blend-mode: normal;
}
html[data-beui-vt="circle"]::view-transition-new(root) {
  mix-blend-mode: normal;
  animation: beui-circle-reveal 300ms var(--ease-strong-in-out);
}
html[data-beui-vt="circle-blur"]::view-transition-new(root) {
  mix-blend-mode: normal;
  animation: beui-circle-blur-reveal 300ms var(--ease-strong-in-out);
}
@keyframes beui-rect-reveal {
  from { clip-path: var(--beui-vt-from, inset(100% 0 0 0)); }
  to   { clip-path: inset(0 0 0 0); }
}
@keyframes beui-circle-reveal {
  from { clip-path: circle(0% at var(--beui-vt-origin, 50% 100%)); }
  to   { clip-path: circle(150% at var(--beui-vt-origin, 50% 100%)); }
}
@keyframes beui-circle-blur-reveal {
  from { clip-path: circle(0% at var(--beui-vt-origin, 50% 100%)); filter: blur(8px); }
  to   { clip-path: circle(150% at var(--beui-vt-origin, 50% 100%)); filter: blur(0px); }
}
/* Straight cross-fade: both snapshots share the frame and trade opacity, so the
   palette dissolves in place instead of being wiped in from an edge. The
   explicit pair is needed because the browser default cross-fades on its own
   timing, and normal blending keeps the two layers from compositing into a
   bright flash mid-transition. */
html[data-beui-vt="fade"]::view-transition-old(root) {
  mix-blend-mode: normal;
  animation: beui-fade-out 260ms var(--ease-smooth-out) forwards;
}
html[data-beui-vt="fade"]::view-transition-new(root) {
  mix-blend-mode: normal;
  animation: beui-fade-in 260ms var(--ease-smooth-out);
}
@keyframes beui-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes beui-fade-in  { from { opacity: 0; } to { opacity: 1; } }
`;

const RECT_FROM: Record<RectStart, string> = {
  "top-left":    "inset(0 100% 100% 0)",
  "top-right":   "inset(0 0 100% 100%)",
  "bottom-left": "inset(100% 100% 0 0)",
  "bottom-right":"inset(100% 0 0 100%)",
  center:        "inset(50% 50% 50% 50%)",
  "bottom-up":   "inset(100% 0 0 0)",
};

const CIRCLE_ORIGIN: Record<RectStart, string> = {
  "top-left":    "0% 0%",
  "top-right":   "100% 0%",
  "bottom-left": "0% 100%",
  "bottom-right":"100% 100%",
  center:        "50% 50%",
  "bottom-up":   "50% 100%",
};

export function useThemeToggle({
  variant = "rectangle",
  start = "bottom-up",
}: { variant?: ThemeVariant; start?: RectStart } = {}) {
  const reduce = useReducedMotion() ?? false;
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);
  useEffect(() => {
    if (document.getElementById(VT_STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = VT_STYLE_ID;
    el.textContent = VT_CSS;
    document.head.appendChild(el);
  }, []);
  const applyTheme = (theme: "dark" | "light") => {
    const root = document.documentElement;
    // Freeze per-element color transitions so the whole page flips at once
    // instead of fading in a ragged cascade.
    root.classList.add("theme-switching");
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    void root.offsetHeight;
    requestAnimationFrame(() => root.classList.remove("theme-switching"));
    document.cookie = `koban_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setIsDark(theme === "dark");
  };

  const toggle = () => {
    const next = isDark ? "light" : "dark";

    if (reduce || !("startViewTransition" in document)) {
      applyTheme(next);
      return;
    }

    const root = document.documentElement;

    if (variant === "fade") {
      // No clip-path origin to set — a cross-fade has no direction.
      root.dataset.beuiVt = "fade";
    } else if (variant === "rectangle") {
      root.style.setProperty("--beui-vt-from", RECT_FROM[start]);
      root.dataset.beuiVt = "rect";
    } else {
      root.style.setProperty("--beui-vt-origin", CIRCLE_ORIGIN[start]);
      root.dataset.beuiVt = variant;
    }

    const vt = (
      document as Document & {
        startViewTransition(cb: () => void): { finished: Promise<void> };
      }
    ).startViewTransition(() => applyTheme(next));

    vt.finished.finally(() => {
      delete root.dataset.beuiVt;
    });
  };

  return { isDark, mounted, toggle };
}

export function ThemeToggle({
  variant = "rectangle",
  start = "bottom-up",
  className,
  iconClassName,
  ...rest
}: ThemeToggleProps) {
  const { isDark, mounted, toggle } = useThemeToggle({ variant, start });

  return (
    <button
      type="button"
      aria-label={mounted && isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggle}
      className={cn("flex items-center justify-center", className)}
      {...rest}
    >
      {mounted ? (
        <ActionSwapIcon
          value={isDark ? "dark" : "light"}
          animation="blur"
          className={iconClassName}
        >
          {isDark ? (
            <Sun className={iconClassName} />
          ) : (
            <Moon className={iconClassName} />
          )}
        </ActionSwapIcon>
      ) : (
        <span className={iconClassName} aria-hidden="true" />
      )}
    </button>
  );
}
