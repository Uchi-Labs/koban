"use client";

import {
  animate,
  LazyMotion,
  domAnimation,
  m,
  useMotionValue,
  useReducedMotion,
  type PanInfo
} from "motion/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { getSwipeReleaseSide, type SwipeSide } from "@/lib/swipe-release";
import { cn } from "@/lib/utils";

export interface SwipeAction {
  id: string;
  label: ReactNode;
  icon: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning" | "danger";
  disabled?: boolean;
  onClick?: () => void;
}

const ROW_SETTLE = {
  damping: 48,
  mass: 0.82,
  restDelta: 0.5,
  restSpeed: 8,
  stiffness: 560,
  type: "spring"
} as const;

const RELEASE_VELOCITY_LIMIT = 1500;
const EMPTY_ACTIONS: SwipeAction[] = [];

const ACTION_TONE_CLASS = {
  danger: "text-destructive",
  neutral: "text-muted-foreground group-hover:text-foreground",
  primary: "text-primary",
  success: "text-positive",
  warning: "text-warning"
};

function clampReleaseVelocity(velocity: number) {
  return Math.max(-RELEASE_VELOCITY_LIMIT, Math.min(RELEASE_VELOCITY_LIMIT, velocity));
}

export function useCoarsePointer() {
  return useSyncExternalStore(subscribeCoarsePointer, getCoarsePointerSnapshot, getServerCoarsePointerSnapshot);
}

function subscribeCoarsePointer(onStoreChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => {};
  }

  const media = window.matchMedia("(pointer: coarse)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function getCoarsePointerSnapshot() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

function getServerCoarsePointerSnapshot() {
  return false;
}

export interface SwipeableRowProps {
  children: ReactNode;
  leftActions?: SwipeAction[];
  rightActions?: SwipeAction[];
  actionWidth?: number;
  revealThreshold?: number;
  className?: string;
  surfaceClassName?: string;
}

export function SwipeableRow({
  actionWidth = 58,
  children,
  className,
  leftActions = EMPTY_ACTIONS,
  revealThreshold = 34,
  rightActions = EMPTY_ACTIONS,
  surfaceClassName
}: SwipeableRowProps) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const animationRef = useRef<{ stop: () => void } | null>(null);
  const [openSide, setOpenSide] = useState<SwipeSide | null>(null);
  const leftWidth = leftActions.length * actionWidth;
  const rightWidth = rightActions.length * actionWidth;

  const settleX = useCallback(
    (nextX: number, velocity = 0) => {
      animationRef.current?.stop();

      if (reduce) {
        x.set(nextX);
        return;
      }

      animationRef.current = animate(x, nextX, {
        ...ROW_SETTLE,
        onComplete: () => x.set(nextX),
        velocity: clampReleaseVelocity(velocity)
      });
    },
    [reduce, x]
  );

  useEffect(() => () => animationRef.current?.stop(), []);

  const getTargetX = useCallback(
    (side: SwipeSide | null) => (side === "left" ? leftWidth : side === "right" ? -rightWidth : 0),
    [leftWidth, rightWidth]
  );

  const snapTo = useCallback(
    (side: SwipeSide | null, velocity = 0) => {
      setOpenSide(side);
      settleX(getTargetX(side), velocity);
    },
    [getTargetX, settleX]
  );

  const onDragEnd = useCallback(
    (_: PointerEvent, info: PanInfo) => {
      const nextSide = getSwipeReleaseSide({
        latestX: x.get(),
        leftWidth,
        openSide,
        revealThreshold,
        rightWidth,
        velocityX: info.velocity.x
      });
      snapTo(nextSide, info.velocity.x);
    },
    [leftWidth, openSide, revealThreshold, rightWidth, snapTo, x]
  );

  const handleAction = (action: SwipeAction) => {
    action.onClick?.();
    snapTo(null);
  };

  return (
    <div className={cn("relative isolate overflow-hidden bg-muted/60", className)}>
      <div aria-hidden={!openSide} className="absolute inset-0 z-0 flex overflow-hidden">
        <div className="flex h-full overflow-hidden">
          {leftActions.map((action) => (
            <SwipeActionButton
              action={action}
              actionWidth={actionWidth}
              focusable={openSide === "left"}
              key={action.id}
              onAction={handleAction}
            />
          ))}
        </div>
        <div className="ml-auto flex h-full overflow-hidden">
          {rightActions.map((action) => (
            <SwipeActionButton
              action={action}
              actionWidth={actionWidth}
              focusable={openSide === "right"}
              key={action.id}
              onAction={handleAction}
            />
          ))}
        </div>
      </div>
      <LazyMotion features={domAnimation}>
        <m.div
          className={cn("relative z-10 cursor-grab touch-pan-y select-none active:cursor-grabbing", surfaceClassName)}
          drag="x"
          dragConstraints={{ left: -rightWidth, right: leftWidth }}
          dragElastic={0.18}
          dragMomentum={false}
          onDragStart={() => animationRef.current?.stop()}
          onDragEnd={onDragEnd}
          style={{ x }}
        >
          {children}
        </m.div>
      </LazyMotion>
    </div>
  );
}

function SwipeActionButton({
  action,
  actionWidth,
  focusable,
  onAction
}: {
  action: SwipeAction;
  actionWidth: number;
  focusable: boolean;
  onAction: (action: SwipeAction) => void;
}) {
  return (
    <button
      aria-label={typeof action.label === "string" ? action.label : undefined}
      className={cn(
        "group flex h-full shrink-0 items-center justify-center outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50"
      )}
      disabled={action.disabled}
      onClick={() => onAction(action)}
      style={{ width: actionWidth }}
      tabIndex={focusable ? 0 : -1}
      type="button"
    >
      <span
        className={cn(
          "grid h-9 w-9 place-items-center rounded-full transition-[background-color,color,transform] duration-150 group-hover:bg-background group-active:scale-95",
          ACTION_TONE_CLASS[action.tone ?? "neutral"]
        )}
      >
        {action.icon}
      </span>
      <span className="sr-only">{action.label}</span>
    </button>
  );
}
