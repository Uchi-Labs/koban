"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import type { VariantProps } from "class-variance-authority"
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react"

import { buttonVariants } from "@/components/ui/button-variants"
import { SPRING_PRESS } from "@/lib/motion"
import { cn } from "@/lib/utils"

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const reduce = useReducedMotion()

  return (
    <LazyMotion features={domAnimation}>
      <ButtonPrimitive
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        render={
          <m.button
            transition={reduce ? { duration: 0 } : SPRING_PRESS}
            whileTap={reduce ? undefined : { scale: 0.97 }}
          />
        }
        {...props}
      />
    </LazyMotion>
  )
}

export { Button }
