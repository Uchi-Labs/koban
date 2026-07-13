"use client";

import React, { useState } from "react";
import { FaviconBadge } from "@/components/ui/favicon-badge";
import { institutionDomain } from "@/lib/merchant-domain";

/**
 * Per-account institution favicon, following the wave-2 dashboard pattern
 * (lib/merchant-domain.ts -> FaviconBadge). Bank/brokerage institution names
 * rarely resolve to a real domain, so this always has an honest fallback: the
 * account group's existing accent icon in its tinted circle, never a fabricated
 * or generic placeholder logo.
 */
export function AccountFaviconBadge({
  accentColorVar,
  fallbackIcon,
  institutionName
}: {
  accentColorVar: string;
  /** Pre-rendered icon element (e.g. `<Landmark size={13} />`) -- a bare component
   * reference can't cross the Server -> Client boundary, only rendered elements can. */
  fallbackIcon: React.ReactNode;
  institutionName: string;
}) {
  const domain = institutionDomain(institutionName);
  const [failed, setFailed] = useState(false);

  if (!domain || failed) {
    return (
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full"
        style={{
          backgroundColor: `color-mix(in oklab, var(${accentColorVar}) 18%, transparent)`,
          color: `var(${accentColorVar})`
        }}
      >
        {fallbackIcon}
      </span>
    );
  }

  return <FaviconBadge onFaviconError={() => setFailed(true)} size="sm" website={domain} />;
}
