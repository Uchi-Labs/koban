"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const BLOB_COUNT = 6;
const ORBIT_RADIUS = 15;
const BLOB_SIZE = 34;
const SCALE_AMPLITUDE = 0.05;
const RADIUS_AMPLITUDE = 5;
const SPEED = 1.6; // radians/sec
// Deterministic per-blob personality, derived from the phase itself.
const VARIATION = { radius: 1.5, scaleAmplitude: 0.012, size: 0.05 };
const TAIL = [
  { angle: Math.PI * 0.78, dist: 34, size: 12 },
  { angle: Math.PI * 0.72, dist: 46, size: 7 }
];

/*
 * Organic "thinking" cloud: circles on a circumference with compound motion
 * (scale + radial drift), phases evenly distributed with (i / count) * 2π so
 * the sum of blob states stays constant — the cloud breathes without changing
 * its footprint.
 */
export function ThinkingCloud({ className }: { className?: string }) {
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const blobs = Array.from(group.querySelectorAll<HTMLElement>("[data-blob]"));
    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const t = ((now - start) / 1000) * SPEED;

      for (const [index, blob] of blobs.entries()) {
        const phase = (index / BLOB_COUNT) * Math.PI * 2;
        const wave = Math.sin(t + phase);
        const scale = 1 + wave * (SCALE_AMPLITUDE + Math.sin(phase * 3) * VARIATION.scaleAmplitude);
        const radius = ORBIT_RADIUS + wave * (RADIUS_AMPLITUDE + Math.cos(phase * 2) * VARIATION.radius);
        const x = Math.cos(phase) * radius;
        const y = Math.sin(phase) * radius * 0.62; // clouds are wider than tall

        blob.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div aria-hidden="true" className={cn("relative size-24", className)} ref={groupRef}>
      {Array.from({ length: BLOB_COUNT }, (_, index) => {
        const phase = (index / BLOB_COUNT) * Math.PI * 2;
        const size = BLOB_SIZE * (1 + Math.sin(phase * 5) * VARIATION.size);

        return (
          <span
            className="absolute top-1/2 left-1/2 rounded-full bg-primary/70 blur-[6px]"
            data-blob=""
            key={index}
            style={{ height: size, width: size }}
          />
        );
      })}
      {TAIL.map((piece, index) => (
        <span
          className="absolute top-1/2 left-1/2 animate-pulse rounded-full bg-primary/50 blur-[3px]"
          key={`tail-${index}`}
          style={{
            animationDelay: `${index * 400}ms`,
            height: piece.size,
            transform: `translate(-50%, -50%) translate(${Math.cos(piece.angle) * piece.dist}px, ${Math.sin(piece.angle) * piece.dist}px)`,
            width: piece.size
          }}
        />
      ))}
    </div>
  );
}
