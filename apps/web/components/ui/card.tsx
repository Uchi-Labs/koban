import * as React from "react"

import { ManekiMoment } from "@/components/maneki-moment"
import { cn } from "@/lib/utils"

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-[min(var(--radius-4xl),24px)] bg-card py-(--card-spacing) text-sm text-card-foreground shadow-sm ring-1 ring-foreground/5 [--card-spacing:--spacing(5)] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(4)] dark:ring-foreground/10 *:[img:first-child]:rounded-t-[min(var(--radius-4xl),24px)] *:[img:last-child]:rounded-b-[min(var(--radius-4xl),24px)]",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1.5 rounded-t-[min(var(--radius-4xl),24px)] px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-base font-medium", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-[min(var(--radius-4xl),24px)] px-(--card-spacing) [.border-t]:pt-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function EmptyState({
  actions,
  className,
  description,
  icon,
  mascot = false,
  size = "default",
  title,
}: {
  actions?: React.ReactNode
  className?: string
  description?: React.ReactNode
  icon?: React.ReactNode
  /**
   * Opt-in Maneki mascot brand moment, shown in place of the icon badge.
   * Reserved for hand-picked friendly empty states (e.g. goals) — never
   * enable on data-error or sync-failure states.
   */
  mascot?: boolean
  size?: "sm" | "default" | "lg"
  title: React.ReactNode
}) {
  return (
    <div
      data-slot="empty-state"
      data-size={size}
      className={cn(
        "flex w-full flex-col items-center rounded-2xl border border-border bg-muted/25 text-center text-foreground",
        "data-[size=sm]:gap-3 data-[size=sm]:px-6 data-[size=sm]:py-8",
        "data-[size=default]:gap-4 data-[size=default]:px-8 data-[size=default]:py-12",
        "data-[size=lg]:gap-5 data-[size=lg]:px-10 data-[size=lg]:py-16",
        className
      )}
    >
      {mascot ? (
        <ManekiMoment priority size={80} />
      ) : icon ? (
        <div className="flex size-10 items-center justify-center rounded-2xl border border-border bg-background/50 text-primary">
          {icon}
        </div>
      ) : null}
      <div className="t-stagger is-shown grid gap-1.5">
        <h2 className="t-stagger-line t-stagger-line--1 text-base font-semibold">{title}</h2>
        {description ? (
          <p className="t-stagger-line t-stagger-line--2 mx-auto max-w-120 text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  EmptyState,
}
