"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { SPRING_PANEL } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverPortal = PopoverPrimitive.Portal;
export const PopoverPositioner = PopoverPrimitive.Positioner;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverPopup({ className, ...props }: PopoverPrimitive.Popup.Props) {
  const reduce = useReducedMotion();

  return (
    <LazyMotion features={domAnimation}>
      <PopoverPrimitive.Popup
        className={cn(
          "origin-(--transform-origin) transition-[opacity,transform] duration-150 ease-out data-ending-style:-translate-y-1 data-ending-style:scale-95 data-ending-style:opacity-0 motion-reduce:transform-none motion-reduce:transition-none",
          className
        )}
        render={
          <m.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.96, y: -4 }}
            transition={reduce ? { duration: 0 } : SPRING_PANEL}
          />
        }
        {...props}
      />
    </LazyMotion>
  );
}
