"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { LazyMotion, MotionConfig, domAnimation, m, useReducedMotion } from "motion/react"
import * as React from "react"
import type { MouseEvent, PointerEvent } from "react"

import { SPRING_LAYOUT } from "@/lib/motion"
import { cn } from "@/lib/utils"

type TabsValue = TabsPrimitive.Root.Props["value"]

const TabsMotionContext = React.createContext<{
  hydrated: boolean
  layoutId: string
  value: TabsValue
} | null>(null)

const TabsListVariantContext = React.createContext<"default" | "line" | "buttons">("default")
const subscribeHydration = (_onStoreChange: () => void) => () => undefined
const getHydratedSnapshot = () => true
const getServerHydratedSnapshot = () => false

function Tabs({
  className,
  defaultValue,
  onValueChange,
  orientation = "horizontal",
  value,
  ...props
}: TabsPrimitive.Root.Props) {
  const reduce = useReducedMotion()
  const layoutId = React.useId()
  const controlled = value !== undefined
  const hydrated = React.useSyncExternalStore(subscribeHydration, getHydratedSnapshot, getServerHydratedSnapshot)
  const [internalValue, setInternalValue] = React.useState<TabsValue>(defaultValue ?? null)
  const selectedValue = controlled ? value : internalValue
  const motionContextValue = React.useMemo(
    () => ({ hydrated, layoutId, value: selectedValue }),
    [hydrated, layoutId, selectedValue]
  )
  const handleValueChange: TabsPrimitive.Root.Props["onValueChange"] = (nextValue, eventDetails) => {
    if (!controlled) {
      setInternalValue(nextValue)
    }

    onValueChange?.(nextValue, eventDetails)
  }

  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig transition={reduce ? { duration: 0 } : SPRING_LAYOUT}>
        <TabsMotionContext.Provider value={motionContextValue}>
          <TabsPrimitive.Root
            data-slot="tabs"
            data-orientation={orientation}
            className={cn(
              "group/tabs flex gap-2 data-horizontal:flex-col",
              className
            )}
            defaultValue={defaultValue}
            onValueChange={handleValueChange}
            orientation={orientation}
            render={<m.div layoutRoot />}
            value={value}
            {...props}
          />
        </TabsMotionContext.Provider>
      </MotionConfig>
    </LazyMotion>
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-2xl p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:p-1 data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
        buttons: "gap-1.5 bg-transparent p-0 group-data-horizontal/tabs:h-auto",
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
    <TabsListVariantContext.Provider value={variant ?? "default"}>
      <TabsPrimitive.List
        ref={listRef}
        data-slot="tabs-list"
        data-overflowing={isOverflowing ? "" : undefined}
        data-variant={variant}
        className={cn(
          tabsListVariants({ variant }),
          "refined-scrollbar scroll-fade-tabs-list relative max-w-full min-w-0 overflow-x-auto overscroll-x-contain scroll-px-[var(--scroll-fade-width,3rem)] [--scroll-fade-width:3rem]",
          isOverflowing && "cursor-grab active:cursor-grabbing",
          className
        )}
        {...dragProps}
        {...props}
      >
        {children}
      </TabsPrimitive.List>
    </TabsListVariantContext.Provider>
  )
}

function TabsTrigger({ className, disabled, onClick, ...props }: TabsPrimitive.Tab.Props) {
  const motionContext = React.use(TabsMotionContext)
  const listVariant = React.use(TabsListVariantContext)
  const active = motionContext ? Object.is(motionContext.value, props.value) : false
  const hydrated = motionContext?.hydrated ?? true
  const indicatorLayoutId = `${motionContext?.layoutId ?? "tabs"}-${listVariant}`

  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative isolate inline-flex h-[calc(100%-1px)] shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-2xl border border-transparent! px-3 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:px-3 group-data-vertical/tabs:py-0.5 hover:text-foreground focus-visible:ring-[1.5px] focus-visible:ring-ring/45 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "group-data-[variant=buttons]/tabs-list:h-8 group-data-[variant=buttons]/tabs-list:rounded-full group-data-[variant=buttons]/tabs-list:border-border/50! group-data-[variant=buttons]/tabs-list:px-3.5 group-data-[variant=buttons]/tabs-list:hover:bg-muted/40 group-data-[variant=buttons]/tabs-list:data-active:border-border! group-data-[variant=buttons]/tabs-list:data-active:hover:bg-transparent",
        "z-[1] data-active:text-foreground dark:data-active:text-foreground",
        "group-data-[variant=line]/tabs-list:overflow-visible",
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
      disabled={disabled || !hydrated}
      {...props}
    >
      {active && listVariant === "default" ? (
        <m.span
          aria-hidden="true"
          className="absolute inset-0 z-0 rounded-2xl border border-border/60 bg-background shadow-xs"
          data-slot="tabs-indicator"
          layoutId={indicatorLayoutId}
        />
      ) : null}
      {active && listVariant === "buttons" ? (
        <m.span
          aria-hidden="true"
          className="absolute inset-0 z-0 rounded-full bg-muted"
          data-slot="tabs-indicator"
          layoutId={indicatorLayoutId}
        />
      ) : null}
      <span className="relative z-10 inline-flex items-center justify-center gap-1.5">{props.children}</span>
      {active && listVariant === "line" ? (
        <m.span
          aria-hidden="true"
          className="absolute bg-foreground group-data-horizontal/tabs:inset-x-0 group-data-horizontal/tabs:bottom-[-5px] group-data-horizontal/tabs:h-0.5 group-data-vertical/tabs:inset-y-0 group-data-vertical/tabs:-right-1 group-data-vertical/tabs:w-0.5"
          data-slot="tabs-indicator"
          layoutId={indicatorLayoutId}
        />
      ) : null}
    </TabsPrimitive.Tab>
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
