"use client";

import dynamic from "next/dynamic";

// ponytail: dynamic ssr:false because Next 15.5 webpack-dev fails to load sonner's
// module factory when statically imported through the RSC layout ("reading 'call'");
// production builds are unaffected. Toasts are client-only by nature anyway.
const SonnerToaster = dynamic(() => import("sonner").then((m) => m.Toaster), { ssr: false });

/**
 * App-styled Sonner toaster. Themed to Ink & Mint tokens (popover surface,
 * mint success, ember error), bottom-right, subtle. The app renders dark, so
 * we pin the theme dark and drive all colors from CSS vars in shadcn.css.
 * Motion is disabled under prefers-reduced-motion via the CSS guard there.
 */
export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      gap={10}
      offset={16}
      toastOptions={{
        classNames: {
          toast:
            "!bg-popover !text-popover-foreground !border-border !shadow-lg !rounded-2xl !ring-1 !ring-foreground/5",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground !rounded-lg",
          cancelButton: "!bg-muted !text-muted-foreground !rounded-lg",
          title: "!font-medium !tabular-nums"
        }
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--popover)",
          "--success-text": "var(--positive)",
          "--success-border": "color-mix(in oklch, var(--positive) 30%, var(--border))",
          "--error-bg": "var(--popover)",
          "--error-text": "var(--negative)",
          "--error-border": "color-mix(in oklch, var(--negative) 30%, var(--border))",
          "--border-radius": "var(--radius-2xl)"
        } as React.CSSProperties
      }
    />
  );
}
