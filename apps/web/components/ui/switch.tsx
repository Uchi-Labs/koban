"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react"
import * as React from "react"

import { cn } from "@/lib/utils"
import { SPRING_LAYOUT, SPRING_PRESS } from "@/lib/motion"

function Switch({
  className,
  disabled,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  const reduce = useReducedMotion()
  const [pressed, setPressed] = React.useState(false)
  const squish = pressed && !disabled && !reduce

  return (
    <LazyMotion features={domAnimation}>
      <SwitchPrimitive.Root
        data-slot="switch"
        data-size={size}
        disabled={disabled}
        className={cn(
          "peer group/switch relative inline-flex shrink-0 items-center rounded-2xl border-2 transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-5 data-[size=default]:w-8 data-[size=sm]:h-4 data-[size=sm]:w-6 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:justify-end data-checked:border-primary data-checked:bg-primary data-unchecked:justify-start data-unchecked:border-transparent data-unchecked:bg-input/90 data-disabled:cursor-not-allowed data-disabled:opacity-50",
          className
        )}
        onPointerCancel={(event) => {
          setPressed(false)
          props.onPointerCancel?.(event)
        }}
        onPointerDown={(event) => {
          setPressed(true)
          props.onPointerDown?.(event)
        }}
        onPointerLeave={(event) => {
          setPressed(false)
          props.onPointerLeave?.(event)
        }}
        onPointerUp={(event) => {
          setPressed(false)
          props.onPointerUp?.(event)
        }}
        render={
          <m.span
            transition={SPRING_PRESS}
            whileTap={reduce || disabled ? undefined : { scale: 0.98 }}
          />
        }
        {...props}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className="pointer-events-none block rounded-2xl bg-background shadow-sm ring-0 not-dark:bg-clip-padding group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground"
          render={
            <m.span
              animate={{ scaleX: squish ? 1.12 : 1, scaleY: squish ? 0.92 : 1 }}
              layout
              transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
            />
          }
        />
      </SwitchPrimitive.Root>
    </LazyMotion>
  )
}

export { Switch }
