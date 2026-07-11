"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import type { VariantProps } from "class-variance-authority"
import { animate, useReducedMotion } from "motion/react"
import { useRef, type Ref } from "react"

import { buttonVariants } from "@/components/ui/button-variants"
import { SPRING_PRESS } from "@/lib/motion"
import { cn } from "@/lib/utils"

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value)
  } else if (ref) {
    ref.current = value
  }
}

function Button({
  className,
  variant = "default",
  size = "default",
  onPointerCancel,
  onPointerDown,
  onPointerLeave,
  onPointerUp,
  ref,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const reduce = useReducedMotion()
  const buttonRef = useRef<HTMLElement | null>(null)

  function animateScale(scale: number) {
    if (!reduce && buttonRef.current) {
      animate(buttonRef.current, { scale }, SPRING_PRESS)
    }
  }

  const handlePointerDown: ButtonPrimitive.Props["onPointerDown"] = (event) => {
    onPointerDown?.(event)
    if (!event.defaultPrevented) {
      animateScale(0.97)
    }
  }

  const handlePointerUp: ButtonPrimitive.Props["onPointerUp"] = (event) => {
    onPointerUp?.(event)
    animateScale(1)
  }

  const handlePointerCancel: ButtonPrimitive.Props["onPointerCancel"] = (event) => {
    onPointerCancel?.(event)
    animateScale(1)
  }

  const handlePointerLeave: ButtonPrimitive.Props["onPointerLeave"] = (event) => {
    onPointerLeave?.(event)
    animateScale(1)
  }

  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerLeave={handlePointerLeave}
      onPointerUp={handlePointerUp}
      ref={(node) => {
        buttonRef.current = node
        assignRef(ref, node)
      }}
      {...props}
    />
  )
}

export { Button }
