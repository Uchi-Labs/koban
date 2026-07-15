"use client";

// Bloom category color picker — a swatch + hex pill that "blooms" a flower of
// petal hues over a tinted plate, with a shade arc for lightening/darkening.
// Signature interaction after Shivraj Roy's Bloom Picker, restyled to the dark
// Ink & Mint theme. Motion via the repo's LazyMotion/domAnimation setup; the
// whole bloom is springs, and reduced-motion drops to instant opacity only.

import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { Check, Pencil } from "lucide-react";
import React from "react";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { EASE_SMOOTH_OUT } from "@/lib/motion";
import {
  ARC_END_DEG,
  ARC_START_DEG,
  PETAL_HUES,
  angleForPoint,
  arcPoint,
  isValidHex,
  nearestPetalIndex,
  normalizeHex,
  oklchToHex,
  petalHex,
  rgbToHex,
  shadeColor,
  tForArcAngle
} from "@/lib/bloom-color";
import { cn } from "@/lib/utils";

// ── Geometry (px, in the flower panel's own coordinate space) ────────────────
// Dahlia proportions: petals are large relative to the plate and OVERLAP their
// ring neighbors (spacing < diameter), inner ring paints above outer, so the
// flower fills the plate instead of reading as spaced dots.
const PANEL_W = 268;
const PANEL_H = 268;
const CX = 108;
const CY = 136;
const R_OUTER = 62;
const R_INNER = 34;
const PLATE_R = 96;
const CENTER_KNOB = 36;
const ARC_RADIUS = 116;
const ARC_KNOB = 20;
const PETAL_OUTER = 46;
const PETAL_INNER = 44;
const PETAL_SPRING = { type: "spring" as const, stiffness: 460, damping: 24, mass: 0.7 };

interface PetalLayout {
  index: number;
  hex: string;
  size: number;
  left: number;
  top: number;
  centerX: number;
  centerY: number;
}

interface BloomPickerState {
  editing: boolean;
  focusIndex: number;
  hexDraft: string;
  open: boolean;
  shadeT: number;
  workingHue: string;
}

type BloomPickerAction = {
  type: "patch";
  patch: Partial<BloomPickerState>;
};

const INITIAL_BLOOM_PICKER_STATE: BloomPickerState = {
  editing: false,
  focusIndex: 0,
  hexDraft: "",
  open: false,
  shadeT: 0.5,
  workingHue: "#7c8794"
};

function bloomPickerReducer(state: BloomPickerState, action: BloomPickerAction): BloomPickerState {
  return { ...state, ...action.patch };
}

function buildPetalLayout(): PetalLayout[] {
  const outer = PETAL_HUES.filter((petal) => petal.ring === "outer");
  const inner = PETAL_HUES.filter((petal) => petal.ring === "inner");
  const layout: PetalLayout[] = [];

  outer.forEach((petal, position) => {
    const angle = (-90 + position * (360 / outer.length)) * (Math.PI / 180);
    const centerX = CX + R_OUTER * Math.cos(angle);
    const centerY = CY + R_OUTER * Math.sin(angle);
    layout.push({
      index: layout.length,
      hex: petalHex(petal),
      size: PETAL_OUTER,
      left: centerX - PETAL_OUTER / 2,
      top: centerY - PETAL_OUTER / 2,
      centerX,
      centerY
    });
  });

  inner.forEach((petal, position) => {
    const angle = (-90 + 30 + position * (360 / inner.length)) * (Math.PI / 180);
    const centerX = CX + R_INNER * Math.cos(angle);
    const centerY = CY + R_INNER * Math.sin(angle);
    layout.push({
      index: layout.length,
      hex: petalHex(petal),
      size: PETAL_INNER,
      left: centerX - PETAL_INNER / 2,
      top: centerY - PETAL_INNER / 2,
      centerX,
      centerY
    });
  });

  return layout;
}

const PETALS = buildPetalLayout();

