import { cn } from "@/lib/utils"

function Skeleton({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "short" | "long" }) {
  return (
    <div
      data-slot="skeleton"
      data-variant={variant}
      className={cn("rounded-2xl bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
