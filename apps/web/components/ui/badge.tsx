import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeBaseClasses =
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-2xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow] motion-reduce:transition-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!"

const badgeVariants = cva(
  badgeBaseClasses,
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        "over-budget":
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40",
        "under-budget":
          "bg-(--positive)/10 text-(--positive) focus-visible:ring-(--positive)/25",
        income:
          "bg-(--positive)/10 text-(--positive) focus-visible:ring-(--positive)/25",
        recurring:
          "border-border bg-transparent text-muted-foreground ring-1 ring-border/70",
        review:
          "bg-warning/12 text-warning focus-visible:ring-warning/25",
        synced:
          "bg-primary/10 text-primary focus-visible:ring-primary/25",
        pending:
          "bg-muted text-muted-foreground ring-1 ring-border/70",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const badgeDotColorClasses = {
  current: "bg-current",
  info: "bg-primary",
  muted: "bg-muted-foreground",
  negative: "bg-(--negative)",
  positive: "bg-(--positive)",
  warning: "bg-warning",
} as const

type BadgeDotColor = keyof typeof badgeDotColorClasses
type BadgeAppearance = "filled" | "dot"

function Badge({
  appearance = "filled",
  children,
  className,
  dotColor = "muted",
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    appearance?: BadgeAppearance
    dotColor?: BadgeDotColor
  }) {
  const resolvedChildren =
    appearance === "dot" ? (
      <>
        <span
          aria-hidden="true"
          className={cn("size-[0.4375rem] shrink-0 rounded-full", badgeDotColorClasses[dotColor])}
        />
        {children}
      </>
    ) : (
      children
    )

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(
          appearance === "dot"
            ? cn(badgeBaseClasses, "gap-1.5 border-border bg-transparent text-muted-foreground ring-1 ring-border/70")
            : badgeVariants({ variant }),
          className
        ),
        children: resolvedChildren,
      },
      props
    ),
    render,
    state: {
      appearance,
      slot: "badge",
      variant,
    },
  })
}

export { Badge }
