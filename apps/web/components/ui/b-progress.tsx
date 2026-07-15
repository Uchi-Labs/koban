"use client";

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import {
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import * as React from "react";

import { cn } from "@/lib/utils";

const componentThemeClassName =
  "iconiq-theme";

const fillSpring = {
  type: "spring" as const,
  stiffness: 84,
  damping: 18,
  mass: 1.14,
  restDelta: 0.001,
};

const shellSpring = {
  type: "spring" as const,
  stiffness: 260,
  damping: 24,
  mass: 0.78,
};

const indeterminateTransition = {
  duration: 1.55,
  ease: [0.24, 0.04, 0.2, 1] as const,
  repeat: Number.POSITIVE_INFINITY,
};

export type ProgressSize = "sm" | "md" | "lg";
export type ProgressTone = "default" | "brand" | "destructive" | "success";
export type ProgressVariant = "default" | "circular";

const progressTrackSizes: Record<ProgressSize, string> = {
  sm: "h-1.5",
  md: "h-2.5",
  lg: "h-4",
};

const progressRingContainerSizes: Record<ProgressSize, string> = {
  sm: "size-28",
  md: "size-32",
  lg: "size-40",
};

const progressRingLabelSizes: Record<ProgressSize, string> = {
  sm: "text-lg",
  md: "text-xl",
  lg: "text-2xl",
};

const progressIndicatorTones: Record<ProgressTone, string> = {
  default: "bg-foreground",
  brand: "bg-primary",
  destructive: "bg-[var(--negative)]",
  success: "bg-[var(--positive)]",
};

const progressGaugePrimaryColors: Record<ProgressTone, string> = {
  default: "var(--foreground)",
  brand: "var(--primary)",
  destructive: "var(--negative)",
  success: "var(--positive)",
};

const progressGaugeSecondaryColors: Record<ProgressTone, string> = {
  default: "color-mix(in oklab, var(--foreground) 14%, transparent)",
  brand: "color-mix(in oklab, var(--primary) 18%, transparent)",
  destructive: "color-mix(in oklab, var(--negative) 18%, transparent)",
  success: "color-mix(in oklab, var(--positive) 18%, transparent)",
};

const circularGaugeRadius = 45;
const circularGaugeCircumference = 2 * Math.PI * circularGaugeRadius;
const circularGaugePercentPx = circularGaugeCircumference / 100;

export interface ProgressProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "children"> {
  ariaLabel?: string;
  formatValue?: (value: number, percent: number) => string;
  getValueLabel?: (value: number, percent: number) => string;
  headerClassName?: string;
  helper?: string;
  indeterminateLabel?: string;
  indicatorClassName?: string;
  label?: string;
  max?: number;
  min?: number;
  showValue?: boolean;
  size?: ProgressSize;
  tone?: ProgressTone;
  trackClassName?: string;
  value?: number | null;
  variant?: ProgressVariant;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function resolveBounds(min: number, max: number) {
  return {
    min: Math.min(min, max),
    max: Math.max(min, max),
  };
}

function toPercent(value: number, min: number, max: number) {
  const range = max - min;
  if (range <= 0) {
    return value >= max ? 100 : 0;
  }

  return clamp(((value - min) / range) * 100, 0, 100);
}

function normalizeNumericValue(
  value: number | null | undefined,
  bounds: { min: number; max: number }
) {
  if (value === null) {
    return null;
  }

  const numeric = value ?? 0;
  if (!Number.isFinite(numeric)) {
    return bounds.min;
  }

  return clamp(numeric, bounds.min, bounds.max);
}

function resolveDisplayValue(
  actualValue: number,
  percent: number,
  formatValue?: (value: number, percent: number) => string
) {
  if (formatValue) {
    return formatValue(actualValue, percent);
  }

  return `${Math.round(percent)}%`;
}

function resolveAriaValueText(
  actualValue: number | null,
  percent: number,
  indeterminateLabel: string,
  getValueLabel?: (value: number, percent: number) => string,
  formatValue?: (value: number, percent: number) => string
) {
  if (actualValue === null) {
    return indeterminateLabel;
  }

  if (getValueLabel) {
    return getValueLabel(actualValue, percent);
  }

  return resolveDisplayValue(actualValue, percent, formatValue);
}

function ProgressHeader({
  displayValue,
  headerClassName,
  helper,
  helperId,
  label,
  labelId,
  showValue,
}: {
  displayValue: string | MotionValue<string>;
  headerClassName?: string;
  helper?: string;
  helperId: string;
  label?: string;
  labelId: string;
  showValue: boolean;
}) {
  if (!(label || helper || showValue)) {
    return null;
  }

  return (
    <div
      className={cn("flex items-end justify-between gap-4", headerClassName)}
    >
      <div className="space-y-1">
        {label ? (
          <span
            className="font-medium text-[12px] text-foreground/90 tracking-[-0.02em] sm:text-[13px]"
            id={labelId}
          >
            {label}
          </span>
        ) : null}
        {helper ? (
          <p
            className="max-w-xl text-[12px] text-muted-foreground leading-5 sm:text-[13px]"
            id={helperId}
          >
            {helper}
          </p>
        ) : null}
      </div>

      {showValue ? (
        <motion.span
          animate={{ opacity: 1, y: 0 }}
          className="shrink-0 font-medium text-[12px] text-muted-foreground tabular-nums tracking-[-0.02em] sm:text-[13px]"
          transition={shellSpring}
        >
          {displayValue}
        </motion.span>
      ) : null}
    </div>
  );
}

function DeterminateFill({
  fillScale,
  indicatorClassName,
  tone,
}: {
  fillScale: MotionValue<number>;
  indicatorClassName?: string;
  tone: ProgressTone;
}) {
  return (
    <ProgressPrimitive.Indicator
      render={(props) => (
        <motion.div
          className={cn(
            "absolute inset-y-0 left-0 h-full w-full origin-left rounded-full will-change-transform",
            progressIndicatorTones[tone],
            indicatorClassName,
            props.className
          )}
          ref={props.ref}
          style={{ ...props.style, width: "100%", scaleX: fillScale }}
        />
      )}
    />
  );
}

function IndeterminateFill({ reduceMotion, tone }: { reduceMotion: boolean; tone: ProgressTone }) {
  const toneClassName =
    tone === "default"
      ? "[--progress-indeterminate-core:color-mix(in_oklab,var(--foreground)_20%,transparent)] [--progress-indeterminate-soft:color-mix(in_oklab,var(--foreground)_9%,transparent)]"
      : tone === "brand"
        ? "[--progress-indeterminate-core:color-mix(in_oklab,var(--primary)_72%,transparent)] [--progress-indeterminate-soft:color-mix(in_oklab,var(--primary)_36%,transparent)]"
        : tone === "destructive"
          ? "[--progress-indeterminate-core:color-mix(in_oklab,var(--negative)_72%,transparent)] [--progress-indeterminate-soft:color-mix(in_oklab,var(--negative)_36%,transparent)]"
          : "[--progress-indeterminate-core:color-mix(in_oklab,var(--positive)_72%,transparent)] [--progress-indeterminate-soft:color-mix(in_oklab,var(--positive)_36%,transparent)]";

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden rounded-full">
      <motion.div
        animate={reduceMotion ? { opacity: 0.82, scaleX: 1, x: "82%" } : {
          opacity: [0, 0.92, 0.92, 0],
          scaleX: [0.94, 1, 0.96],
          x: ["-44%", "238%"],
        }}
        className={cn(
          "absolute inset-y-0 left-0 w-[38%] rounded-full",
          toneClassName
        )}
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, var(--progress-indeterminate-soft) 16%, var(--progress-indeterminate-core) 50%, var(--progress-indeterminate-soft) 84%, transparent 100%)",
        }}
        transition={reduceMotion ? { duration: 0 } : {
          ...indeterminateTransition,
          times: [0, 0.14, 0.84, 1],
        }}
      />
    </div>
  );
}

