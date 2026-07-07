"use client";

import {
  AlertTriangle,
  Check,
  Circle,
  Info,
  LoaderCircle,
  X,
  type LucideIcon
} from "lucide-react";
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
  type HTMLMotionProps,
  type Variants
} from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type AnimatedBadgeStatus =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "loading";

export type AnimatedBadgeSize = "sm" | "md";

export interface AnimatedBadgeProps extends Omit<HTMLMotionProps<"span">, "children"> {
  status?: AnimatedBadgeStatus;
  size?: AnimatedBadgeSize;
  children?: ReactNode;
  icon?: ReactNode;
  showIcon?: boolean;
  pulse?: boolean;
  contentKey?: string | number;
}

const STATUS_CLASS: Record<AnimatedBadgeStatus, string> = {
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-primary/30 bg-primary/10 text-primary",
  loading: "border-primary/30 bg-primary/10 text-primary",
  neutral: "border-border bg-card text-muted-foreground",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
};

const SIZE_CLASS: Record<AnimatedBadgeSize, string> = {
  md: "h-8 gap-2 px-3 text-xs",
  sm: "h-6 gap-1.5 px-2 text-[11px]"
};

const ICON_CLASS: Record<AnimatedBadgeSize, string> = {
  md: "h-3.5 w-3.5",
  sm: "h-3 w-3"
};

const ICONS: Record<AnimatedBadgeStatus, LucideIcon> = {
  danger: X,
  info: Info,
  loading: LoaderCircle,
  neutral: Circle,
  success: Check,
  warning: AlertTriangle
};

const ICON_ROLL_VARIANTS: Variants = {
  animate: {
    opacity: 1,
    rotate: 0,
    scale: 1,
    transition: {
      opacity: { duration: 0.28, ease: EASE_OUT },
      rotate: { duration: 0.28, ease: EASE_OUT },
      scale: { damping: 24, mass: 0.75, stiffness: 250, type: "spring" },
      y: { damping: 24, mass: 0.85, stiffness: 210, type: "spring" }
    },
    y: "0%"
  },
  exit: {
    opacity: 0.5,
    rotate: 8,
    scale: 0.96,
    transition: { duration: 0.22, ease: EASE_OUT },
    y: "-80%"
  },
  initial: {
    opacity: 0.72,
    rotate: -8,
    scale: 0.92,
    y: "80%"
  }
};

const TEXT_ROLL_VARIANTS: Variants = {
  animate: {
    opacity: 1,
    transition: {
      opacity: { duration: 0.3, ease: EASE_OUT },
      y: { damping: 24, mass: 0.85, stiffness: 210, type: "spring" }
    },
    y: "0%"
  },
  exit: {
    opacity: 0.5,
    transition: { duration: 0.2, ease: EASE_OUT },
    y: "-85%"
  },
  initial: { opacity: 0.76, y: "85%" }
};

export function AnimatedBadge({
  children,
  className,
  contentKey,
  icon,
  pulse,
  showIcon = true,
  size = "md",
  status = "neutral",
  ...props
}: AnimatedBadgeProps) {
  const reduce = useReducedMotion();
  const Icon = ICONS[status];
  const shouldPulse = pulse ?? status === "loading";
  const resolvedContentKey = contentKey ?? status;

  return (
    <LazyMotion features={domAnimation}>
      <m.span
        className={cn(
          "relative inline-flex shrink-0 items-center overflow-hidden whitespace-nowrap rounded-full border font-medium tabular-nums",
          "transition-colors duration-300",
          STATUS_CLASS[status],
          SIZE_CLASS[size],
          className
        )}
        layout
        transition={{ damping: 30, mass: 0.7, stiffness: 420, type: "spring" }}
        {...props}
      >
        {shouldPulse && !reduce ? (
          <m.span
            animate={{ opacity: [0.08, 0.16, 0.08], scale: [0.94, 1.08, 0.94] }}
            aria-hidden
            className="absolute inset-0 rounded-full bg-current opacity-10"
            transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity }}
          />
        ) : null}
        {showIcon ? (
          <span className="relative z-10 inline-flex items-center justify-center overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
              <m.span
                animate={reduce ? { opacity: 1 } : "animate"}
                aria-hidden
                className="inline-flex will-change-transform"
                data-badge-icon
                exit={reduce ? undefined : "exit"}
                initial={reduce ? false : "initial"}
                key={status}
                variants={ICON_ROLL_VARIANTS}
              >
                {status === "loading" && !reduce && !icon ? (
                  <m.span
                    animate={{ rotate: 360 }}
                    className="inline-flex"
                    transition={{ duration: 1, ease: "linear", repeat: Infinity }}
                  >
                    <Icon className={ICON_CLASS[size]} />
                  </m.span>
                ) : (
                  (icon ?? <Icon className={ICON_CLASS[size]} />)
                )}
              </m.span>
            </AnimatePresence>
          </span>
        ) : null}
        {children != null ? (
          <span className="relative z-10 inline-flex overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
              <m.span
                animate={reduce ? { opacity: 1 } : "animate"}
                className="inline-block will-change-transform"
                data-badge-label
                exit={reduce ? undefined : "exit"}
                initial={reduce ? false : "initial"}
                key={resolvedContentKey}
                variants={TEXT_ROLL_VARIANTS}
              >
                {children}
              </m.span>
            </AnimatePresence>
          </span>
        ) : null}
      </m.span>
    </LazyMotion>
  );
}
