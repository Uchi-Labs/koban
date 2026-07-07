"use client"

import * as React from "react"
import type { VariantProps } from "class-variance-authority"

import { inputGroupAddonVariants } from "@/components/ui/input-group-variants"
import { cn } from "@/lib/utils"

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return
        }
        e.preventDefault()
        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      {...props}
    />
  )
}

export { InputGroupAddon }
