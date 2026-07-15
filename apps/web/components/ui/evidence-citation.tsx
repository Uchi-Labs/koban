"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import {
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger,
} from "@/components/motion/popover";
import { cn } from "@/lib/utils";

export interface EvidenceCitationProps {
  className?: string;
  description: string;
  href: string;
  index: number;
  linkLabel?: string;
  title: string;
}

/** Click/focus toggletip for a real evidence reference. The visible numbered
 *  marker is 12px; its trigger owns a larger transparent target. */
export function EvidenceCitation({
  className,
  description,
  href,
  index,
  linkLabel = "View evidence",
  title,
}: EvidenceCitationProps) {
  const [open, setOpen] = useState(false);
  const pointerDown = useRef(false);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        nativeButton
        render={
          <button
            aria-label={`Evidence ${index}: ${title}`}
            className={cn(
              "inline-flex size-6 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              className
            )}
            onFocus={() => {
              if (!pointerDown.current) setOpen(true);
            }}
            onPointerCancel={() => {
              pointerDown.current = false;
            }}
            onPointerDown={() => {
              pointerDown.current = true;
            }}
            onPointerUp={() => {
              pointerDown.current = false;
            }}
            type="button"
          >
            <span className="inline-flex size-3 items-center justify-center rounded-full bg-primary text-[8px] leading-none font-semibold text-primary-foreground tabular-nums">
              {index}
            </span>
          </button>
        }
      />
      <PopoverPortal>
        <PopoverPositioner align="start" className="isolate z-50" side="bottom" sideOffset={6}>
          <PopoverPopup className="w-72 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-[var(--ic-shadow-soft)] outline-none">
            <p className="text-sm font-medium">{title}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
            <Link
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              href={href}
            >
              {linkLabel}
              <ArrowUpRight aria-hidden="true" className="size-3" />
            </Link>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
}
