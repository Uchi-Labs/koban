"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { EASE_OUT, SPRING_PRESS } from "@/lib/motion"

const CHECK_PATH = "M5 13l4 4L19 7"
const INDETERMINATE_PATH = "M6 12h12"

function Checkbox({ className, disabled, ...props }: CheckboxPrimitive.Root.Props) {
  const reduce = useReducedMotion()

  return (
    <LazyMotion features={domAnimation}>
      <CheckboxPrimitive.Root
        data-slot="checkbox"
        disabled={disabled}
        className={cn(
          "peer relative flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-transparent bg-input/90 transition-shadow outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary",
          className
        )}
        render={
          <m.span
            transition={SPRING_PRESS}
            whileTap={reduce || disabled ? undefined : { scale: 0.92 }}
          />
        }
        {...props}
      >
        <CheckboxPrimitive.Indicator
          data-slot="checkbox-indicator"
          keepMounted
          render={(indicatorProps, state) => {
            const showMark = state.checked || state.indeterminate
            const path = state.indeterminate ? INDETERMINATE_PATH : CHECK_PATH

            return (
              <span {...indicatorProps} className={cn("grid place-content-center text-current transition-none", indicatorProps.className)}>
                <AnimatePresence initial={false}>
                  {showMark ? (
                    <m.svg
                      aria-hidden
                      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                      className="size-3.5"
                      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
                      fill="none"
                      initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.5 }}
                      key={state.indeterminate ? "indeterminate" : "checked"}
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      transition={reduce ? { duration: 0 } : { duration: 0.16, ease: EASE_OUT }}
                      viewBox="0 0 24 24"
                    >
                      <m.path
                        animate={{ pathLength: 1 }}
                        d={path}
                        initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
                        transition={
                          reduce
                            ? { duration: 0 }
                            : {
                                delay: 0.04,
                                duration: state.indeterminate ? 0.2 : 0.3,
                                ease: EASE_OUT,
                              }
                        }
                      />
                    </m.svg>
                  ) : null}
                </AnimatePresence>
              </span>
            )
          }}
        />
      </CheckboxPrimitive.Root>
    </LazyMotion>
  )
}

export { Checkbox }
