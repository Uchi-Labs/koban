"use client";

// Base UI flavour of the Fluid Functionalism scroll area
// (https://www.fluidfunctionalism.com/r/base/scroll-area.json). Scrollbar
// machinery adapted from Lina by SameerJS6 (https://lina.sameer.sh); built on
// @base-ui/react/scroll-area, whose scrollbars stay mounted while scrollable
// and expose hover/scroll state as data attributes. Restyled to Koban tokens:
// the thumb rests narrow + low-contrast (foreground/25) and widens + darkens on
// hover (foreground/45). Touch-primary devices fall back to native overflow
// scrolling for real momentum/rubber-banding. The upstream shape-context
// dependency is dropped in favour of a fixed rounded thumb — Koban has no
// pill/rounded shape toggle.

import {
  createContext,
  use,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type Ref
} from "react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "@/lib/utils";
import { useTouchPrimary } from "@/hooks/use-touch-primary";

const ScrollAreaContext = createContext<boolean>(false);

type Orientation = "vertical" | "horizontal" | "both";

interface ScrollAreaProps extends ComponentPropsWithoutRef<"div"> {
  ref?: Ref<ComponentRef<typeof ScrollAreaPrimitive.Root>>;
  viewportClassName?: string;
  /** Which axes get scrollbars. Defaults to `"vertical"`. */
  orientation?: Orientation;
}

function ScrollArea({
  children,
  className,
  orientation = "vertical",
  ref,
  viewportClassName,
  ...props
}: ScrollAreaProps) {
    const isTouch = useTouchPrimary();

    return (
      <ScrollAreaContext.Provider value={isTouch}>
        {isTouch ? (
          <div
            ref={ref}
            role="group"
            data-slot="scroll-area"
            aria-roledescription="scroll area"
            className={cn("relative overflow-hidden", className)}
            {...props}
          >
            <div
              data-slot="scroll-area-viewport"
              className={cn(
                "size-full rounded-[inherit]",
                orientation === "vertical" && "overflow-y-auto",
                orientation === "horizontal" && "overflow-x-auto",
                orientation === "both" && "overflow-auto",
                viewportClassName
              )}
            >
              {children}
            </div>
          </div>
        ) : (
          <ScrollAreaPrimitive.Root
            ref={ref}
            data-slot="scroll-area"
            className={cn("relative overflow-hidden", className)}
            {...props}
          >
            <ScrollAreaPrimitive.Viewport
              data-slot="scroll-area-viewport"
              className={cn("size-full rounded-[inherit]", viewportClassName)}
            >
              <ScrollAreaPrimitive.Content>{children}</ScrollAreaPrimitive.Content>
            </ScrollAreaPrimitive.Viewport>
            {orientation !== "horizontal" && <ScrollBar orientation="vertical" />}
            {orientation !== "vertical" && <ScrollBar orientation="horizontal" />}
            {orientation === "both" && <ScrollAreaPrimitive.Corner />}
          </ScrollAreaPrimitive.Root>
        )}
      </ScrollAreaContext.Provider>
    );
}

ScrollArea.displayName = "ScrollArea";

type ScrollBarProps = ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Scrollbar> & {
  ref?: Ref<ComponentRef<typeof ScrollAreaPrimitive.Scrollbar>>;
};

function ScrollBar({ className, orientation = "vertical", ref, ...props }: ScrollBarProps) {
  const isTouch = use(ScrollAreaContext);

  if (isTouch) {
    return null;
  }

  return (
    <ScrollAreaPrimitive.Scrollbar
      ref={ref}
      orientation={orientation}
      data-slot="scroll-area-scrollbar"
      // Base UI keeps the scrollbar mounted while scrollable; visibility is a
      // plain opacity transition off its hover/scroll state — 160ms in, faster
      // out, waiting out the thumb shrink before the fade so it visibly narrows.
      className={cn(
        "group/scrollbar absolute z-20 flex touch-none select-none",
        "opacity-0 transition-opacity duration-120 ease-[var(--ease-strong-out)] delay-160",
        "data-[hovering]:duration-160 data-[scrolling]:duration-160",
        "data-[hovering]:opacity-100 data-[scrolling]:opacity-100",
        "data-[hovering]:delay-0 data-[scrolling]:delay-0",
        orientation === "vertical" && "top-0 right-0 h-full w-2.5",
        orientation === "horizontal" && "bottom-0 left-0 h-2.5 w-full flex-col",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className={cn(
          "relative rounded-full bg-foreground/25 transition-[background-color,width,height] duration-160 ease-[var(--ease-strong-in-out)]",
          "group-hover/scrollbar:bg-foreground/45 active:!bg-foreground/60",
          orientation === "vertical" &&
            "mx-auto my-1 h-[var(--scroll-area-thumb-height)] w-1 group-hover/scrollbar:w-1.5",
          orientation === "horizontal" &&
            "mx-1 my-auto h-1 w-[var(--scroll-area-thumb-width)] group-hover/scrollbar:h-1.5"
        )}
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

ScrollBar.displayName = "ScrollBar";

export { ScrollArea, ScrollBar };
export type { ScrollAreaProps };
