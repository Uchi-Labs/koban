"use client";

import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
  type Variants
} from "motion/react";
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode
} from "react";
import { SPRING_LAYOUT } from "@/lib/motion";
import { useHoverCapable } from "@/lib/transitions";
import { cn } from "@/lib/utils";

export interface SharedLayoutBgProps {
  children: ReactNode;
  className?: string;
  pillClassName?: string;
  inset?: number;
  as?: "div" | "ul";
  "aria-label"?: string;
  "data-sidebar"?: string;
  "data-slot"?: string;
}

const variants: Variants = {
  animate: { opacity: 1 },
  exit: (isActive: boolean) => (!isActive ? { opacity: 0 } : {}),
  initial: { opacity: 0 }
};

const reducedVariants: Variants = {
  animate: { opacity: 1 },
  exit: (isActive: boolean) => (!isActive ? { opacity: 0 } : {}),
  initial: { opacity: 0 }
};

export function SharedLayoutBg({
  as = "div",
  children,
  className,
  inset = 0,
  pillClassName,
  ...props
}: SharedLayoutBgProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const uid = useId();
  const reduce = useReducedMotion();
  const hoverCapable = useHoverCapable();

  const Root = as === "ul" ? m.ul : m.div;
  const items: ReactElement<{
    className?: string;
    onMouseEnter?: () => void;
    children?: ReactNode;
  }>[] = [];

  Children.forEach(children, (child) => {
    if (isValidElement(child)) {
      items.push(child as ReactElement<{
        className?: string;
        onMouseEnter?: () => void;
        children?: ReactNode;
      }>);
    }
  });

  return (
    <LazyMotion features={domAnimation}>
      <Root
        className={cn("flex w-full flex-col", className)}
        layoutRoot
        onMouseLeave={hoverCapable ? () => setActiveId(null) : undefined}
        {...props}
      >
      {items.map((element, index) => {
          const childKey = element.key ? String(element.key) : `item-${index}`;

          return cloneElement(
            element,
            {
              key: childKey,
              className: cn("relative", element.props.className),
              onMouseEnter: () => {
                element.props.onMouseEnter?.();
                if (hoverCapable) {
                  setActiveId(childKey);
                }
              }
            },
            <>
              <AnimatePresence custom={activeId !== null}>
                {activeId !== null ? (
                  <m.div
                    animate="animate"
                    className="pointer-events-none absolute inset-y-0"
                    custom={activeId !== null}
                    exit="exit"
                    initial="initial"
                    style={{ left: -inset, right: -inset }}
                    variants={reduce ? reducedVariants : variants}
                  >
                    {activeId === childKey ? (
                      <m.div
                        className={cn(
                          "pointer-events-none h-full w-full rounded-xl bg-sidebar-accent/70",
                          pillClassName
                        )}
                        layoutId={`shared-bg-${uid}`}
                        transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                      />
                    ) : null}
                  </m.div>
                ) : null}
              </AnimatePresence>
              <div className="relative z-10">{element.props.children}</div>
            </>
          );
        })}
      </Root>
    </LazyMotion>
  );
}
