"use client";

import {
  LazyMotion,
  domAnimation,
  m,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue
} from "motion/react";
import React from "react";
import { oklchToHex } from "@/lib/bloom-color";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { RING_COLOR_DOTS, type RingColorDot, type RingName } from "@/lib/ring-color";
import { cn } from "@/lib/utils";

const OUTER_COUNT = RING_COLOR_DOTS.filter((dot) => dot.ring === "outer").length;
const INNER_START = OUTER_COUNT;
const INNER_COUNT = RING_COLOR_DOTS.filter((dot) => dot.ring === "inner").length;
const CENTER_INDEX = OUTER_COUNT + INNER_COUNT;
const PUSH_SPRING = { damping: 22, mass: 0.6, stiffness: 360 };
const GLOW_SPRING = { damping: 26, mass: 0.7, stiffness: 280 };

interface DotLayout extends RingColorDot {
  angle: number;
  index: number;
  x: number;
  y: number;
}

export interface RingColorPickerProps {
  value?: string;
  onChange: (hex: string) => void;
  size?: number;
  className?: string;
  ariaLabel?: string;
}

function buildLayout(size: number): DotLayout[] {
  const center = size / 2;
  const outerRadius = size * 0.39;
  const innerRadius = size * 0.235;

  return RING_COLOR_DOTS.map((dot, index) => {
    if (dot.ring === "center") {
      return { ...dot, angle: -90, index, x: center, y: center };
    }

    const ringStart = dot.ring === "outer" ? 0 : INNER_START;
    const ringCount = dot.ring === "outer" ? OUTER_COUNT : INNER_COUNT;
    const position = index - ringStart;
    const angle = -90 + position * (360 / ringCount) + (dot.ring === "inner" ? 360 / ringCount / 2 : 0);
    const radians = (angle * Math.PI) / 180;
    const radius = dot.ring === "outer" ? outerRadius : innerRadius;

    return {
      ...dot,
      angle,
      index,
      x: center + Math.cos(radians) * radius,
      y: center + Math.sin(radians) * radius
    };
  });
}

