/**
 * Persisted width of the resizable sidebar.
 *
 * This lives in a cookie, not localStorage, because the server has to render
 * the sidebar at its saved width. Seeding React state from localStorage made
 * the first client render disagree with the server HTML (server had no
 * override and used the 16rem default; the browser had the stored pixel value)
 * and every page load logged a hydration mismatch on the sidebar wrapper.
 *
 * A plain module rather than part of app-shell.tsx so `app/layout.tsx` can read
 * it while rendering on the server without importing a "use client" module.
 * The sidebar's own open/closed state already works this way (`sidebar_state`
 * in components/ui/sidebar.tsx).
 */

export const SIDEBAR_WIDTH_COOKIE = "sidebar_width";
export const SIDEBAR_WIDTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const SIDEBAR_MIN_WIDTH = 208;
export const SIDEBAR_MAX_WIDTH = 320;
export const SIDEBAR_DEFAULT_WIDTH = 256;

export function clampSidebarWidth(px: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, px));
}

/**
 * Narrows a stored value to a usable width, or null when there is none.
 *
 * Shared by the server (reading the cookie) and the client (migrating a width
 * saved under the old localStorage key), so both clamp identically and a
 * hand-edited cookie cannot push the sidebar to an unusable size.
 */
export function parseSidebarWidth(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : null;
}
