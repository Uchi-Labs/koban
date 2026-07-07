"use client";

import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { EASE_IN_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type LoaderVariant =
  | "spinner"
  | "dots"
  | "bars"
  | "dot-matrix"
  | "dither"
  | "ascii-line"
  | "morph"
  | "percent";

export interface LoaderProps {
  variant?: LoaderVariant;
  size?: number;
  speed?: number;
  label?: string;
  className?: string;
}

const ASCII_LINE_FRAMES = ["|", "/", "-", "\\"];

const REDUCED = {
  animate: { opacity: [1, 0.4, 1] },
  transition: { duration: 1.4, ease: EASE_IN_OUT, repeat: Infinity }
};

export function Loader({
  className,
  label = "Loading",
  size = 20,
  speed = 1,
  variant = "spinner"
}: LoaderProps) {
  const reduce = useReducedMotion() ?? false;

  return (
    <LazyMotion features={domAnimation}>
      <span
        aria-label={label}
        className={cn("inline-flex items-center justify-center text-current", className)}
        role="status"
      >
        {variant === "spinner" ? <Spinner reduce={reduce} size={size} speed={speed} /> : null}
        {variant === "dots" ? <Dots reduce={reduce} size={size} speed={speed} /> : null}
        {variant === "bars" ? <Bars reduce={reduce} size={size} speed={speed} /> : null}
        {variant === "dot-matrix" ? <DotMatrix reduce={reduce} size={size} speed={speed} /> : null}
        {variant === "dither" ? <Dither reduce={reduce} size={size} speed={speed} /> : null}
        {variant === "ascii-line" ? (
          <Ascii frames={ASCII_LINE_FRAMES} reduce={reduce} size={size} speed={speed} />
        ) : null}
        {variant === "morph" ? <Morph reduce={reduce} size={size} speed={speed} /> : null}
        {variant === "percent" ? <Percent reduce={reduce} size={size} speed={speed} /> : null}
        <span className="sr-only">{label}</span>
      </span>
    </LazyMotion>
  );
}

interface PartProps {
  size: number;
  speed: number;
  reduce: boolean;
}

function Spinner({ reduce, size, speed }: PartProps) {
  const stroke = Math.max(2, size * 0.09);
  const radius = (size - stroke) / 2;

  return (
    <m.svg
      animate={reduce ? REDUCED.animate : { rotate: 360 }}
      height={size}
      transition={reduce ? REDUCED.transition : { duration: speed, ease: "linear", repeat: Infinity }}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={stroke}
      />
      <path
        d={`M ${size / 2} ${size / 2 - radius} A ${radius} ${radius} 0 0 1 ${size / 2 + radius} ${size / 2}`}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={stroke}
      />
    </m.svg>
  );
}

function Dots({ reduce, size, speed }: PartProps) {
  const dot = size * 0.24;

  return (
    <span className="flex items-center" style={{ gap: size * 0.14 }}>
      {[0, 1, 2].map((index) => (
        <m.span
          animate={
            reduce
              ? { opacity: [0.4, 1, 0.4] }
              : { opacity: [0.5, 1, 0.5], y: [0, -size * 0.3, 0] }
          }
          className="rounded-full bg-current"
          key={index}
          style={{ height: dot, width: dot }}
          transition={{
            delay: index * speed * 0.16,
            duration: speed,
            ease: EASE_IN_OUT,
            repeat: Infinity
          }}
        />
      ))}
    </span>
  );
}

function Bars({ reduce, size, speed }: PartProps) {
  const bar = size * 0.16;

  return (
    <span className="flex items-center" style={{ gap: size * 0.1, height: size }}>
      {[0, 1, 2, 3].map((index) => (
        <m.span
          animate={reduce ? { opacity: [0.4, 1, 0.4] } : { scaleY: [0.3, 1, 0.3] }}
          className="rounded-full bg-current"
          key={index}
          style={{ height: size, originY: 1, width: bar }}
          transition={{
            delay: index * speed * 0.12,
            duration: speed,
            ease: EASE_IN_OUT,
            repeat: Infinity
          }}
        />
      ))}
    </span>
  );
}

const DOT_MATRIX_CELLS = Array.from({ length: 9 }, (_, index) => ({
  key: `${index % 3}-${Math.floor(index / 3)}`,
  x: index % 3,
  y: Math.floor(index / 3)
}));

function DotMatrix({ reduce, size, speed }: PartProps) {
  const count = 3;
  const gap = size * 0.14;
  const dot = (size - gap * (count - 1)) / count;

  return (
    <span className="grid" style={{ gap, gridTemplateColumns: `repeat(${count}, ${dot}px)` }}>
      {DOT_MATRIX_CELLS.map(({ key, x, y }) => {
        const delay = ((x + y) / (2 * (count - 1))) * speed;

        return (
          <m.span
            animate={
              reduce
                ? { opacity: [0.3, 1, 0.3] }
                : { opacity: [0.2, 1, 0.2], scale: [0.7, 1, 0.7] }
            }
            className="rounded-full bg-current"
            key={key}
            style={{ height: dot, width: dot }}
            transition={{ delay, duration: speed, ease: EASE_IN_OUT, repeat: Infinity }}
          />
        );
      })}
    </span>
  );
}

const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function Dither({ reduce, size, speed }: PartProps) {
  const count = 4;
  const gap = Math.max(1, size * 0.05);
  const cell = (size - gap * (count - 1)) / count;

  return (
    <span className="grid" style={{ gap, gridTemplateColumns: `repeat(${count}, ${cell}px)` }}>
      {BAYER_4.map((order, index) => (
        <m.span
          animate={reduce ? { opacity: [0.3, 1, 0.3] } : { opacity: [0.1, 1, 0.1] }}
          className="bg-current"
          key={index}
          style={{ height: cell, width: cell }}
          transition={{
            delay: (order / BAYER_4.length) * speed,
            duration: speed,
            ease: EASE_IN_OUT,
            repeat: Infinity
          }}
        />
      ))}
    </span>
  );
}

function Ascii({
  frames,
  reduce,
  size,
  speed
}: PartProps & { frames: string[] }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const step = ((reduce ? speed * 2.5 : speed) / frames.length) * 1000;
    const id = window.setInterval(() => setFrame((current) => (current + 1) % frames.length), step);
    return () => window.clearInterval(id);
  }, [frames.length, reduce, speed]);

  return (
    <span className="font-mono leading-none tabular-nums" style={{ fontSize: size, lineHeight: 1 }}>
      {frames[frame % frames.length]}
    </span>
  );
}

