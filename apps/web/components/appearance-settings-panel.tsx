"use client";

import { Moon, Sun } from "lucide-react";
import * as React from "react";

import { useThemeToggle } from "@/components/motion/theme-toggle";
import {
  ACCENT_COOKIE,
  ACCENT_DEFAULT,
  ACCENT_ORDER,
  ACCENTS,
  type AccentId,
  accentStyle,
  isAccentId
} from "@/lib/accent-color";
import { BlossomPicker } from "@/components/ui/blossom-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  FONT_CHOICE_COOKIE,
  FONT_CHOICE_DEFAULT,
  FONT_FAMILIES,
  FONT_FAMILY_ORDER,
  type FontChoice,
  fontChoiceStyle,
  isDefaultFontChoice,
  isFontFamilyId,
  serializeFontChoice
} from "@/lib/font-choice";
import {
  isDefaultMoneyColors,
  MONEY_COLORS_COOKIE,
  MONEY_COLORS_DEFAULT,
  type MoneyColors,
  serializeMoneyColors
} from "@/lib/money-colors";
import { cn } from "@/lib/utils";

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
/**
 * Writes the chosen pair straight onto the document root and into the cookie.
 *
 * The inline custom properties are what make the change visible immediately, in
 * every chart and figure at once, without a reload: they outrank both design
 * registers' stylesheet definitions. The cookie is only so the server can paint
 * the same colours on the next request.
 */
