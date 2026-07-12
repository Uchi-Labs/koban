"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  type ComponentProps,
  type CSSProperties,
  forwardRef,
  type HTMLAttributes,
  useLayoutEffect,
} from "react";

import { cn } from "@/lib/utils";

const componentThemeClassName = "iconiq-theme";

const MotionSpan = motion.create("span");
const MATRIX_STYLE_ID = "iconiq-spinner-matrix-styles";
const MATRIX_GRID = 5;

const MATRIX_CSS = `
@keyframes iconiq-spinner-matrix-wave {
  0%,
  100% {
    opacity: 0.16;
    transform: scale(0.88);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.iconiq-spinner-matrix-dot {
  animation: iconiq-spinner-matrix-wave var(--iconiq-matrix-duration, 2.8s) ease-in-out infinite;
  animation-delay: calc(var(--iconiq-matrix-phase, 0) * var(--iconiq-matrix-duration, 2.8s) * -1);
  background-color: var(--ic-primary);
  transform-origin: center;
}

@media (prefers-reduced-motion: reduce) {
  .iconiq-spinner-matrix-dot {
    animation: none;
    opacity: 0.65;
    transform: none;
  }
}
`;

type SpinnerSize = "sm" | "md" | "lg";
type SpinnerVariant = "ring" | "dots" | "matrix";

const spinnerSizeClasses = {
  sm: {
    root: "size-4",
    border: "border",
    gap: "gap-[18%]",
  },
  md: {
    root: "size-6",
    border: "border-2",
    gap: "gap-[18%]",
  },
  lg: {
    root: "size-8",
    border: "border-2",
    gap: "gap-[18%]",
  },
} as const satisfies Record<
  SpinnerSize,
  { root: string; border: string; gap: string }
>;

const spinnerMatrixConfig = {
  sm: {
    root: "size-6",
    gap: "gap-[10%]",
  },
  md: {
    root: "size-7",
    gap: "gap-[9%]",
  },
  lg: {
    root: "size-9",
    gap: "gap-[10%]",
  },
} as const satisfies Record<SpinnerSize, { root: string; gap: string }>;

const spinnerVariantDuration = {
  ring: 1,
  dots: 0.9,
  matrix: 2.8,
} as const satisfies Record<SpinnerVariant, number>;

function ensureMatrixStyles() {
  if (typeof document === "undefined") {
    return;
  }

  let style = document.getElementById(
    MATRIX_STYLE_ID
  ) as HTMLStyleElement | null;

  if (!style) {
    style = document.createElement("style");
    style.id = MATRIX_STYLE_ID;
    document.head.appendChild(style);
  }

  style.textContent = MATRIX_CSS;
}

function getMatrixGridSize() {
  return MATRIX_GRID;
}

function getMatrixDiagonalPhase(row: number, col: number, gridSize: number) {
  if (gridSize <= 1) {
    return 0;
  }

  return (row + col) / (2 * (gridSize - 1));
}

function buildMatrixCells(gridSize: number) {
  return Array.from({ length: gridSize * gridSize }, (_, index) => {
    const row = Math.floor(index / gridSize);
    const col = index % gridSize;

    return {
      row,
      col,
      index,
      phase: getMatrixDiagonalPhase(row, col, gridSize),
    };
  });
}

function resolveSpinnerA11yProps({
  decorative = false,
}: {
  decorative?: boolean;
}) {
  if (decorative) {
    return { "aria-hidden": true as const };
  }

  return {
    "aria-label": "Loading",
    "aria-live": "polite" as const,
    role: "status" as const,
  };
}

interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  decorative?: boolean;
  size?: SpinnerSize;
  variant?: SpinnerVariant;
}

const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { className, decorative = false, size = "md", variant = "ring", ...props },
  ref
) {
  const reduceMotion = useReducedMotion() === true;
  const sizeClasses = spinnerSizeClasses[size];
  const variantDuration = spinnerVariantDuration[variant];
  const a11yProps = resolveSpinnerA11yProps({ decorative });

  useLayoutEffect(() => {
    if (variant === "matrix") {
      ensureMatrixStyles();
    }
  }, [variant]);

  if (variant === "dots") {
    const dotDelayStep = variantDuration * 0.167;

    return (
      <span
        className={cn(
          componentThemeClassName,
          "inline-flex items-center justify-center",
          sizeClasses.root,
          sizeClasses.gap,
          className
        )}
        ref={ref}
        {...a11yProps}
        {...props}
      >
        {[0, 1, 2].map((index) => (
          <motion.span
            animate={reduceMotion ? undefined : { y: ["0%", "-55%", "0%"] }}
            aria-hidden
            className="aspect-square w-[22%] shrink-0 rounded-full bg-primary"
            key={index}
            transition={reduceMotion ? { duration: 0 } : {
              duration: variantDuration,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeInOut",
              delay: index * dotDelayStep,
            }}
          />
        ))}
      </span>
    );
  }

  if (variant === "matrix") {
    const matrixConfig = spinnerMatrixConfig[size];
    const cells = buildMatrixCells(MATRIX_GRID);

    return (
      <span
        className={cn(
          componentThemeClassName,
          "inline-grid shrink-0 grid-cols-5 place-items-center",
          matrixConfig.root,
          matrixConfig.gap,
          className
        )}
        ref={ref}
        {...a11yProps}
        {...props}
      >
        {cells.map(({ index, phase }) => (
          <span
            aria-hidden
            className="iconiq-spinner-matrix-dot aspect-square w-full rounded-full"
            key={index}
            style={
              {
                "--iconiq-matrix-duration": `${variantDuration}s`,
                "--iconiq-matrix-phase": phase,
              } as CSSProperties
            }
          />
        ))}
      </span>
    );
  }

  return (
    <MotionSpan
      animate={reduceMotion ? undefined : { rotate: 360 }}
      className={cn(
        componentThemeClassName,
        "box-border inline-flex shrink-0 rounded-full border-muted border-t-primary",
        sizeClasses.root,
        sizeClasses.border,
        className
      )}
      ref={ref}
      transition={reduceMotion ? { duration: 0 } : {
        duration: variantDuration,
        repeat: Number.POSITIVE_INFINITY,
        ease: "linear",
      }}
      {...a11yProps}
      {...(props as ComponentProps<typeof MotionSpan>)}
    />
  );
});

Spinner.displayName = "Spinner";

export {
  buildMatrixCells,
  getMatrixDiagonalPhase,
  getMatrixGridSize,
  resolveSpinnerA11yProps,
  Spinner,
  spinnerMatrixConfig,
  spinnerSizeClasses,
  spinnerVariantDuration,
};
export default Spinner;
export type { SpinnerProps, SpinnerSize, SpinnerVariant };
