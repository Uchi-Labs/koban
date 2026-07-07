"use client"

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { LazyMotion, domAnimation, m, useReducedMotion, type Variants } from "motion/react"

import { cn } from "@/lib/utils"
import { EASE_OUT, SPRING_PANEL } from "@/lib/motion"

const tooltipOffsetBySide: Record<string, { x?: number; y?: number }> = {
  bottom: { y: -10 },
  left: { x: 10 },
  right: { x: -10 },
  top: { y: 10 },
}

const REDUCED_TOOLTIP_VARIANTS: Variants = {
  animate: { opacity: 1, transition: { duration: 0.14, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.1, ease: EASE_OUT } },
  initial: { opacity: 0 },
}

function buildTooltipVariants(side: string): Variants {
  const offset = tooltipOffsetBySide[side] ?? tooltipOffsetBySide.top

  return {
    animate: {
      opacity: 1,
      scale: 1,
      transition: {
        ...SPRING_PANEL,
        opacity: { duration: 0.22, ease: EASE_OUT },
      },
      x: 0,
      y: 0,
    },
    exit: {
      opacity: 0,
      scale: 0.92,
      transition: { duration: 0.14, ease: EASE_OUT },
      x: (offset.x ?? 0) * 0.6,
      y: (offset.y ?? 0) * 0.6,
    },
    initial: {
      opacity: 0,
      scale: 0.85,
      x: offset.x ?? 0,
      y: offset.y ?? 0,
    },
  }
}

function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  const reduce = useReducedMotion()

  return (
    <LazyMotion features={domAnimation}>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          align={align}
          alignOffset={alignOffset}
          side={side}
          sideOffset={sideOffset}
          className="isolate z-50"
        >
          <TooltipPrimitive.Popup
            data-slot="tooltip-content"
            className={cn(
              "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-xl bg-foreground px-3 py-1.5 text-xs text-background will-change-[opacity,transform] has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-lg",
              className
            )}
            render={(popupProps, state) => {
              const variants = reduce ? REDUCED_TOOLTIP_VARIANTS : buildTooltipVariants(state.side)
              const {
                onAnimationEnd: _onAnimationEnd,
                onAnimationEndCapture: _onAnimationEndCapture,
                onAnimationIteration: _onAnimationIteration,
                onAnimationIterationCapture: _onAnimationIterationCapture,
                onAnimationStart: _onAnimationStart,
                onAnimationStartCapture: _onAnimationStartCapture,
                onDrag: _onDrag,
                onDragCapture: _onDragCapture,
                onDragEnd: _onDragEnd,
                onDragEndCapture: _onDragEndCapture,
                onDragEnter: _onDragEnter,
                onDragEnterCapture: _onDragEnterCapture,
                onDragExit: _onDragExit,
                onDragExitCapture: _onDragExitCapture,
                onDragLeave: _onDragLeave,
                onDragLeaveCapture: _onDragLeaveCapture,
                onDragOver: _onDragOver,
                onDragOverCapture: _onDragOverCapture,
                onDragStart: _onDragStart,
                onDragStartCapture: _onDragStartCapture,
                onDrop: _onDrop,
                onDropCapture: _onDropCapture,
                ...motionProps
              } = popupProps

              return (
                <m.div
                  {...motionProps}
                  animate={state.transitionStatus === "ending" ? "exit" : "animate"}
                  initial="initial"
                  variants={variants}
                />
              )
            }}
            {...props}
          >
            {children}
            <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:translate-x-[1.5px] data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:translate-x-[-1.5px] data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:translate-x-[-1.5px] data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:translate-x-[1.5px] data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </LazyMotion>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
