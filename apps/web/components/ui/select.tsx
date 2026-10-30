"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { LazyMotion, domAnimation, m, useReducedMotion, type Variants } from "motion/react"

import { cn } from "@/lib/utils"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"
import { EASE_OUT, SPRING_PANEL, SPRING_PRESS } from "@/lib/motion"

const Select = SelectPrimitive.Root

// No `filter` animations here: animating filter on a top-layer select popup
// makes Chromium composite the panel with inverted colors (white flash that
// sticks). Opacity/scale/translate springs only.
const SELECT_PANEL_VARIANTS: Variants = {
  closed: {
    opacity: 0,
    scale: 0.96,
    y: -4
  },
  open: {
    opacity: 1,
    scale: 1,
    y: 0
  }
}

const SELECT_LIST_VARIANTS: Variants = {
  closed: {},
  open: { transition: { delayChildren: 0.04, staggerChildren: 0.025 } }
}

const SELECT_ITEM_VARIANTS: Variants = {
  closed: { opacity: 0, y: -5 },
  open: { opacity: 1, y: 0 }
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1.5 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  const reduce = useReducedMotion()

  return (
    <LazyMotion features={domAnimation}>
      <SelectPrimitive.Trigger
        data-slot="select-trigger"
        data-size={size}
        className={cn(
          "flex w-fit items-center justify-between gap-1.5 rounded-2xl border border-transparent bg-input/50 px-3 py-2 text-sm whitespace-nowrap transition-[color,box-shadow] duration-200 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
        {...props}
      >
        {children}
        <SelectPrimitive.Icon
          render={
            <m.span
              aria-hidden
              className="pointer-events-none inline-flex size-4 items-center justify-center text-muted-foreground transition-transform data-[popup-open]:rotate-180"
              transition={reduce ? { duration: 0 } : SPRING_PRESS}
            >
              <ChevronDownIcon className="size-4" />
            </m.span>
          }
        />
      </SelectPrimitive.Trigger>
    </LazyMotion>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  // Overlap positioning triggers a Chromium top-layer/filter compositing glitch
  // (popup paints inverted) and clips item text to the trigger width — render
  // below the trigger like a normal menu instead.
  alignItemWithTrigger = false,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  const reduce = useReducedMotion()

  return (
    <LazyMotion features={domAnimation}>
      <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          // flex column + overflow-hidden so the list scrolls INSIDE the rounded
          // box. Both this popup and the list below used to carry the same
          // max-h-(--available-height) while only this one added p-1, so the list
          // could be 8px taller than its parent's content box and the last item
          // spilled past the corner radius. The list now flexes within the
          // remaining space instead of being clamped to the same absolute height.
          className={cn("relative z-50 flex max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) flex-col overflow-hidden rounded-2xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10", className )}
            render={
            <m.div
              animate={reduce ? { opacity: 1, scale: 1, y: 0 } : "open"}
              initial={reduce ? false : "closed"}
              transition={reduce ? { duration: 0 } : SPRING_PANEL}
              variants={reduce ? undefined : SELECT_PANEL_VARIANTS}
            />
          }
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List
            className="refined-scrollbar scroll-fade-y min-h-0 flex-1 overflow-y-auto overscroll-contain"
            render={
              <m.div
                animate="open"
                initial="closed"
                variants={reduce ? undefined : SELECT_LIST_VARIANTS}
              />
            }
          >
            {children}
          </SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </LazyMotion>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-2 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  const reduce = useReducedMotion()

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      render={
        <m.div
          variants={reduce ? undefined : SELECT_ITEM_VARIANTS}
          transition={reduce ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT }}
        />
      }
      className={cn(
        "relative flex min-h-7 w-full cursor-default items-center gap-2 rounded-xl py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
