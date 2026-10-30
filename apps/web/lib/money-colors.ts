import type { CSSProperties } from "react";

/**
 * User-chosen colours for gains and losses.
 *
 * Money semantics are a hard project rule, so these two are the only colours in
 * the app worth exposing: everything else belongs to the design register. The
 * defaults are the shipped tokens (app/quiet.css section 1), rotated toward the
 * cool side of their hue and held near 5:1 against white.
 *
 * Persisted in a cookie rather than localStorage for the same reason
 * `koban_theme` and `koban_ui` are: the server reads it while rendering, so the
 * first paint already carries the chosen colours instead of flashing the
 * defaults and correcting on hydration.
 */

export const MONEY_COLORS_COOKIE = "koban_money";

export const MONEY_COLORS_DEFAULT = Object.freeze({
  negative: "#b8455c",
  positive: "#2f7d5f"
});

export interface MoneyColors {
  negative: string;
  positive: string;
}

const HEX = /^#[0-9a-f]{6}$/;

/** `<positive>,<negative>`, six-digit hex each, leading `#` optional. */
export function parseMoneyColors(value: string | undefined): MoneyColors {
  if (!value) {
    return { ...MONEY_COLORS_DEFAULT };
  }

  const [rawPositive, rawNegative] = value.split(",", 2).map((part) => {
    const candidate = `#${part.trim().replace(/^#/, "")}`.toLowerCase();
    return HEX.test(candidate) ? candidate : null;
  });

  return {
    negative: rawNegative ?? MONEY_COLORS_DEFAULT.negative,
    positive: rawPositive ?? MONEY_COLORS_DEFAULT.positive
  };
}

export function serializeMoneyColors({ negative, positive }: MoneyColors): string {
  return `${positive.replace(/^#/, "")},${negative.replace(/^#/, "")}`;
}

export function isDefaultMoneyColors({ negative, positive }: MoneyColors): boolean {
  return negative === MONEY_COLORS_DEFAULT.negative && positive === MONEY_COLORS_DEFAULT.positive;
}

/**
 * Inline custom properties for the document root.
 *
 * Inline beats any stylesheet rule on the same element, so this one override
 * lands in both design registers at once: Ink & Mint defines `--positive`
 * directly, and the quiet register bridges it from `--q-positive`. Returns
 * nothing at all when the choice is the default, so an untouched install ships
 * no inline style and the stylesheets stay authoritative.
 *
 * One deliberate limitation: a single pair serves both light and dark. A colour
 * tuned for white can read hot on the dark ground, so the panel that sets these
 * says so rather than pretending otherwise.
 */
export function moneyColorStyle(colors: MoneyColors): CSSProperties | undefined {
  if (isDefaultMoneyColors(colors)) {
    return undefined;
  }

  return {
    "--negative": colors.negative,
    "--positive": colors.positive,
    "--q-negative": colors.negative,
    "--q-positive": colors.positive
  } as CSSProperties;
}
