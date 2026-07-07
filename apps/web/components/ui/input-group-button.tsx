"use client"

import * as React from "react"
import type { VariantProps } from "class-variance-authority"

import { inputGroupButtonVariants } from "@/components/ui/input-group-variants"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> &
  VariantProps<typeof inputGroupButtonVariants> & {
    type?: "button" | "submit" | "reset"
  }) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

export { InputGroupButton }
