"use client";

import {
  type CSSProperties,
  forwardRef,
  type HTMLAttributes,
  useLayoutEffect,
} from "react";

import { cn } from "@/lib/utils";

const componentThemeClassName = "iconiq-theme";

const STYLE_ID = "iconiq-skeleton-styles";

const SKELETON_CSS = `
@keyframes iconiq-skeleton-shimmer {
  to {
    transform: translateX(200%);
  }
}

@keyframes iconiq-skeleton-fade {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.38;
  }
}

.iconiq-skeleton-surface {
  background-color: var(--ic-muted);
}

.iconiq-skeleton-shimmer {
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, var(--ic-foreground) 6%, transparent) 50%,
    transparent 100%
  );
  animation: iconiq-skeleton-shimmer var(--iconiq-skeleton-duration, 1.6s)
    ease-in-out infinite;
}

.iconiq-skeleton-fade-root {
  animation: iconiq-skeleton-fade var(--iconiq-skeleton-duration, 2.4s)
    ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .iconiq-skeleton-shimmer,
  .iconiq-skeleton-fade-root {
    animation: none;
  }
}
`;

type SkeletonRounded = "none" | "sm" | "md" | "lg" | "full";
type SkeletonVariant = "shimmer" | "fade";

const skeletonRoundedClasses = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
} as const satisfies Record<SkeletonRounded, string>;

const skeletonVariantDefaultDuration: Record<SkeletonVariant, number> = {
  shimmer: 1.6,
  fade: 2.4,
};

function getSkeletonVariantDuration(variant: SkeletonVariant, duration = 1.6) {
  if (duration !== 1.6) {
    return duration;
  }

  return skeletonVariantDefaultDuration[variant];
}

function ensureSkeletonStyles() {
  if (typeof document === "undefined") {
    return;
  }

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;

  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }

  style.textContent = SKELETON_CSS;
}

function resolveSkeletonA11yProps({
  animate = true,
  decorative = true,
  label,
}: {
  animate?: boolean;
  decorative?: boolean;
  label?: string | null;
}) {
  if (decorative || label === null) {
    return { "aria-hidden": true as const };
  }

  return {
    "aria-label": label ?? (animate ? "Loading" : "Placeholder"),
    "aria-live": "polite" as const,
    role: "status" as const,
  };
}

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  animate?: boolean;
  decorative?: boolean;
  duration?: number;
  label?: string | null;
  rounded?: SkeletonRounded;
  variant?: SkeletonVariant;
}

const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  {
    animate = true,
    className,
    decorative = true,
    duration = 1.6,
    label,
    rounded = "md",
    style,
    variant = "shimmer",
    ...props
  },
  ref
) {
  const variantDuration = getSkeletonVariantDuration(variant, duration);
  const showShimmer = animate && variant === "shimmer";
  const showFade = animate && variant === "fade";

  useLayoutEffect(() => {
    if (animate) {
      ensureSkeletonStyles();
    }
  }, [animate]);

  const animatedStyle =
    showShimmer || showFade
      ? ({
          ...style,
          "--iconiq-skeleton-duration": `${variantDuration}s`,
        } as CSSProperties)
      : style;

  return (
    <div
      className={cn(
        componentThemeClassName,
        "iconiq-skeleton-surface relative block h-4 w-full overflow-hidden",
        showFade && "iconiq-skeleton-fade-root",
        skeletonRoundedClasses[rounded],
        className
      )}
      ref={ref}
      style={animatedStyle}
      {...resolveSkeletonA11yProps({ animate, decorative, label })}
      {...props}
    >
      {showShimmer ? (
        <span
          aria-hidden="true"
          className="iconiq-skeleton-shimmer pointer-events-none absolute inset-0 -translate-x-full"
        />
      ) : null}
    </div>
  );
});

Skeleton.displayName = "Skeleton";

function SkeletonAvatar({
  className,
  ...props
}: Omit<SkeletonProps, "rounded">) {
  return (
    <Skeleton
      className={cn("size-10", className)}
      decorative
      rounded="full"
      {...props}
    />
  );
}

function SkeletonText({ className, ...props }: SkeletonProps) {
  return <Skeleton className={cn("h-3", className)} decorative {...props} />;
}

function SkeletonButton({
  className,
  ...props
}: Omit<SkeletonProps, "rounded">) {
  return (
    <Skeleton
      className={cn("h-9 w-24", className)}
      decorative
      rounded="lg"
      {...props}
    />
  );
}

const ShimmerSkeleton = Skeleton;

export {
  getSkeletonVariantDuration,
  resolveSkeletonA11yProps,
  Skeleton,
  SkeletonAvatar,
  SkeletonButton,
  SkeletonText,
  ShimmerSkeleton,
  skeletonRoundedClasses,
  skeletonVariantDefaultDuration,
};
export default Skeleton;
export type {
  SkeletonProps,
  SkeletonProps as ShimmerSkeletonProps,
  SkeletonRounded,
  SkeletonVariant,
};