/**
 * Convert any CSS color string (hex, oklch, named) to #rrggbb. Uses the canvas
 * 2D fillStyle normalizer, which parses CSS Color 4 (incl. oklch) and always
 * reads back as #rrggbb or rgba(...). getComputedStyle is unreliable here — this
 * Chrome hands oklch back verbatim rather than resolving it to rgb.
 */
function cssColorToHex(color: string): string | null {
  const direct = normalizeHex(color);
  if (direct) {
    return direct;
  }

  // oklch is our legacy storage format; convert it in JS — some Chromium builds
  // hand it back verbatim from canvas/getComputedStyle rather than resolving it.
  if (/^oklch\(/i.test(color.trim())) {
    const fromOklch = oklchToHex(color);
    if (fromOklch) {
      return fromOklch;
    }
  }

  if (typeof document === "undefined") {
    return null;
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  // Sentinel first: an invalid color leaves fillStyle unchanged.
  const sentinel = "#010203";
  ctx.fillStyle = sentinel;
  ctx.fillStyle = color;
  const parsed = ctx.fillStyle;

  if (parsed === sentinel && normalizeHex(color) !== sentinel) {
    return null;
  }

  const hex = normalizeHex(parsed);
  if (hex) {
    return hex;
  }

  if (/^oklch\(/i.test(parsed.trim())) {
    return oklchToHex(parsed);
  }

  const parts = parsed.match(/[\d.]+/g);
  if (!parts || parts.length < 3) {
    return null;
  }

  return rgbToHex({ r: Number(parts[0]), g: Number(parts[1]), b: Number(parts[2]) });
}

export interface BloomColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  ariaLabel?: string;
  className?: string;
}

export function BloomColorPicker({ value, onChange, ariaLabel = "Category color", className }: BloomColorPickerProps) {
  const reduceMotion = useReducedMotion();
  const [state, dispatch] = React.useReducer(bloomPickerReducer, INITIAL_BLOOM_PICKER_STATE);
  const { editing, focusIndex, hexDraft, open, shadeT, workingHue } = state;

  const containerRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const petalRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const draggingRef = React.useRef(false);

  const resolvedHex = cssColorToHex(value) ?? "#7c8794";
  const editingHexValid = isValidHex(hexDraft);
  const swatchColor = editing ? (editingHexValid ? (normalizeHex(hexDraft) as string) : resolvedHex) : resolvedHex;
  const previewColor = shadeColor(workingHue, shadeT);

  function updateState(patch: Partial<BloomPickerState>) {
    dispatch({ type: "patch", patch });
  }

  function commit(hex: string) {
    const normalized = normalizeHex(hex);
    if (!normalized) {
      return;
    }
    updateState({ workingHue: normalized });
    onChange(normalized);
  }

  function openBloom() {
    const index = nearestPetalIndex(resolvedHex);
    updateState({
      editing: false,
      focusIndex: index,
      open: true,
      shadeT: 0.5,
      workingHue: resolvedHex
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => petalRefs.current[index]?.focus());
    });
  }

  function closeBloom() {
    updateState({ open: false });
    requestAnimationFrame(() => containerRef.current?.querySelector<HTMLButtonElement>("[data-bloom-swatch]")?.focus());
  }

  function selectPetal(index: number) {
    const petal = PETALS[index];
    if (!petal) {
      return;
    }
    commit(shadeColor(petal.hex, shadeT));
    closeBloom();
  }

  function moveFocus(delta: number) {
    const next = (focusIndex + delta + PETALS.length) % PETALS.length;
    const petal = PETALS[next];

    if (petal) {
      updateState({ focusIndex: next, workingHue: petal.hex });
    } else {
      updateState({ focusIndex: next });
    }

    requestAnimationFrame(() => petalRefs.current[next]?.focus());
  }

  // ── Shade arc drag ─────────────────────────────────────────────────────────
  function pointerToShade(clientX: number, clientY: number) {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const angle = angleForPoint(clientX - rect.left, clientY - rect.top, CX, CY);
    const clampedAngle = Math.min(ARC_END_DEG, Math.max(ARC_START_DEG, angle));
    updateState({ shadeT: tForArcAngle(clampedAngle) });
  }

  React.useEffect(() => {
    if (!open) {
      return;
    }

    function onMove(event: PointerEvent) {
      if (!draggingRef.current) {
        return;
      }
      event.preventDefault();
      pointerToShade(event.clientX, event.clientY);
    }

    function onUp() {
      draggingRef.current = false;
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [open]);

  // Close on outside click / Escape.
  React.useEffect(() => {
    if (!open) {
      return;
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeBloom();
      }
    }

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  // ── Hex editing ──────────────────────────────────────────────────────────
  function startHexEdit() {
    updateState({ editing: true, hexDraft: resolvedHex, open: false });
  }

  function commitHexEdit() {
    if (editingHexValid) {
      commit(hexDraft);
    }
    updateState({ editing: false });
  }

  function cancelHexEdit() {
    updateState({ editing: false, hexDraft: "" });
  }

  const arcTop = arcPoint(0, ARC_RADIUS, CX, CY);
  const arcTail = arcPoint(1, ARC_RADIUS, CX, CY);
  const knobPoint = arcPoint(shadeT, ARC_RADIUS, CX, CY);
  const arcPath = `M ${arcTop.x} ${arcTop.y} A ${ARC_RADIUS} ${ARC_RADIUS} 0 0 1 ${arcTail.x} ${arcTail.y}`;

  return (
    <LazyMotion features={domAnimation} strict>
      <div className={cn("relative inline-flex", className)} ref={containerRef}>
        <div className="flex items-center gap-2">
          <button
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={ariaLabel}
            className="relative size-11 shrink-0 rounded-full border border-border/70 shadow-sm transition-transform outline-none [@media(hover:hover)_and_(pointer:fine)]:hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none sm:size-10"
            data-bloom-swatch=""
            onClick={() => (open ? closeBloom() : openBloom())}
            style={{
              backgroundColor: swatchColor,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${swatchColor} 60%, transparent), 0 1px 3px color-mix(in oklab, ${swatchColor} 40%, transparent)`
            }}
            type="button"
          />

          {editing ? (
            <div className="flex items-center gap-1.5">
              <div className="flex h-11 items-center rounded-full border border-border bg-input/40 pr-1 pl-2.5 focus-within:ring-2 focus-within:ring-ring/50 sm:h-10">
                <span className="text-xs text-muted-foreground">#</span>
                <input
                  aria-invalid={hexDraft.length > 0 && !editingHexValid}
                  aria-label="Hex color value"
                  className="w-[7.5ch] bg-transparent px-1 font-mono text-xs tracking-tight tabular-nums uppercase outline-none placeholder:text-muted-foreground"
                  maxLength={7}
                  onChange={(event) => updateState({ hexDraft: event.target.value.replace(/[^0-9a-fA-F#]/g, "") })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitHexEdit();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelHexEdit();
                    }
                  }}
                  spellCheck={false}
                  value={hexDraft.replace(/^#/, "")}
                />
                <button
                  aria-label="Commit hex color"
                  className="ml-0.5 grid size-11 place-items-center rounded-full bg-foreground text-background transition-opacity outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none sm:size-10"
                  disabled={!editingHexValid}
                  onClick={commitHexEdit}
                  type="button"
                >
                  <Check className="size-3" strokeWidth={2.5} />
                </button>
              </div>
            </div>
          ) : (
            <button
              aria-label={`${ariaLabel}: ${resolvedHex.toUpperCase()}. Edit hex value`}
              className="group inline-flex h-11 items-center gap-1.5 rounded-full border border-border bg-card/60 pr-2 pl-2.5 text-xs transition-colors outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none sm:h-10"
              onClick={startHexEdit}
              type="button"
            >
              <span className="font-mono tracking-tight tabular-nums uppercase">{resolvedHex.toUpperCase()}</span>
              <Pencil className="size-3 text-muted-foreground transition-colors group-hover:text-foreground" />
            </button>
          )}
        </div>

        <AnimatePresence>
          {open ? (
            <BloomPanel
              arcPath={arcPath}
              arcTail={arcTail}
              arcTop={arcTop}
              closeBloom={closeBloom}
              draggingRef={draggingRef}
              focusIndex={focusIndex}
              knobPoint={knobPoint}
              moveFocus={moveFocus}
              panelRef={panelRef}
              petalRefs={petalRefs}
              pointerToShade={pointerToShade}
              previewColor={previewColor}
              reduceMotion={reduceMotion}
              resolvedHex={resolvedHex}
              selectPetal={selectPetal}
              shadeT={shadeT}
              updateState={updateState}
              workingHue={workingHue}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </LazyMotion>
  );
}

function BloomPanel({
  arcPath,
  arcTail,
  arcTop,
  closeBloom,
  draggingRef,
  focusIndex,
  knobPoint,
  moveFocus,
  panelRef,
  petalRefs,
  pointerToShade,
  previewColor,
  reduceMotion,
  resolvedHex,
  selectPetal,
  shadeT,
  updateState,
  workingHue
}: {
  arcPath: string;
  arcTail: { x: number; y: number };
  arcTop: { x: number; y: number };
  closeBloom: () => void;
  draggingRef: React.MutableRefObject<boolean>;
  focusIndex: number;
  knobPoint: { x: number; y: number };
  moveFocus: (delta: number) => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
  petalRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
  pointerToShade: (clientX: number, clientY: number) => void;
  previewColor: string;
  reduceMotion: boolean | null;
  resolvedHex: string;
  selectPetal: (index: number) => void;
  shadeT: number;
  updateState: (patch: Partial<BloomPickerState>) => void;
  workingHue: string;
}) {
  const canHover = useHoverCapable();

  return (
    <>
      <button
        aria-hidden="true"
        className="fixed inset-0 z-40 cursor-default"
        onClick={closeBloom}
        tabIndex={-1}
        type="button"
      />
      <m.div
        animate={{ opacity: 1, y: 0 }}
        aria-label="Bloom color picker"
        className="absolute top-9 left-0 z-50 rounded-3xl border border-border/80 bg-popover/95 p-2 shadow-2xl ring-1 ring-foreground/5 backdrop-blur-xl"
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            moveFocus(1);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            moveFocus(-1);
          }
        }}
        ref={panelRef}
        role="dialog"
        transition={{ duration: 0.16, ease: EASE_SMOOTH_OUT }}
      >
        <div className="relative" style={{ width: PANEL_W, height: PANEL_H }}>
          <m.div
            animate={{ opacity: 1, scale: 1 }}
            className="absolute rounded-full"
            exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.85 }}
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.85 }}
            style={{
              left: CX - PLATE_R,
              top: CY - PLATE_R,
              width: PLATE_R * 2,
              height: PLATE_R * 2,
              background: `radial-gradient(circle at 50% 42%, color-mix(in oklab, ${previewColor} 22%, var(--popover)) 0%, color-mix(in oklab, ${previewColor} 13%, var(--popover)) 70%)`,
              boxShadow: `inset 0 0 0 13px color-mix(in oklab, ${previewColor} 78%, transparent), inset 0 0 26px color-mix(in oklab, ${previewColor} 26%, transparent)`
            }}
            transition={reduceMotion ? { duration: 0.12 } : { type: "spring", stiffness: 380, damping: 26 }}
          />

          <svg aria-hidden="true" className="pointer-events-none absolute inset-0" fill="none" height={PANEL_H} width={PANEL_W}>
            <defs>
              <linearGradient
                gradientUnits="userSpaceOnUse"
                id="bloom-arc-gradient"
                x1={arcTop.x}
                x2={arcTail.x}
                y1={arcTop.y}
                y2={arcTail.y}
              >
                <stop offset="0%" stopColor={shadeColor(workingHue, 0.12)} />
                <stop offset="52%" stopColor={shadeColor(workingHue, 0.5)} />
                <stop offset="100%" stopColor="#050505" />
              </linearGradient>
            </defs>
            <m.path
              animate={{ opacity: 1 }}
              d={arcPath}
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              stroke="color-mix(in oklab, var(--popover) 55%, black)"
              strokeLinecap="round"
              strokeWidth={18}
              transition={{ duration: 0.2 }}
            />
            <m.path
              animate={{ opacity: 1 }}
              d={arcPath}
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              stroke="url(#bloom-arc-gradient)"
              strokeLinecap="round"
              strokeWidth={14}
              transition={{ duration: 0.24 }}
            />
          </svg>

          <button
            aria-label="Shade"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round((1 - shadeT) * 100)}
            className="absolute z-20 rounded-full border-2 border-white bg-white/95 shadow-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" || event.key === "ArrowRight") {
                event.preventDefault();
                updateState({ shadeT: Math.max(0, shadeT - 0.05) });
              } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
                event.preventDefault();
                updateState({ shadeT: Math.min(1, shadeT + 0.05) });
              }
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              draggingRef.current = true;
              pointerToShade(event.clientX, event.clientY);
            }}
            role="slider"
            style={{
              left: knobPoint.x - ARC_KNOB / 2,
              top: knobPoint.y - ARC_KNOB / 2,
              width: ARC_KNOB,
              height: ARC_KNOB,
              backgroundColor: previewColor
            }}
            type="button"
          />

          <div className="absolute inset-0" role="listbox" aria-label="Petal hues">
            {PETALS.map((petal) => {
              const dx = CX - petal.centerX;
              const dy = CY - petal.centerY;
              return (
                <m.button
                  animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, x: 0, y: 0, rotate: 0 }}
                  aria-label={`Hue ${petal.hex}`}
                  aria-selected={focusIndex === petal.index}
                  className="absolute rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent"
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0, x: dx, y: dy }}
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0, x: dx, y: dy, rotate: -24 }}
                  key={petal.hex}
                  onClick={() => selectPetal(petal.index)}
                  onFocus={() => updateState({ focusIndex: petal.index })}
                  onMouseEnter={() => updateState({ workingHue: petal.hex })}
                  ref={(node) => {
                    petalRefs.current[petal.index] = node;
                  }}
                  role="option"
                  style={{
                    left: petal.left,
                    top: petal.top,
                    width: petal.size,
                    height: petal.size,
                    backgroundColor: petal.hex,
                    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${petal.hex} 55%, black), 0 2px 8px color-mix(in oklab, ${petal.hex} 50%, transparent), 0 0 18px color-mix(in oklab, ${petal.hex} 28%, transparent)`
                  }}
                  tabIndex={focusIndex === petal.index ? 0 : -1}
                  transition={reduceMotion ? { duration: 0.12 } : { ...PETAL_SPRING, delay: petal.index * 0.018 }}
                  type="button"
                  whileHover={reduceMotion || !canHover ? undefined : { scale: 1.14 }}
                />
              );
            })}

            <m.button
              animate={{ opacity: 1, scale: 1 }}
              aria-label="Keep current color and close"
              className="absolute z-10 grid place-items-center rounded-full border border-border bg-white text-[10px] shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
              exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.6 }}
              initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.6 }}
              onClick={closeBloom}
              style={{
                left: CX - CENTER_KNOB / 2,
                top: CY - CENTER_KNOB / 2,
                width: CENTER_KNOB,
                height: CENTER_KNOB
              }}
              transition={reduceMotion ? { duration: 0.12 } : { type: "spring", stiffness: 420, damping: 22, delay: 0.04 }}
              type="button"
            >
              <span className="block size-3 rounded-full" style={{ backgroundColor: resolvedHex }} />
            </m.button>
          </div>
        </div>
      </m.div>
    </>
  );
}