const MORPH_POINTS = 24;

function ngonRadius(angle: number, sides: number, phase = 0) {
  const segment = (2 * Math.PI) / sides;
  const local = ((((angle - phase) % segment) + segment) % segment) - segment / 2;
  return Math.cos(Math.PI / sides) / Math.cos(local);
}

function morphPath(radiusAt: (angle: number) => number) {
  const parts: string[] = [];

  for (let index = 0; index < MORPH_POINTS; index += 1) {
    const angle = (index / MORPH_POINTS) * 2 * Math.PI - Math.PI / 2;
    const radius = Math.min(1.05, radiusAt(angle));
    const x = (50 + Math.cos(angle) * 46 * radius).toFixed(2);
    const y = (50 + Math.sin(angle) * 46 * radius).toFixed(2);
    parts.push(`${index === 0 ? "M" : "L"}${x} ${y}`);
  }

  return `${parts.join(" ")} Z`;
}

const MORPH_PATHS = [
  morphPath(() => 1),
  morphPath((angle) => ngonRadius(angle, 4, Math.PI / 4)),
  morphPath((angle) => ngonRadius(angle, 3)),
  morphPath((angle) => ngonRadius(angle, 6)),
  morphPath((angle) => ngonRadius(angle, 4))
];

const MORPH_SEQ = [...MORPH_PATHS.flatMap((path) => [path, path]), MORPH_PATHS[0]];
const MORPH_ROT = [0, 0, 72, 72, 144, 144, 216, 216, 288, 288, 360];
const MORPH_SCALE = [1, 1, 0.88, 0.88, 1, 1, 0.88, 0.88, 1, 1, 1];

function Morph({ reduce, size, speed }: PartProps) {
  const titleId = useId();

  return (
    <svg aria-labelledby={titleId} height={size} role="img" viewBox="0 0 100 100" width={size}>
      <title id={titleId}>Loading</title>
      <m.path
        animate={
          reduce
            ? { opacity: [1, 0.4, 1] }
            : { d: MORPH_SEQ, rotate: MORPH_ROT, scale: MORPH_SCALE }
        }
        d={MORPH_PATHS[0]}
        fill="currentColor"
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        transition={
          reduce
            ? { duration: 1.4, ease: EASE_IN_OUT, repeat: Infinity }
            : { duration: speed * 5, ease: EASE_IN_OUT, repeat: Infinity }
        }
      />
    </svg>
  );
}

function Percent({ reduce, size, speed }: PartProps) {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    const duration = (reduce ? speed * 2 : speed) * 1000;
    let elapsed = 0;
    const id = window.setInterval(() => {
      elapsed += 40;
      const next = Math.min(100, Math.round((elapsed / duration) * 100));
      setPercent(next);
      if (next >= 100) {
        elapsed = 0;
      }
    }, 40);
    return () => window.clearInterval(id);
  }, [reduce, speed]);

  return (
    <span className="flex flex-col items-center" style={{ gap: size * 0.14, width: size * 1.4 }}>
      <span className="font-mono font-medium tabular-nums" style={{ fontSize: size * 0.42, lineHeight: 1 }}>
        {percent}%
      </span>
      <span className="w-full overflow-hidden rounded-full bg-current/15" style={{ height: Math.max(3, size * 0.1) }}>
        <span className="block h-full rounded-full bg-current" style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}
