"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import type { VariantProps } from "class-variance-authority"
import { animate, useReducedMotion } from "motion/react"
import { useRef, type Ref } from "react"

import { buttonVariants } from "@/components/ui/button-variants"
import { useHoverCapable } from "@/lib/hooks/use-hover-capable"
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
  onPointerEnter,
  onPointerLeave,
  onPointerUp,
  ref,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const reduce = useReducedMotion()
  const canHover = useHoverCapable()
  const buttonRef = useRef<HTMLElement | null>(null)

  function animateScale(scale: number) {
    if (!reduce && buttonRef.current) {
      animate(buttonRef.current, { scale }, SPRING_PRESS)
    }
  }

  const handlePointerDown: ButtonPrimitive.Props["onPointerDown"] = (event) => {
    onPointerDown?.(event)
    if (!event.defaultPrevented) {
      animateScale(0.96)
    }
  }

  const handlePointerUp: ButtonPrimitive.Props["onPointerUp"] = (event) => {
    onPointerUp?.(event)
    animateScale(canHover ? 1.02 : 1)
  }

  const handlePointerCancel: ButtonPrimitive.Props["onPointerCancel"] = (event) => {
    onPointerCancel?.(event)
    animateScale(1)
  }

  const handlePointerLeave: ButtonPrimitive.Props["onPointerLeave"] = (event) => {
    onPointerLeave?.(event)
    animateScale(1)
  }

  const handlePointerEnter: ButtonPrimitive.Props["onPointerEnter"] = (event) => {
    onPointerEnter?.(event)
    if (!event.defaultPrevented && canHover) {
      animateScale(1.02)
    }
  }

  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}
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