function applyMoneyColors(colors: MoneyColors) {
  const root = document.documentElement;

  for (const [property, value] of [
    ["--positive", colors.positive],
    ["--negative", colors.negative],
    ["--q-positive", colors.positive],
    ["--q-negative", colors.negative]
  ] as const) {
    if (isDefaultMoneyColors(colors)) {
      root.style.removeProperty(property);
    } else {
      root.style.setProperty(property, value);
    }
  }

  const encoded = isDefaultMoneyColors(colors) ? "" : serializeMoneyColors(colors);
  document.cookie = encoded
    ? `${MONEY_COLORS_COOKIE}=${encoded}; Path=/; Max-Age=31536000; SameSite=Lax`
    : `${MONEY_COLORS_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Same contract as applyMoneyColors: paint now, persist for the next render. */
function applyAccent(id: AccentId) {
  const root = document.documentElement;
  const style = accentStyle(id);

  for (const property of ["--q-accent-light", "--q-accent-dark"] as const) {
    const value = style?.[property as keyof typeof style] as string | undefined;

    if (value) {
      root.style.setProperty(property, value);
    } else {
      root.style.removeProperty(property);
    }
  }

  document.cookie =
    id === ACCENT_DEFAULT
      ? `${ACCENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
      : `${ACCENT_COOKIE}=${id}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/** Same contract as applyMoneyColors: paint now, persist for the next render. */
function applyFontChoice(choice: FontChoice) {
  const root = document.documentElement;
  const style = fontChoiceStyle(choice);

  for (const property of ["--font-sans", "--q-font-sans", "--q-font-display"] as const) {
    const value = style?.[property as keyof typeof style] as string | undefined;

    if (value) {
      root.style.setProperty(property, value);
    } else {
      root.style.removeProperty(property);
    }
  }

  document.cookie = isDefaultFontChoice(choice)
    ? `${FONT_CHOICE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
    : `${FONT_CHOICE_COOKIE}=${serializeFontChoice(choice)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function AppearanceSettingsPanel({
  initialAccent = ACCENT_DEFAULT,
  initialFontChoice = FONT_CHOICE_DEFAULT,
  initialMoneyColors = MONEY_COLORS_DEFAULT
}: {
  initialAccent?: AccentId;
  initialFontChoice?: FontChoice;
  initialMoneyColors?: MoneyColors;
}) {
  const { isDark, mounted, toggle } = useThemeToggle({ variant: "fade" });
  const [moneyColors, setMoneyColors] = React.useState<MoneyColors>(initialMoneyColors);
  const [fontChoice, setFontChoice] = React.useState<FontChoice>(initialFontChoice);
  const [accent, setAccent] = React.useState<AccentId>(initialAccent);

  const changeAccent = (value: string | null) => {
    if (!value || !isAccentId(value)) return;
    setAccent(value);
    applyAccent(value);
  };

  // Base UI's Select can emit null (a cleared selection); a typeface axis has
  // no empty state, so that is ignored rather than written as a broken value.
  const changeFontAxis = (axis: keyof FontChoice) => (value: string | null) => {
    if (!value || !isFontFamilyId(value)) return;
    const next: FontChoice = { ...fontChoice, [axis]: value };
    setFontChoice(next);
    applyFontChoice(next);
  };

  const updateMoneyColor = (key: keyof MoneyColors) => (hex: string) => {
    const next = { ...moneyColors, [key]: hex.toLowerCase() };
    setMoneyColors(next);
    applyMoneyColors(next);
  };

  const resetMoneyColors = () => {
    setMoneyColors(MONEY_COLORS_DEFAULT);
    applyMoneyColors(MONEY_COLORS_DEFAULT);
  };

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
      <CardContent className="flex flex-col gap-6">
        <p className="text-sm text-muted-foreground">
          Stored on this device. The choice is read on the server, so pages render in the right palette on first
          paint instead of flashing.
        </p>

        <div className="flex flex-col gap-4 border-t pt-6">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Typeface</h3>
            <p className="text-sm text-muted-foreground">
              Body carries figures and tables; display sets titles. Every face is already on this device, so
              switching downloads nothing.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                { axis: "body", label: "Body", sample: "$12,273.45" },
                { axis: "display", label: "Display", sample: "Net income" }
              ] as const
            ).map(({ axis, label, sample }) => {
              const selected = FONT_FAMILIES[fontChoice[axis]];

              return (
                <div className="flex flex-col gap-1.5" key={axis}>
                  <span className="text-xs tracking-wide text-muted-foreground uppercase">{label}</span>
                  <Select onValueChange={changeFontAxis(axis)} value={fontChoice[axis]}>
                    {/* Trigger and options are each set in the face they name, so
                        the list is legible as a specimen rather than a word list. */}
                    <SelectTrigger aria-label={`${label} typeface`} className="w-full">
                      <span style={{ fontFamily: selected.stack }}>{selected.label}</span>
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_FAMILY_ORDER.map((id) => (
                        <SelectItem key={id} value={id}>
                          <span style={{ fontFamily: FONT_FAMILIES[id].stack }}>{FONT_FAMILIES[id].label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span
                    className={cn("text-sm text-muted-foreground", axis === "body" && "tabular-nums")}
                    style={{ fontFamily: selected.stack }}
                  >
                    {sample}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t pt-6">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Accent</h3>
            <p className="text-sm text-muted-foreground">
              Links, selection, and primary buttons. Each option is a pair, one value per palette, because no
              single colour stays legible on both the light and dark ground.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Select onValueChange={changeAccent} value={accent}>
              <SelectTrigger aria-label="Accent colour" className="w-56">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full"
                    style={{ background: "var(--q-accent)" }}
                  />
                  {ACCENTS[accent].label}
                </span>
              </SelectTrigger>
              <SelectContent>
                {ACCENT_ORDER.map((id) => (
                  <SelectItem key={id} value={id}>
                    <span className="flex items-center gap-2">
                      {/* Both ground values shown, since that is what is being chosen. */}
                      <span
                        aria-hidden="true"
                        className="size-3 shrink-0 rounded-full ring-1 ring-border"
                        style={{ background: ACCENTS[id].light }}
                      />
                      <span
                        aria-hidden="true"
                        className="size-3 shrink-0 rounded-full ring-1 ring-border"
                        style={{ background: ACCENTS[id].dark }}
                      />
                      {ACCENTS[id].label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <a className="text-sm underline underline-offset-4" href="#accent-sample">
              Sample link
            </a>
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">Money colours</h3>
              <p className="text-sm text-muted-foreground">
                Gains and losses, everywhere they appear. One pair serves both palettes, so check a colour reads
                on the ground you actually use.
              </p>
            </div>
            {isDefaultMoneyColors(moneyColors) ? null : (
              <Button onClick={resetMoneyColors} size="sm" variant="ghost">
                Reset
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-10">
            {(
              [
                { key: "positive", label: "Gains", sample: "+$8,400.00" },
                { key: "negative", label: "Losses", sample: "−$19,300.00" }
              ] as const
            ).map(({ key, label, sample }) => (
              <div className="flex flex-col items-start gap-2" key={key}>
                <span className="text-xs tracking-wide text-muted-foreground uppercase">{label}</span>
                <BlossomPicker
                  ariaLabel={`${label} colour`}
                  onChange={updateMoneyColor(key)}
                  value={moneyColors[key]}
                />
                <span className="font-medium tabular-nums" style={{ color: moneyColors[key] }}>
                  {sample}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