function normalizeValue(value: string | undefined): string {
  if (!value) return "";
  return (/^oklch\(/i.test(value) ? oklchToHex(value) : value)?.toLowerCase() ?? "";
}

function closestIndexInRing(layout: DotLayout[], ring: RingName, angle: number): number {
  let closest = ring === "outer" ? 0 : INNER_START;
  let smallestDelta = Number.POSITIVE_INFINITY;

  for (const dot of layout) {
    if (dot.ring !== ring) continue;
    const rawDelta = Math.abs(dot.angle - angle) % 360;
    const delta = Math.min(rawDelta, 360 - rawDelta);
    if (delta < smallestDelta) {
      closest = dot.index;
      smallestDelta = delta;
    }
  }

  return closest;
}

function nextFocusIndex(layout: DotLayout[], index: number, key: string): number {
  const dot = layout[index];
  if (!dot) return index;

  if (key === "ArrowLeft" || key === "ArrowRight") {
    if (dot.ring === "center") {
      return key === "ArrowLeft" ? INNER_START + INNER_COUNT - 1 : INNER_START;
    }
    const start = dot.ring === "outer" ? 0 : INNER_START;
    const count = dot.ring === "outer" ? OUTER_COUNT : INNER_COUNT;
    const offset = index - start + (key === "ArrowLeft" ? -1 : 1);
    return start + ((offset % count) + count) % count;
  }

  if (key === "ArrowUp") {
    if (dot.ring === "outer") return closestIndexInRing(layout, "inner", dot.angle);
    return CENTER_INDEX;
  }

  if (key === "ArrowDown") {
    if (dot.ring === "center") return INNER_START;
    if (dot.ring === "inner") return closestIndexInRing(layout, "outer", dot.angle);
    return closestIndexInRing(layout, "inner", dot.angle);
  }

  return index;
}

function ColorDot({
  activePointer,
  animateTap,
  canPush,
  dot,
  dotSize,
  focusDot,
  layout,
  onChange,
  pointerX,
  pointerY,
  registerRef,
  selected,
  size
}: {
  activePointer: MotionValue<number>;
  animateTap: boolean;
  canPush: boolean;
  dot: DotLayout;
  dotSize: number;
  focusDot: (index: number) => void;
  layout: DotLayout[];
  onChange: (hex: string) => void;
  pointerX: MotionValue<number>;
  pointerY: MotionValue<number>;
  registerRef: (index: number, node: HTMLButtonElement | null) => void;
  selected: boolean;
  size: number;
}) {
  const pushRadius = size * 0.24;
  const pushStrength = size * 0.055;

  const pushXTarget = useTransform([pointerX, pointerY, activePointer], ([rawX, rawY, rawActive]) => {
    if (!canPush || Number(rawActive) < 0.5) return 0;
    const dx = dot.x - Number(rawX);
    const dy = dot.y - Number(rawY);
    const distance = Math.hypot(dx, dy);
    if (distance >= pushRadius) return 0;
    const force = (1 - distance / pushRadius) ** 2 * pushStrength;
    return (distance > 0 ? dx / distance : Math.cos((dot.angle * Math.PI) / 180)) * force;
  });
  const pushYTarget = useTransform([pointerX, pointerY, activePointer], ([rawX, rawY, rawActive]) => {
    if (!canPush || Number(rawActive) < 0.5) return 0;
    const dx = dot.x - Number(rawX);
    const dy = dot.y - Number(rawY);
    const distance = Math.hypot(dx, dy);
    if (distance >= pushRadius) return 0;
    const force = (1 - distance / pushRadius) ** 2 * pushStrength;
    return (distance > 0 ? dy / distance : Math.sin((dot.angle * Math.PI) / 180)) * force;
  });
  const proximity = useTransform([pointerX, pointerY, activePointer], ([rawX, rawY, rawActive]) => {
    if (!canPush || Number(rawActive) < 0.5) return 0;
    const distance = Math.hypot(dot.x - Number(rawX), dot.y - Number(rawY));
    return Math.max(0, 1 - distance / (size * 0.3));
  });
  const glowOpacityTarget = useTransform(proximity, [0, 1], [0.08, 0.38]);
  const glowScaleTarget = useTransform(proximity, [0, 1], [0.75, 1.45]);
  const pushX = useSpring(pushXTarget, PUSH_SPRING);
  const pushY = useSpring(pushYTarget, PUSH_SPRING);
  const glowOpacity = useSpring(glowOpacityTarget, GLOW_SPRING);
  const glowScale = useSpring(glowScaleTarget, GLOW_SPRING);

  return (
    <m.button
      aria-label={`Use color ${dot.hex}`}
      aria-pressed={selected}
      className={cn(
        "absolute grid place-items-center rounded-full outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "after:absolute after:inset-[-4px] after:rounded-full after:border-2 after:border-white/0 after:transition-colors",
        "hover:after:border-white/40 motion-reduce:transition-none",
        selected && "after:border-white/70"
      )}
      onClick={() => onChange(selected ? "" : dot.hex)}
      onKeyDown={(event) => {
        if (!event.key.startsWith("Arrow")) return;
        event.preventDefault();
        focusDot(nextFocusIndex(layout, dot.index, event.key));
      }}
      ref={(node) => registerRef(dot.index, node)}
      style={{
        backgroundColor: dot.color,
        boxShadow: selected ? `0 0 0 2px var(--background), 0 0 0 4px ${dot.color}` : undefined,
        height: dotSize,
        left: dot.x - dotSize / 2,
        top: dot.y - dotSize / 2,
        width: dotSize,
        x: canPush ? pushX : 0,
        y: canPush ? pushY : 0
      }}
      type="button"
      whileHover={canPush ? { scale: 1.5 } : undefined}
      whileTap={animateTap ? { scale: 1.2 } : undefined}
    >
      <m.span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-3 -z-10 rounded-full blur-md"
        style={{
          background: `radial-gradient(circle, ${dot.color} 0%, transparent 72%)`,
          opacity: canPush ? glowOpacity : 0.08,
          scale: canPush ? glowScale : 0.75
        }}
      />
      {selected ? <span aria-hidden="true" className="size-1.5 rounded-full bg-white shadow-sm" /> : null}
    </m.button>
  );
}

export function RingColorPicker({
  value,
  onChange,
  size = 260,
  className,
  ariaLabel = "Category color"
}: RingColorPickerProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const hoverCapable = useHoverCapable();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const dotRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const pointerX = useMotionValue(size / 2);
  const pointerY = useMotionValue(size / 2);
  const activePointer = useMotionValue(0);
  const layout = React.useMemo(() => buildLayout(size), [size]);
  const selectedValue = normalizeValue(value);
  const dotSize = Math.max(16, Math.round(size * 0.077));
  const canPush = hoverCapable && !reduceMotion;

  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !canPush) {
      activePointer.set(0);
      return;
    }

    const updatePointer = (event: PointerEvent) => {
      const bounds = panel.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      pointerX.set(x);
      pointerY.set(y);
      const insideCircle =
        Math.hypot(x - bounds.width / 2, y - bounds.height / 2)
        <= Math.min(bounds.width, bounds.height) / 2;
      activePointer.set(insideCircle ? 1 : 0);
    };
    const handlePointerLeave = () => activePointer.set(0);

    panel.addEventListener("pointermove", updatePointer);
    panel.addEventListener("pointerenter", updatePointer);
    panel.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      panel.removeEventListener("pointermove", updatePointer);
      panel.removeEventListener("pointerenter", updatePointer);
      panel.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [activePointer, canPush, pointerX, pointerY]);

  function focusDot(index: number) {
    dotRefs.current[index]?.focus();
  }

  return (
    <div
      aria-label={ariaLabel}
      className={cn("relative isolate shrink-0 touch-manipulation", className)}
      ref={panelRef}
      role="group"
      style={{ height: size, width: size }}
    >
      <LazyMotion features={domAnimation}>
        <div aria-hidden="true" className="absolute inset-[16%] -z-20 rounded-full bg-[radial-gradient(circle,var(--color-ring)_0%,transparent_68%)] opacity-10 blur-2xl [--color-ring:var(--primary)]" />
        {layout.map((dot) => (
          <ColorDot
            activePointer={activePointer}
            animateTap={!reduceMotion}
            canPush={canPush}
            dot={dot}
            dotSize={dot.ring === "center" ? dotSize * 1.12 : dot.ring === "inner" ? dotSize * 0.92 : dotSize}
            focusDot={focusDot}
            key={`${dot.ring}-${dot.index}`}
            layout={layout}
            onChange={onChange}
            pointerX={pointerX}
            pointerY={pointerY}
            registerRef={(index, node) => {
              dotRefs.current[index] = node;
            }}
            selected={selectedValue === dot.hex.toLowerCase()}
            size={size}
          />
        ))}
      </LazyMotion>
    </div>
  );
}
