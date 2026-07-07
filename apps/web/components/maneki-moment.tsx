"use client";

import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/**
 * Maneki — the Koban mascot moment. A restrained brand beat for the login card
 * and a small set of hand-picked empty states (goals, login). Renders the
 * transparent full-cat master render at a modest size with a gentle idle bob.
 *
 * Motion is transform/opacity only (never filter — filter animations trip a
 * known top-layer Chromium glitch in this app) and is fully suppressed under
 * prefers-reduced-motion.
 */

const manekiSrc = "/icons/koban-1024-transparent.png";

interface ManekiMomentProps {
  /** Optional visible caption rendered beneath the mascot. */
  caption?: string;
  className?: string;
  /** Rendered square size in pixels. */
  size?: number;
  /** Load eagerly (use for above-the-fold login brand moment). */
  priority?: boolean;
}

export function ManekiMoment({ caption, className, size = 72, priority = false }: ManekiMomentProps) {
  const reduce = useReducedMotion();
  const mounted = useSyncExternalStore(emptySubscribe, getClientMountedSnapshot, getServerMountedSnapshot);
  const animate = mounted && !reduce;

  return (
    <div className={cn("flex flex-col items-center gap-2 text-center", className)}>
      <LazyMotion features={domAnimation}>
        <m.div
          animate={animate ? { y: [0, -3, 0] } : undefined}
          aria-hidden="true"
          className="relative select-none"
          style={{ height: size, width: size }}
          transition={
            animate
              ? { duration: 3.2, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY, repeatType: "loop" }
              : undefined
          }
        >
          <Image
            alt=""
            className="object-contain"
            draggable={false}
            fill
            priority={priority}
            sizes={`${size}px`}
            src={manekiSrc}
          />
        </m.div>
      </LazyMotion>
      {caption ? <p className="max-w-56 text-xs text-muted-foreground">{caption}</p> : null}
    </div>
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
