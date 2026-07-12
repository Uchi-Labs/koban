"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { createContext, useContext, useState } from "react";
import { SPRING_PANEL } from "@/lib/motion";
import { cn } from "@/lib/utils";

const PopoverOpenContext = createContext(false);

export function Popover({ defaultOpen = false, onOpenChange, open: controlledOpen, ...props }: PopoverPrimitive.Root.Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;

  return (
    <PopoverOpenContext.Provider value={open}>
      <PopoverPrimitive.Root
        {...props}
        open={open}
        onOpenChange={(nextOpen, eventDetails) => {
          if (controlledOpen === undefined) {
            setUncontrolledOpen(nextOpen);
          }
          onOpenChange?.(nextOpen, eventDetails);
        }}
      />
    </PopoverOpenContext.Provider>
  );
}

export function PopoverPortal({ keepMounted = true, ...props }: PopoverPrimitive.Portal.Props) {
  return <PopoverPrimitive.Portal keepMounted={keepMounted} {...props} />;
}

export const PopoverPositioner = PopoverPrimitive.Positioner;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverPopup({ className, ...props }: PopoverPrimitive.Popup.Props) {
  const reduce = useReducedMotion();
  const open = useContext(PopoverOpenContext);

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence initial={false}>
      {open ? (
      <PopoverPrimitive.Popup
        className={cn(
          "origin-(--transform-origin)",
          className
        )}
        render={
          <m.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
            initial={reduce ? false : { opacity: 0, scale: 0.96, y: -4 }}
            key="popover-popup"
            transition={reduce ? { duration: 0 } : SPRING_PANEL}
          />
        }
        {...props}
      />
      ) : null}
      </AnimatePresence>
    </LazyMotion>
  );
}
