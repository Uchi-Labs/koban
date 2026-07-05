"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"
import type { MouseEvent, PointerEvent } from "react"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-2xl p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:p-1 data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  const { ref: listRef, isOverflowing } = useOverflowDetect()
  const dragProps = useHorizontalDragScroll(listRef, isOverflowing)

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      data-overflowing={isOverflowing ? "" : undefined}
      data-variant={variant}
      className={cn(
        tabsListVariants({ variant }),
        "scroll-fade-tabs-list relative max-w-full min-w-0 overflow-x-auto overscroll-x-contain scroll-px-[var(--scroll-fade-width,3rem)] [--scroll-fade-width:3rem]",
        isOverflowing && "cursor-grab active:cursor-grabbing",
        className
      )}
      {...dragProps}
      {...props}
    >
      {children}
      {variant === "default" ? <TabsIndicator /> : null}
    </TabsPrimitive.List>
  )
}

/* Sliding active pill — tracks the selected tab via Base UI's indicator vars. */
function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cn(
        "absolute top-1/2 left-0 z-0 h-(--active-tab-height) w-(--active-tab-width) -translate-y-1/2 translate-x-(--active-tab-left) rounded-2xl border border-input bg-input/30 transition-[width,translate] duration-(--duration-fast,250ms) ease-(--ease-smooth-out,ease-out)",
        "motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, onClick, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-2xl border border-transparent! px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:px-3 group-data-vertical/tabs:py-0.5 hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "z-[1] data-active:text-foreground dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      onClick={(event) => {
        onClick?.(event)
        event.currentTarget.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "nearest",
          inline: "nearest",
        })
      }}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

function useOverflowDetect() {
  const ref = React.useRef<HTMLDivElement>(null)
  const [isOverflowing, setIsOverflowing] = React.useState(false)

  React.useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const checkOverflow = () => {
      setIsOverflowing(element.scrollWidth > element.clientWidth + 1)
    }

    checkOverflow()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", checkOverflow)
      return () => window.removeEventListener("resize", checkOverflow)
    }

    const resizeObserver = new ResizeObserver(checkOverflow)
    resizeObserver.observe(element)
    window.addEventListener("resize", checkOverflow)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", checkOverflow)
    }
  }, [])

  return { ref, isOverflowing }
}

function useHorizontalDragScroll(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean
) {
  const dragState = React.useRef<{
    dragging: boolean
    pointerId: number
    scrollLeft: number
    startX: number
  } | null>(null)
  const suppressClick = React.useRef(false)

  return {
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (!suppressClick.current) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      suppressClick.current = false
    },
    onPointerCancelCapture: (event: PointerEvent<HTMLElement>) => {
      const element = ref.current
      const state = dragState.current
      if (!element || !state || state.pointerId !== event.pointerId) {
        return
      }

      dragState.current = null
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId)
      }
    },
    onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
      const element = ref.current
      if (!element || !enabled || event.pointerType !== "mouse" || event.button !== 0) {
        return
      }

      dragState.current = {
        dragging: false,
        pointerId: event.pointerId,
        scrollLeft: element.scrollLeft,
        startX: event.clientX,
      }
      suppressClick.current = false
    },
    onPointerMoveCapture: (event: PointerEvent<HTMLElement>) => {
      const element = ref.current
      const state = dragState.current
      if (!element || !enabled || !state || state.pointerId !== event.pointerId) {
        return
      }

      const movementX = event.clientX - state.startX
      if (!state.dragging) {
        if (Math.abs(movementX) <= 3) {
          return
        }
        state.dragging = true
        suppressClick.current = true
        element.setPointerCapture(event.pointerId)
      }

      event.preventDefault()
      element.scrollLeft = state.scrollLeft - movementX
    },
    onPointerUpCapture: (event: PointerEvent<HTMLElement>) => {
      const element = ref.current
      const state = dragState.current
      if (!element || !state || state.pointerId !== event.pointerId) {
        return
      }

      dragState.current = null
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId)
      }
      if (suppressClick.current) {
        window.setTimeout(() => {
          suppressClick.current = false
        }, 0)
      }
    },
  }
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
