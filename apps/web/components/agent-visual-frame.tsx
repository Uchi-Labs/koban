"use client";

import * as React from "react";
import type { AgentVisual } from "@/lib/agent-visual";
import { cn } from "@/lib/utils";

/**
 * Draws one model-made page inline in the chat. The frame is sandboxed to
 * scripts only (no same-origin, so the page cannot read Koban's cookies or DOM)
 * and its CSP blocks every network request, which matters because demo
 * visitors steer what the model writes. Koban's tokens arrive as CSS
 * variables, Apercu arrives as data URLs (an opaque-origin frame cannot fetch
 * the app's font files), and the page reports its height so the frame never
 * scrolls inside the chat.
 */

const themeTokens = [
  "background",
  "foreground",
  "muted",
  "muted-foreground",
  "card",
  "card-foreground",
  "border",
  "primary",
  "primary-foreground",
  "accent",
  "accent-foreground",
  "positive",
  "negative",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "radius"
];

const minHeight = 60;
const maxHeight = 2000;
const fontFamily = "Koban Sans";
let fontFacesPromise: Promise<string> | null = null;

export function AgentVisualFrame({ className, visual }: { className?: string; visual: AgentVisual }) {
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(160);
  // Null until the fonts are inlined, so the frame loads once instead of twice.
  const [fontFaces, setFontFaces] = React.useState<string | null>(null);
  const themeVersion = useThemeVersion();

  React.useEffect(() => {
    let active = true;
    void loadFontFaces().then((css) => {
      if (active) setFontFaces(css);
    });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { height?: unknown; kobanVisual?: unknown } | null;
      if (data?.kobanVisual !== visual.id || typeof data.height !== "number" || !Number.isFinite(data.height)) return;
      setHeight(Math.min(maxHeight, Math.max(minHeight, Math.ceil(data.height))));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [visual.id]);

  // themeVersion re-reads the tokens when the theme flips.
  const scheme = React.useMemo(
    () => (typeof window === "undefined" ? "light" : document.documentElement.classList.contains("dark") ? "dark" : "light"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themeVersion]
  );
  const srcDoc = React.useMemo(
    () => (fontFaces === null ? null : buildDocument(visual, readThemeVariables(), fontFaces, scheme)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visual, fontFaces, scheme, themeVersion]
  );

  if (srcDoc === null) {
    return <div aria-hidden="true" className={cn("w-full", className)} style={{ height }} />;
  }

  return (
    <iframe
      className={cn(
        "block w-full border-0 bg-transparent transition-[height] duration-200 ease-[var(--ease-smooth-out)] motion-reduce:transition-none",
        className
      )}
      data-testid="agent-visual"
      ref={frameRef}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      // A frame whose color scheme differs from the page's gets an opaque backdrop.
      style={{ colorScheme: scheme, height }}
      title={visual.title}
    />
  );
}

function buildDocument(visual: AgentVisual, variables: string, fontFaces: string, scheme: "dark" | "light") {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:";
  const reportHeight = `(function(){var id=${JSON.stringify(visual.id)};function send(){var b=document.body;if(!b)return;var s=getComputedStyle(b);parent.postMessage({kobanVisual:id,height:b.scrollHeight+parseFloat(s.marginTop)+parseFloat(s.marginBottom)},"*")}if(typeof ResizeObserver!=="undefined"){new ResizeObserver(send).observe(document.body)}addEventListener("load",send);send()})();`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${fontFaces}:root{color-scheme:${scheme};${variables}--font-sans:"${fontFamily}",ui-sans-serif,system-ui,sans-serif;}*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0;background:transparent;color:var(--foreground);font-family:var(--font-sans);font-size:14px;font-size-adjust:0.55;line-height:1.5;-webkit-font-smoothing:antialiased;overflow:hidden}</style></head><body>${visual.html}<script>${reportHeight}</script></body></html>`;
}

function readThemeVariables() {
  if (typeof window === "undefined") return "";
  const styles = getComputedStyle(document.documentElement);
  return themeTokens
    .map((token) => {
      const value = styles.getPropertyValue(`--${token}`).trim();
      return value ? `--${token}:${value};` : "";
    })
    .join("");
}

function useThemeVersion() {
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    const observer = new MutationObserver(() => setVersion((current) => current + 1));
    observer.observe(document.documentElement, { attributeFilter: ["class", "data-theme"], attributes: true });
    return () => observer.disconnect();
  }, []);
  return version;
}

// Regular and medium cover the text a chart draws; the result is cached for
// every frame on the page.
function loadFontFaces(): Promise<string> {
  fontFacesPromise ??= (async () => {
    try {
      const family = getComputedStyle(document.body).fontFamily.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
      const faces: Array<{ url: string; weight: string }> = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          if (!(rule instanceof CSSFontFaceRule)) continue;
          const style = rule.style;
          const ruleFamily = style.getPropertyValue("font-family").trim().replace(/^["']|["']$/g, "");
          if (ruleFamily !== family || (style.getPropertyValue("font-style") || "normal") !== "normal") continue;
          const weight = style.getPropertyValue("font-weight") || "400";
          const url = /url\(["']?([^"')]+)["']?\)/.exec(style.getPropertyValue("src"))?.[1];
          if (url && /^(400|500)/.test(weight)) faces.push({ url: new URL(url, sheet.href ?? location.href).href, weight });
        }
      }
      const css = await Promise.all(
        faces.map(async ({ url, weight }) => {
          const blob = await (await fetch(url)).blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          return `@font-face{font-family:"${fontFamily}";src:url(${dataUrl}) format("woff2");font-weight:${weight};font-style:normal;font-display:block}`;
        })
      );
      return css.join("");
    } catch {
      return "";
    }
  })();
  return fontFacesPromise;
}
