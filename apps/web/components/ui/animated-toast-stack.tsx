"use client";

import {
  AlertCircle,
  Bell,
  Check,
  Info,
  LoaderCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { EASE_OUT, SPRING_PANEL, SPRING_PRESS } from "@/lib/motion";
import { playToast } from "@/lib/ui-sound";
import { cn } from "@/lib/utils";

export type ToastStatus = "neutral" | "info" | "loading" | "success" | "error";
export type ToastPosition = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";

export type AnimatedToastAction = {
  label: ReactNode;
  onClick: (toast: AnimatedToast) => void;
};

export type AnimatedToast = {
  action?: AnimatedToastAction;
  createdAt?: number;
  description?: ReactNode;
  dismissible?: boolean;
  duration?: number;
  icon?: ReactNode;
  id: string;
  status?: ToastStatus;
  title: ReactNode;
};

export type ToastInput = Omit<AnimatedToast, "createdAt" | "id"> & {
  id?: string;
};

export type ToastClassNames = {
  action?: string;
  close?: string;
  content?: string;
  description?: string;
  iconWrap?: string;
  item?: string;
  progress?: string;
  root?: string;
  surface?: string;
  title?: string;
};

export interface AnimatedToastStackProps {
  className?: string;
  classNames?: ToastClassNames;
  fixed?: boolean;
  icons?: Partial<Record<ToastStatus, ReactNode>>;
  maxVisible?: number;
  onDismiss?: (id: string) => void;
  placement?: "absolute" | "fixed" | "static";
  portal?: boolean;
  portalRoot?: Element | null;
  position?: ToastPosition;
  renderToast?: (toast: AnimatedToast) => ReactNode;
  toasts: AnimatedToast[];
}

export interface UseAnimatedToastStackOptions {
  defaultDuration?: number;
  initialToasts?: ToastInput[];
  limit?: number;
}

const CONTENT_TRANSITION = {
  duration: 0.28,
  ease: EASE_OUT,
} as const;

const STATUS_ICON: Record<ToastStatus, LucideIcon> = {
  error: AlertCircle,
  info: Info,
  loading: LoaderCircle,
  neutral: Bell,
  success: Check,
};

const STATUS_CLASS: Record<ToastStatus, string> = {
  error: "bg-destructive/10 text-destructive",
  info: "bg-primary/10 text-primary",
  loading: "bg-primary/10 text-primary",
  neutral: "bg-primary/[0.05] text-muted-foreground",
  success: "bg-(--positive)/10 text-(--positive)",
};

const POSITION_CLASS: Record<ToastPosition, string> = {
  "bottom-center": "bottom-6 left-1/2 -translate-x-1/2",
  "bottom-left": "bottom-6 left-4",
  "bottom-right": "right-4 bottom-6",
  "top-center": "top-4 left-1/2 -translate-x-1/2",
  "top-left": "top-4 left-4",
  "top-right": "top-4 right-4",
};

let idSeed = 0;
const subscribeMounted = (_onStoreChange: () => void) => () => undefined;
const getMountedSnapshot = () => true;
const getServerMountedSnapshot = () => false;

function createToast(input: ToastInput, defaultDuration: number): AnimatedToast {
  return {
    dismissible: true,
    duration: defaultDuration,
    ...input,
    createdAt: Date.now(),
    id: input.id ?? `toast-${Date.now()}-${idSeed++}`,
  };
}

export function useAnimatedToastStack({
  defaultDuration = 4200,
  initialToasts = [],
  limit,
}: UseAnimatedToastStackOptions = {}) {
  const toastTimers = useRef<Map<string, { signature: string; timer: number }> | null>(null);
  if (toastTimers.current === null) {
    toastTimers.current = new Map();
  }
  const [toasts, setToasts] = useState<AnimatedToast[]>(() =>
    initialToasts.map((toast) => createToast(toast, defaultDuration))
  );
  const clearToastTimer = useCallback((id: string) => {
    const existing = toastTimers.current?.get(id);

    if (existing) {
      window.clearTimeout(existing.timer);
      toastTimers.current?.delete(id);
    }
  }, []);
  const scheduleToastTimer = useCallback(
    (toast: AnimatedToast) => {
      const duration = toast.duration ?? defaultDuration;

      if (duration <= 0) {
        clearToastTimer(toast.id);
        return;
      }

      const createdAt = toast.createdAt ?? Date.now();
      const signature = `${createdAt}:${duration}`;
      const existing = toastTimers.current?.get(toast.id);

      if (existing?.signature === signature) {
        return;
      }

      clearToastTimer(toast.id);

      const elapsed = Date.now() - createdAt;
      const remaining = Math.max(duration - elapsed, 0);
      const timer = window.setTimeout(() => {
        toastTimers.current?.delete(toast.id);
        setToasts((currentToasts) => currentToasts.filter((currentToast) => currentToast.id !== toast.id));
      }, remaining);

      toastTimers.current?.set(toast.id, { signature, timer });
    },
    [clearToastTimer, defaultDuration]
  );

  const dismissToast = useCallback((id: string) => {
    clearToastTimer(id);
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
  }, [clearToastTimer]);

  const clearToasts = useCallback(() => {
    toastTimers.current?.forEach((entry) => window.clearTimeout(entry.timer));
    toastTimers.current?.clear();
    setToasts([]);
  }, []);

  const showToast = useCallback(
    (input: ToastInput) => {
      const toast = createToast(input, defaultDuration);

      playToast();
      scheduleToastTimer(toast);
      setToasts((currentToasts) => {
        const nextToasts = [...currentToasts, toast];

        return typeof limit === "number" ? nextToasts.slice(-limit) : nextToasts;
      });

      return toast.id;
    },
    [defaultDuration, limit, scheduleToastTimer]
  );

  const updateToast = useCallback((id: string, patch: Partial<ToastInput>) => {
    setToasts((currentToasts) =>
      currentToasts.map((toast) => {
        if (toast.id !== id) {
          return toast;
        }

        const nextToast = {
          ...toast,
          ...patch,
          createdAt: patch.duration === undefined ? toast.createdAt : Date.now(),
          id,
        };

        if (patch.duration !== undefined) {
          scheduleToastTimer(nextToast);
        }

        return nextToast;
      })
    );
  }, [scheduleToastTimer]);

  useEffect(() => {
    const timers = toastTimers.current;

    return () => {
      timers?.forEach((entry) => window.clearTimeout(entry.timer));
      timers?.clear();
    };
  }, []);

  return useMemo(
    () => ({
      clearToasts,
      dismissToast,
      setToasts,
      showToast,
      toasts,
      updateToast,
    }),
    [clearToasts, dismissToast, showToast, toasts, updateToast]
  );
}

export function AnimatedToastStack({
  className,
  classNames,
  fixed = false,
  icons,
  maxVisible = 4,
  onDismiss,
  placement,
  portal,
  portalRoot,
  position = "bottom-right",
  renderToast,
  toasts,
}: AnimatedToastStackProps) {
  const mounted = useSyncExternalStore(subscribeMounted, getMountedSnapshot, getServerMountedSnapshot);
  const visibleToasts = toasts.slice(-maxVisible);
  const isBottom = position.startsWith("bottom");
  const resolvedPlacement = placement ?? (fixed ? "fixed" : "static");
  const shouldPortal = portal ?? resolvedPlacement === "fixed";

  const stack = (
    <LazyMotion features={domAnimation}>
      <ol
        aria-atomic="false"
        aria-live="polite"
        className={cn(
          "pointer-events-none flex w-[calc(100vw-2rem)] max-w-sm gap-2",
          isBottom ? "flex-col-reverse" : "flex-col",
          resolvedPlacement === "fixed" && "fixed z-[90]",
          resolvedPlacement === "absolute" && "absolute z-20",
          resolvedPlacement !== "static" && POSITION_CLASS[position],
          classNames?.root,
          className
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {visibleToasts.map((toast, index) => (
            <ToastItem
              classNames={classNames}
              icons={icons}
              index={index}
              key={toast.id}
              onDismiss={onDismiss}
              renderToast={renderToast}
              toast={toast}
            />
          ))}
        </AnimatePresence>
      </ol>
    </LazyMotion>
  );

  if (shouldPortal && !mounted) {
    return null;
  }

  if (shouldPortal) {
    return createPortal(stack, portalRoot ?? document.body);
  }

  return stack;
}

const ToastItem = memo(function ToastItem({
  classNames,
  icons,
  index,
  onDismiss,
  renderToast,
  toast,
}: {
  classNames?: ToastClassNames;
  icons?: Partial<Record<ToastStatus, ReactNode>>;
  index: number;
  onDismiss?: (id: string) => void;
  renderToast?: (toast: AnimatedToast) => ReactNode;
  toast: AnimatedToast;
}) {
  const reduce = useReducedMotion();
  const status = toast.status ?? "neutral";
  const Icon = STATUS_ICON[status];
  const iconNode = icons?.[status] ?? toast.icon ?? <Icon className="h-3.5 w-3.5" />;
  const canDismiss = toast.dismissible !== false && Boolean(onDismiss);

  return (
    <m.li
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
      className={cn("pointer-events-auto relative will-change-transform", classNames?.item)}
      drag={canDismiss && !reduce ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.18}
      exit={
        reduce
          ? { opacity: 0 }
          : {
              opacity: 0,
              scale: 0.96,
              transition: { duration: 0.18, ease: EASE_OUT },
              x: 32,
            }
      }
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 22 }}
      layout
      onDragEnd={(_, info) => {
        if (!canDismiss || !onDismiss) {
          return;
        }

        if (Math.abs(info.offset.x) > 72 || Math.abs(info.velocity.x) > 520) {
          onDismiss(toast.id);
        }
      }}
      style={{ zIndex: 20 - index }}
      transition={SPRING_PANEL}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-border bg-card/95 p-3 shadow-2xl backdrop-blur-xl",
          classNames?.surface
        )}
      >
        {renderToast ? (
          renderToast(toast)
        ) : (
          <div className="flex items-start gap-3">
            <m.span
              className={cn(
                "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                STATUS_CLASS[status],
                classNames?.iconWrap
              )}
              layout
            >
              <AnimatePresence initial={false} mode="popLayout">
                <m.span
                  animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                  className="inline-flex"
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: -8 }}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8, y: 8 }}
                  key={status}
                  transition={CONTENT_TRANSITION}
                >
                  {status === "loading" ? <span className="inline-flex animate-spin">{iconNode}</span> : iconNode}
                </m.span>
              </AnimatePresence>
            </m.span>

            <div className={cn("min-w-0 flex-1", classNames?.content)}>
              <AnimatePresence initial={false} mode="popLayout">
                <m.div
                  animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  key={`${toast.id}-${status}-${String(toast.title)}`}
                  transition={CONTENT_TRANSITION}
                >
                  <p className={cn("truncate text-sm font-medium leading-5 text-foreground", classNames?.title)}>
                    {toast.title}
                  </p>
                  {toast.description ? (
                    <p className={cn("mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground", classNames?.description)}>
                      {toast.description}
                    </p>
                  ) : null}
                </m.div>
              </AnimatePresence>

              {toast.action ? (
                <button
                  className={cn(
                    "mt-2 inline-flex h-7 items-center rounded-full bg-primary/[0.06] px-3 text-xs font-medium text-foreground transition-colors hover:bg-primary/[0.1]",
                    classNames?.action
                  )}
                  onClick={() => toast.action?.onClick(toast)}
                  type="button"
                >
                  {toast.action.label}
                </button>
              ) : null}
            </div>

            {canDismiss ? (
              <m.button
                aria-label="Dismiss toast"
                className={cn(
                  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/[0.06] hover:text-foreground",
                  classNames?.close
                )}
                onClick={() => onDismiss?.(toast.id)}
                transition={SPRING_PRESS}
                type="button"
                whileTap={reduce ? undefined : { scale: 0.9 }}
              >
                <X className="h-3.5 w-3.5" />
              </m.button>
            ) : null}
          </div>
        )}
      </div>
    </m.li>
  );
});
