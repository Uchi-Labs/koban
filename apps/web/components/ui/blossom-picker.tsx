"use client";

// Blossom color picker (@dayflow/blossom-color-picker) wrapped to the app's
// color contract: it speaks {hue, saturation, alpha, layer} internally but the
// registry stores CSS color strings, so this adapts to `value`/`onChange(hex)`.

import {
  BlossomColorPicker as Blossom,
  lightnessToSliderValue,
  parseColor
} from "@dayflow/blossom-color-picker-react";
import { useReducedMotion } from "motion/react";
import * as React from "react";
import "@dayflow/blossom-color-picker/styles.css";
import { oklchToHex } from "@/lib/bloom-color";
import { categoryColorPalette } from "@/lib/category-style";
import { cn } from "@/lib/utils";

const FALLBACK_HEX = "#7c8794";

// The registry palette is authored in oklch; Blossom takes CSS color strings.
const PALETTE_HEX = categoryColorPalette.map((color) => oklchToHex(color) ?? FALLBACK_HEX);

// Blossom's `.bcp-root` is sized to the COLLAPSED core (~32px) while `.bcp-container`
// is absolutely positioned and grows to the expanded bloom — so the open state paints
// outside the root's box and over whatever sits below it. Reserve the expanded
// footprint here so the picker never overlaps its siblings.
// petalSize 30 => 148px svg + the arc slider that rides outside the petal ring.
const EXPANDED_SIZE = 176;

export interface BlossomPickerProps {
  ariaLabel?: string;
  className?: string;
  onChange: (hex: string) => void;
  petalSize?: number;
  value?: string;
}

export function BlossomPicker({ ariaLabel, className, onChange, petalSize, value }: BlossomPickerProps) {
  const reducedMotion = useReducedMotion();

  // ponytail: uncontrolled. Blossom's `saturation` is a slider position, not HSL
  // saturation, so a hex -> {hue, saturation, layer} inversion would be lossy and
  // would fight the user's own drag. Seeding the layer/hue from the current value
  // is enough; onChange is the source of truth from there.
  /**
   * Seeded with the colour string itself, which Blossom accepts directly
   * (`ColorInput = string | {h,s,l}` in its types) and converts internally.
   *
   * Two earlier attempts got this wrong in different directions, both because
   * they tried to hand-build Blossom's value object. The first looked the hex
   * up in PALETTE_HEX and derived a hue from the array index, so any colour
   * outside the twelve category swatches missed and fell back to a fixed hue of
   * 330 -- every petal opened pink. The second passed real HSL in, ignoring
   * this file's own warning that Blossom's `saturation` is a SLIDER POSITION
   * rather than HSL saturation; the mismatched pair rendered near-black. The
   * component already knows how to read a colour, so hand it the colour.
   */
  const defaultValue = React.useMemo(() => {
    const hex = value && /^oklch\(/i.test(value) ? oklchToHex(value) : value;
    const { h, s, l } = parseColor(hex ?? FALLBACK_HEX);

    return {
      alpha: 100,
      hue: Math.round(h),
      lightness: Math.round(l),
      // Blossom's inner ring holds the pale tints, the outer ring the full ones.
      layer: l > 70 ? ("inner" as const) : ("outer" as const),
      originalSaturation: Math.round(s),
      // NOT the HSL saturation. This field is a slider position, and the
      // package ships the conversion for exactly this reason.
      saturation: lightnessToSliderValue(l)
    };
    // Seed once — later `value` changes come from this picker itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      aria-label={ariaLabel}
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ height: EXPANDED_SIZE, width: EXPANDED_SIZE }}
    >
      <Blossom
        animationDuration={reducedMotion ? 0 : 300}
        colors={PALETTE_HEX}
        defaultValue={defaultValue}
        onChange={(color) => onChange(color.hex)}
        petalSize={petalSize ?? 30}
      />
    </div>
  );
}
