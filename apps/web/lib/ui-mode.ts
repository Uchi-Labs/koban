/**
 * Which design tree renders: the existing Ink & Mint UI, or the quiet register.
 *
 * This is migration scaffolding, not a permanent feature. It exists so each
 * page can be rebuilt and compared against the original while the redesign is
 * in progress. When every surface has landed in the quiet register, this
 * module, the cookie, and `components/ui/` all get deleted together.
 *
 * Read server-side in `app/layout.tsx` so the first paint is already correct,
 * the same way `koban_theme` avoids a flash of the wrong palette.
 */

export type UiMode = "ink" | "quiet";

export const UI_MODE_COOKIE = "koban_ui";
// Ink & Mint is what the public demo shows; the personal app matches it until
// the quiet register is chosen in Settings.
export const UI_MODE_DEFAULT: UiMode = "ink";

/** Narrows an arbitrary cookie value, falling back to the current design. */
export function parseUiMode(value: string | undefined): UiMode {
  if (value === "quiet" || value === "ink") {
    return value;
  }

  return UI_MODE_DEFAULT;
}
