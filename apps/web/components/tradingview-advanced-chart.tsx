"use client";

import React from "react";

/**
 * TradingView Advanced Chart embed. The external script is injected only when
 * this component mounts (i.e. when the drill-in sheet opens) — nothing loads on
 * the page until then. A bad symbol renders TradingView's own inline error; we
 * just avoid mounting at all when there is no symbol to look up.
 */
export function TradingViewAdvancedChart({
  symbol,
  theme = "dark",
  height = 360
}: {
  symbol: string | null;
  theme?: "light" | "dark";
  height?: number;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !symbol) {
      return;
    }

    // Fresh widget mount for each symbol/theme change.
    container.innerHTML = '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>';

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      allow_symbol_change: false,
      autosize: true,
      calendar: false,
      hide_side_toolbar: true,
      // Two time controls read as a bug. The top toolbar sets the CANDLE INTERVAL
      // (1m/30m/1h/D — "D" means one bar per day, not "show one day"), while the
      // bottom row sets the VISIBLE RANGE (1D…All). For "how is this holding
      // doing" only the range matters, and having both on screen made picking
      // "D" look like it returned ten months. Keep the range row, drop the rest.
      hide_top_toolbar: true,
      hide_volume: false,
      interval: "D",
      locale: "en",
      save_image: false,
      style: "3",
      symbol,
      theme,
      timezone: "Etc/UTC",
      withdateranges: true
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [symbol, theme]);

  if (!symbol) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground"
        style={{ height }}
      >
        No market symbol available for this holding.
      </div>
    );
  }

  return (
    // No `resize-y`: the widget sizes itself once from the container it mounts
    // into (autosize), and dragging the CSS resize handle afterwards grew the
    // box without the embedded iframe following, leaving the chart drawn in the
    // top strip with dead space beneath it. A fixed container height keeps the
    // widget and its frame the same size.
    <div
      className="tradingview-widget-container overflow-hidden rounded-xl border border-border"
      ref={containerRef}
      style={{ height }}
    />
  );
}