function CircularCenterValue({
  currentPercent,
  displayValue,
  size,
}: {
  currentPercent: number;
  displayValue: string | MotionValue<string>;
  size: ProgressSize;
}) {
  const className = cn(
    "pointer-events-none absolute inset-0 m-auto flex size-fit max-w-[78%] items-center justify-center truncate text-center font-semibold tabular-nums",
    progressRingLabelSizes[size]
  );

  if (typeof displayValue === "string") {
    return (
      <span className={className} data-current-value={currentPercent}>
        {displayValue}
      </span>
    );
  }

  return (
    <motion.span className={className} data-current-value={currentPercent}>
      {displayValue}
    </motion.span>
  );
}

function CircularProgressVisual({
  clampedValue,
  currentPercent,
  displayValue,
  indeterminateLabel,
  indicatorClassName,
  showValue,
  size,
  tone,
  trackClassName,
  reduceMotion,
}: {
  clampedValue: number | null;
  currentPercent: number;
  displayValue: string | MotionValue<string>;
  indeterminateLabel: string;
  indicatorClassName?: string;
  showValue: boolean;
  size: ProgressSize;
  tone: ProgressTone;
  trackClassName?: string;
  reduceMotion: boolean;
}) {
  const gaugePrimaryColor = progressGaugePrimaryColors[tone];
  const gaugeSecondaryColor = progressGaugeSecondaryColors[tone];
  const gaugeStyle = {
    "--circle-size": "100px",
    "--circumference": circularGaugeCircumference,
    "--percent-to-px": `${circularGaugePercentPx}px`,
    "--gap-percent": "5",
    "--offset-factor": "0",
    "--transition-length": reduceMotion ? "0s" : "1s",
    "--transition-step": "200ms",
    "--delay": "0s",
    "--percent-to-deg": "3.6deg",
    transform: "translateZ(0)",
  } as React.CSSProperties;

  if (clampedValue === null) {
    return (
      <div
        className={cn(
          "relative shrink-0 font-semibold",
          progressRingContainerSizes[size],
          trackClassName
        )}
        style={gaugeStyle}
      >
        <motion.svg
          animate={reduceMotion ? undefined : { rotate: 360 }}
          aria-hidden
          className="size-full"
          fill="none"
          transition={reduceMotion ? { duration: 0 } : {
            duration: 1.15,
            ease: "linear",
            repeat: Number.POSITIVE_INFINITY,
          }}
          viewBox="0 0 100 100"
        >
          <circle
            cx="50"
            cy="50"
            fill="none"
            r={circularGaugeRadius}
            stroke={gaugeSecondaryColor}
            strokeWidth="10"
          />
          <circle
            className={indicatorClassName}
            cx="50"
            cy="50"
            fill="none"
            r={circularGaugeRadius}
            stroke={gaugePrimaryColor}
            strokeDasharray={`${circularGaugeCircumference * 0.28} ${circularGaugeCircumference * 0.72}`}
            strokeLinecap="round"
            strokeWidth="10"
          />
        </motion.svg>
        {showValue ? (
          <CircularCenterValue
            currentPercent={0}
            displayValue={indeterminateLabel}
            size={size}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative shrink-0 font-semibold",
        progressRingContainerSizes[size],
        trackClassName
      )}
      style={gaugeStyle}
    >
      <svg
        aria-hidden
        className="size-full"
        fill="none"
        strokeWidth="2"
        viewBox="0 0 100 100"
      >
        {currentPercent <= 90 && currentPercent >= 0 ? (
          <circle
            className="opacity-100"
            cx="50"
            cy="50"
            fill="none"
            r={circularGaugeRadius}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="10"
            style={
              {
                stroke: gaugeSecondaryColor,
                "--stroke-percent": 90 - currentPercent,
                "--offset-factor-secondary": "calc(1 - var(--offset-factor))",
                strokeDasharray:
                  "calc(var(--stroke-percent) * var(--percent-to-px)) var(--circumference)",
                transform:
                  "rotate(calc(1turn - 90deg - (var(--gap-percent) * var(--percent-to-deg) * var(--offset-factor-secondary)))) scaleY(-1)",
                transition: "all var(--transition-length) ease var(--delay)",
                transformOrigin:
                  "calc(var(--circle-size) / 2) calc(var(--circle-size) / 2)",
              } as React.CSSProperties
            }
          />
        ) : null}
        <circle
          className={cn("opacity-100", indicatorClassName)}
          cx="50"
          cy="50"
          fill="none"
          r={circularGaugeRadius}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="10"
          style={
            {
              stroke: gaugePrimaryColor,
              "--stroke-percent": currentPercent,
              strokeDasharray:
                "calc(var(--stroke-percent) * var(--percent-to-px)) var(--circumference)",
              transition:
                "var(--transition-length) ease var(--delay),stroke var(--transition-length) ease var(--delay)",
              transitionProperty: "stroke-dasharray,transform",
              transform:
                "rotate(calc(-90deg + var(--gap-percent) * var(--offset-factor) * var(--percent-to-deg)))",
              transformOrigin:
                "calc(var(--circle-size) / 2) calc(var(--circle-size) / 2)",
            } as React.CSSProperties
          }
        />
      </svg>
      {showValue ? (
        <CircularCenterValue
          currentPercent={currentPercent}
          displayValue={displayValue}
          size={size}
        />
      ) : null}
    </div>
  );
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  function Progress(
    {
      ariaLabel,
      className,
      formatValue,
      getValueLabel,
      headerClassName,
      helper,
      id,
      indeterminateLabel = "In progress",
      indicatorClassName,
      label,
      max = 100,
      min = 0,
      showValue = true,
      size = "md",
      tone = "default",
      trackClassName,
      value = 0,
      variant = "default",
      ...props
    },
    ref
  ) {
    const labelId = React.useId();
    const helperId = React.useId();
    const reduceMotion = useReducedMotion() ?? false;
    const isCircular = variant === "circular";
    const bounds = resolveBounds(min, max);
    const clampedValue = normalizeNumericValue(value, bounds);
    const progress =
      clampedValue === null
        ? 0
        : toPercent(clampedValue, bounds.min, bounds.max);
    const progressTargetMV = useMotionValue(progress);
    const smoothProgressMV = useSpring(progressTargetMV, fillSpring);
    const formatValueRef = React.useRef(formatValue);
    formatValueRef.current = formatValue;
    const fillScale = useTransform(smoothProgressMV, (currentProgress) => {
      return currentProgress / 100;
    });
    const displayValue = useTransform(smoothProgressMV, (currentProgress) => {
      const actualValue =
        bounds.min + ((bounds.max - bounds.min) * currentProgress) / 100;

      return resolveDisplayValue(
        actualValue,
        currentProgress,
        formatValueRef.current
      );
    });
    const hasInitializedMotion = React.useRef(false);

    React.useEffect(() => {
      if (clampedValue === null || reduceMotion) {
        progressTargetMV.jump(progress);
        smoothProgressMV.jump(progress);
        hasInitializedMotion.current = true;
        return;
      }

      if (!hasInitializedMotion.current) {
        progressTargetMV.jump(progress);
        smoothProgressMV.jump(progress);
        hasInitializedMotion.current = true;
        return;
      }

      progressTargetMV.set(progress);
    }, [clampedValue, progress, progressTargetMV, reduceMotion, smoothProgressMV]);

    const renderedValue =
      clampedValue === null ? indeterminateLabel : displayValue;
    const currentPercent = clamp(Math.round(progress), 0, 100);
    const circularCenterValue =
      clampedValue === null
        ? indeterminateLabel
        : formatValue
          ? renderedValue
          : String(currentPercent);

    return (
      <div
        className={cn(
          componentThemeClassName,
          isCircular
            ? "inline-flex w-auto flex-col items-center gap-3"
            : "w-full space-y-3",
          className
        )}
        id={id}
        ref={ref}
        {...props}
      >
        <ProgressHeader
          displayValue={renderedValue}
          headerClassName={cn(isCircular && "w-full min-w-0", headerClassName)}
          helper={helper}
          helperId={helperId}
          label={label}
          labelId={labelId}
          showValue={showValue && !isCircular}
        />

        <ProgressPrimitive.Root
          aria-describedby={helper ? helperId : undefined}
          aria-label={ariaLabel ?? (label ? undefined : "Progress")}
          aria-labelledby={label ? labelId : undefined}
          className={cn(isCircular && "inline-flex shrink-0")}
          getAriaValueText={(_, actualValue) => {
            const currentPercentValue =
              actualValue === null
                ? 0
                : clamp(
                    Math.round(toPercent(actualValue, bounds.min, bounds.max)),
                    0,
                    100
                  );
            return resolveAriaValueText(
              actualValue,
              currentPercentValue,
              indeterminateLabel,
              getValueLabel,
              formatValue
            );
          }}
          max={bounds.max}
          min={bounds.min}
          value={clampedValue}
        >
          {isCircular ? (
            <CircularProgressVisual
              clampedValue={clampedValue}
              currentPercent={currentPercent}
              displayValue={circularCenterValue}
              indeterminateLabel={indeterminateLabel}
              indicatorClassName={indicatorClassName}
              showValue={showValue}
              size={size}
              tone={tone}
              trackClassName={trackClassName}
              reduceMotion={reduceMotion}
            />
          ) : (
            <ProgressPrimitive.Track
              className={cn(
                "relative overflow-hidden rounded-full bg-foreground/8 dark:bg-white/[0.08]",
                progressTrackSizes[size],
                trackClassName
              )}
            >
              {clampedValue === null ? (
                <IndeterminateFill reduceMotion={reduceMotion} tone={tone} />
              ) : (
                <DeterminateFill
                  fillScale={fillScale}
                  indicatorClassName={indicatorClassName}
                  tone={tone}
                />
              )}
            </ProgressPrimitive.Track>
          )}
        </ProgressPrimitive.Root>
      </div>
    );
  }
);

Progress.displayName = "Progress";

export { Progress as progress };
