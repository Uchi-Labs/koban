"use client";

import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  type PanInfo,
  useDragControls,
  useReducedMotion
} from "motion/react";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { EASE_DRAWER, SPRING_PANEL } from "@/lib/motion";
import { cn } from "@/lib/utils";

const OVERLAY_TRANSITION = { duration: 0.2, ease: EASE_DRAWER } as const;
const DEFAULT_SNAP_POINTS: Array<number | "auto"> = [0.58, 0.92];

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapPoints?: (number | "auto")[];
  defaultSnap?: number;
  title?: string;
  description?: string;
  children?: ReactNode;
  className?: string;
  dismissThreshold?: number;
}

export function BottomSheet({
  children,
  className,
  defaultSnap = 0,
  description,
  dismissThreshold = 120,
  onOpenChange,
  open,
  snapPoints = DEFAULT_SNAP_POINTS,
  title
}: BottomSheetProps) {
  const [snap, setSnap] = useState(defaultSnap);
  const [settleVelocity, setSettleVelocity] = useState(0);
  const [snapReset, setSnapReset] = useState({ defaultSnap, open });
  const dragControls = useDragControls();
  const sheetRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const reduce = useReducedMotion();
  const mounted = useSyncExternalStore(emptySubscribe, getClientMountedSnapshot, getServerMountedSnapshot);

  if (snapReset.defaultSnap !== defaultSnap || snapReset.open !== open) {
    setSnapReset({ defaultSnap, open });
    if (open) {
      setSnap(defaultSnap);
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const body = document.body;
    const scrollY = window.scrollY;
    const previous = {
      left: body.style.left,
      overflow: body.style.overflow,
      position: body.style.position,
      right: body.style.right,
      top: body.style.top
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.overflow = "hidden";

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const activeElement = document.activeElement;
    openerRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const sheet = sheetRef.current;
      const firstFocusable = sheet?.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      (firstFocusable ?? sheet)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      const opener = openerRef.current;
      if (opener?.isConnected) {
        window.requestAnimationFrame(() => opener.focus());
      }
    };
  }, [open]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const velocity = info.velocity.y;
    const offset = info.offset.y;
    setSettleVelocity(velocity);

    if (velocity > 600 || offset > dismissThreshold) {
      const smallerSnap = snap > 0 ? snap - 1 : null;

      if (smallerSnap !== null && velocity < 800 && offset < dismissThreshold * 1.6) {
        setSnap(smallerSnap);
      } else {
        onOpenChange(false);
      }

      return;
    }

    if (velocity < -500) {
      setSnap((current) => Math.min(snapPoints.length - 1, current + 1));
      return;
    }

    if (offset > 80 && snap > 0) {
      setSnap((current) => Math.max(0, current - 1));
    } else if (offset < -80 && snap < snapPoints.length - 1) {
      setSnap((current) => Math.min(snapPoints.length - 1, current + 1));
    }
  };

  const snapValue = snapPoints[snap];
  const heightStyle = snapValue === "auto" ? { maxHeight: "92vh" } : { height: `${snapValue * 100}vh` };

  if (!mounted) {
    return null;
  }

  return createPortal(
    <LazyMotion features={domAnimation}>
      <AnimatePresence>
        {open ? (
          <div className="pointer-events-none fixed inset-0 z-50">
          <m.div
            animate={{ opacity: 1 }}
            className="pointer-events-auto absolute inset-0 bg-background/40 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={() => onOpenChange(false)}
            transition={reduce ? { duration: 0.18, ease: EASE_DRAWER } : OVERLAY_TRANSITION}
          />
          <m.div
            animate={reduce ? { opacity: 1, y: 0 } : { y: 0 }}
            className={cn(
              "pointer-events-auto absolute right-0 bottom-0 left-0 mx-auto flex max-w-2xl flex-col overflow-hidden rounded-t-3xl will-change-transform",
              "border border-border bg-card/95 shadow-xl backdrop-blur-md",
              className
            )}
            drag="y"
            dragConstraints={{ bottom: 0, top: 0 }}
            dragControls={dragControls}
            dragElastic={{ bottom: 0.4, top: 0.02 }}
            dragListener={false}
            dragMomentum={false}
            exit={reduce ? { opacity: 0, y: 0 } : { y: "100%" }}
            initial={reduce ? { opacity: 0, y: 0 } : { y: "100%" }}
            onDragEnd={onDragEnd}
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            style={heightStyle}
            tabIndex={-1}
            transition={reduce ? { duration: 0.18, ease: EASE_DRAWER } : { ...SPRING_PANEL, velocity: settleVelocity }}
          >
            <div
              className="flex cursor-grab touch-none flex-col items-center px-4 pt-3 pb-2 active:cursor-grabbing"
              onPointerDown={(event) => dragControls.start(event)}
            >
              <div className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
              {title || description ? (
                <div className="mt-3 w-full">
                  {title ? <h2 className="text-base font-semibold text-foreground">{title}</h2> : null}
                  {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
                </div>
              ) : null}
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">{children}</div>
          </m.div>
          </div>
        ) : null}
      </AnimatePresence>
    </LazyMotion>,
    document.body
  );
}

function emptySubscribe() {
  return () => {};
}

function getClientMountedSnapshot() {
  return true;
}

function getServerMountedSnapshot() {
  return false;
}
