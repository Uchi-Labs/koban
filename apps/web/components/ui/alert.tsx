"use client";

import { cva, type VariantProps } from "class-variance-authority";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "motion/react";
import {
  Children,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  createContext,
  type FocusEvent,
  forwardRef,
  isValidElement,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

const alertCornerClassName =
  "rounded-lg supports-[corner-shape:squircle]:corner-squircle supports-[corner-shape:squircle]:rounded-[11px]";

const alertVariants = cva(
  cn(
    alertCornerClassName,
    "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 border border-foreground/8 px-3.5 py-2.5 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current"
  ),
  {
    variants: {
      appearance: {
        default: "bg-card text-card-foreground",
        success:
          "border-[color-mix(in_oklab,var(--positive)_28%,transparent)] bg-[color-mix(in_oklab,var(--positive)_10%,var(--card))] text-foreground *:data-[slot=alert-description]:text-muted-foreground [&>svg]:text-[var(--positive)]",
        info: "border-[color-mix(in_oklab,var(--chart-1)_28%,transparent)] bg-[color-mix(in_oklab,var(--chart-1)_10%,var(--card))] text-foreground *:data-[slot=alert-description]:text-muted-foreground [&>svg]:text-[var(--chart-1)]",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 [&>svg]:text-current",
        warning:
          "border-[color-mix(in_oklab,var(--chart-2)_30%,transparent)] bg-[color-mix(in_oklab,var(--chart-2)_10%,var(--card))] text-foreground *:data-[slot=alert-description]:text-muted-foreground [&>svg]:text-[var(--chart-2)]",
      },
    },
    defaultVariants: {
      appearance: "default",
    },
  }
);

const componentThemeClassName =
  "iconiq-theme";

export type AlertPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type AlertVariant = "inline" | "toast";

export type AlertSize = "sm" | "md" | "lg" | "xl";

export const DEFAULT_ALERT_SIZE: AlertSize = "md";

export type AlertAppearance = NonNullable<
  VariantProps<typeof alertVariants>["appearance"]
>;

const ALERT_SIZE_CLASS: Record<AlertSize, string> = {
  sm: "max-w-[320px]",
  md: "max-w-[400px]",
  lg: "max-w-[480px]",
  xl: "max-w-[560px]",
};

const ALERT_TOAST_SIZE_CLASS: Record<AlertSize, string> = {
  sm: "max-w-full sm:max-w-[320px]",
  md: "max-w-full sm:max-w-[400px]",
  lg: "max-w-full sm:max-w-[480px]",
  xl: "max-w-full sm:max-w-[560px]",
};

const ALERT_TOAST_STACK_GAP = 12;
const ALERT_TOAST_STACK_HEIGHT = 72;

type ToastRegistration = {
  id: string;
  position: AlertPosition;
};

let alertToastRegistry: ToastRegistration[] = [];
const alertToastListeners = new Set<() => void>();

function notifyAlertToastListeners() {
  for (const listener of alertToastListeners) {
    listener();
  }
}

function registerAlertToast(id: string, position: AlertPosition) {
  alertToastRegistry = [...alertToastRegistry, { id, position }];
  notifyAlertToastListeners();
}

function unregisterAlertToast(id: string) {
  alertToastRegistry = alertToastRegistry.filter((entry) => entry.id !== id);
  notifyAlertToastListeners();
}

function subscribeAlertToasts(listener: () => void) {
  alertToastListeners.add(listener);

  return () => {
    alertToastListeners.delete(listener);
  };
}

export function getAlertToastStackIndex(
  id: string,
  position: AlertPosition,
  registry: ToastRegistration[] = alertToastRegistry
): number {
  const sameCorner = registry.filter((entry) => entry.position === position);
  const index = sameCorner.findIndex((entry) => entry.id === id);

  return index < 0 ? 0 : index;
}

export function resolveAlertToastStackOffset({
  position,
  stackIndex,
}: {
  position: AlertPosition;
  stackIndex: number;
}): CSSProperties {
  if (stackIndex <= 0) {
    return {};
  }

  const offset =
    stackIndex * (ALERT_TOAST_STACK_HEIGHT + ALERT_TOAST_STACK_GAP);

  if (position.startsWith("top")) {
    return { top: `calc(1rem + ${offset}px)` };
  }

  return { bottom: `calc(1rem + ${offset}px)` };
}

export function resolveAlertWidth({
  size = DEFAULT_ALERT_SIZE,
  width,
  variant,
}: {
  size?: AlertSize;
  width?: string | number;
  variant: AlertVariant;
}): { className?: string; style?: CSSProperties } {
  if (width !== undefined && width !== "") {
    const maxWidth =
      typeof width === "number"
        ? width > 0
          ? `${width}px`
          : undefined
        : width.trim();

    if (!maxWidth) {
      return {
        className:
          variant === "toast"
            ? ALERT_TOAST_SIZE_CLASS[size]
            : ALERT_SIZE_CLASS[size],
      };
    }

    return {
      className: "max-w-full",
      style: { maxWidth },
    };
  }

  return {
    className:
      variant === "toast"
        ? ALERT_TOAST_SIZE_CLASS[size]
        : ALERT_SIZE_CLASS[size],
  };
}

type AlertContextValue = {
  descriptionId: string;
  hasIcon: boolean;
  reduceMotion: boolean;
  titleId: string;
  titleLines: AlertTitleLines;
};

export type AlertTitleLines = 1 | 2 | 3 | "none";

const AlertContext = createContext<AlertContextValue | null>(null);

function getComponentDisplayName(type: unknown) {
  if (typeof type === "function" || typeof type === "object") {
    return (type as { displayName?: string }).displayName;
  }

  return undefined;
}

type MotionDivProps = ComponentPropsWithoutRef<typeof motion.div>;

export interface AlertProps
  extends Omit<MotionDivProps, "title">,
    VariantProps<typeof alertVariants> {
  children?: ReactNode;
  /** Leading graphic (e.g. a Lucide icon). You control markup and sizing. */
  icon?: ReactNode;
  title?: ReactNode;
  message?: ReactNode;
  /** Optional action row rendered below the message. */
  action?: ReactNode;
  dismissible?: boolean;
  /** Preset max width. Defaults to md (400px). */
  size?: AlertSize;
  /** Custom max width. Pass a CSS length such as "28rem" or a pixel number. Overrides size when set. */
  width?: string | number;
  /** Explicitly choose inline flow or viewport toast behavior. */
  variant?: AlertVariant;
  position?: AlertPosition;
  /** Auto-dismiss after this many milliseconds. Defaults to 5 000. Pass 0 to disable. */
  timeout?: number;
  /** Controlled visibility. Pair with onOpenChange for parent-managed alerts. */
  open?: boolean;
  /** Initial visibility when uncontrolled. Defaults to true. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Max title lines before truncation. Defaults to 1. Pass "none" to allow wrapping. */
  titleLines?: AlertTitleLines;
  onDismiss?: () => void;
}

export interface AlertTitleProps extends MotionDivProps {
  children?: ReactNode;
}

export interface AlertDescriptionProps extends MotionDivProps {
  children?: ReactNode;
}

const DEFAULT_TOAST_POSITION: AlertPosition = "top-right";

/**
 * Mobile-first: every positioned alert sits at the top of the viewport,
 * spanning the full width minus safe margins (inset-x-4). At the sm
 * breakpoint the requested corner takes over.
 */
const positionClasses: Record<AlertPosition, string> = {
  "top-left": "fixed top-4 inset-x-4 sm:inset-x-auto sm:left-4 sm:right-auto",
  "top-center":
    "fixed top-4 inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2",
  "top-right": "fixed top-4 inset-x-4 sm:inset-x-auto sm:left-auto sm:right-4",
  "bottom-left":
    "fixed top-4 inset-x-4 sm:inset-x-auto sm:top-auto sm:bottom-4 sm:left-4 sm:right-auto",
  "bottom-center":
    "fixed top-4 inset-x-4 sm:inset-x-auto sm:top-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2",
  "bottom-right":
    "fixed top-4 inset-x-4 sm:inset-x-auto sm:top-auto sm:bottom-4 sm:left-auto sm:right-4",
};

export interface AlertActionProps extends MotionDivProps {
  children?: ReactNode;
}

function getAlertTitleLineClampClass(titleLines: AlertTitleLines) {
  switch (titleLines) {
    case "none":
      return undefined;
    case 2:
      return "line-clamp-2";
    case 3:
      return "line-clamp-3";
    default:
      return "line-clamp-1";
  }
}

/** Vertical travel only — kept small so motion reads as a drift, not a snap. */
function getAlertMotionOffset(position?: AlertPosition): { y: number } {
  if (!position) {
    return { y: 6 };
  }

  return position.startsWith("top") ? { y: -8 } : { y: 8 };
}

const FLUID_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const FLUID_EXIT_EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];

function getReducedMotionContainerVariants(): Variants {
  return {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: 0.15 },
    },
    exit: {
      opacity: 0,
      transition: { duration: 0.1 },
    },
  };
}

function getContainerVariants(
  position?: AlertPosition,
  reduceMotion = false
): Variants {
  if (reduceMotion) {
    return getReducedMotionContainerVariants();
  }

  const { y: dy } = getAlertMotionOffset(position);

  return {
    hidden: {
      opacity: 0,
      y: dy,
      scale: 0.982,
      filter: "blur(3px)",
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      filter: "blur(0px)",
      transition: {
        opacity: { duration: 0.24, ease: FLUID_EASE },
        y: { duration: 0.28, ease: FLUID_EASE },
        scale: { duration: 0.28, ease: FLUID_EASE },
        filter: { duration: 0.28, ease: FLUID_EASE },
        staggerChildren: 0.04,
        delayChildren: 0.06,
      },
    },
    exit: {
      opacity: 0,
      y: dy * 0.55,
      scale: 0.986,
      filter: "blur(2px)",
      transition: {
        opacity: { duration: 0.18, ease: FLUID_EXIT_EASE },
        y: { duration: 0.2, ease: FLUID_EXIT_EASE },
        scale: { duration: 0.2, ease: FLUID_EXIT_EASE },
        filter: { duration: 0.18, ease: FLUID_EXIT_EASE },
      },
    },
  };
}

/** Text drifts in softly while the container handles exit motion. */
const childVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.24, ease: FLUID_EASE },
  },
};

const reducedMotionChildVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
};

/** Icon eases in with the same fluid curve as the container. */
const iconVariants: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.26, ease: FLUID_EASE, delay: 0.05 },
  },
};

const reducedMotionIconVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
};

function getChildVariants(reduceMotion: boolean) {
  return reduceMotion ? reducedMotionChildVariants : childVariants;
}

function getIconVariants(reduceMotion: boolean) {
  return reduceMotion ? reducedMotionIconVariants : iconVariants;
}

const AlertTitle = forwardRef<HTMLDivElement, AlertTitleProps>(
  ({ children, className, id, ...props }, ref) => {
    const context = useContext(AlertContext);
    const titleLineClampClass = getAlertTitleLineClampClass(
      context?.titleLines ?? 1
    );

    return (
      <motion.div
        className={cn(
          "min-h-4 font-medium tracking-tight",
          titleLineClampClass,
          context?.hasIcon ? "col-start-2" : "col-start-1",
          className
        )}
        data-slot="alert-title"
        id={id ?? context?.titleId}
        ref={ref}
        variants={getChildVariants(context?.reduceMotion ?? false)}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

AlertTitle.displayName = "AlertTitle";

const AlertDescription = forwardRef<HTMLDivElement, AlertDescriptionProps>(
  ({ children, className, id, ...props }, ref) => {
    const context = useContext(AlertContext);

    return (
      <motion.div
        className={cn(
          "grid justify-items-start gap-1 text-muted-foreground text-sm [&_p]:leading-relaxed",
          context?.hasIcon ? "col-start-2" : "col-start-1",
          className
        )}
        data-slot="alert-description"
        id={id ?? context?.descriptionId}
        ref={ref}
        variants={getChildVariants(context?.reduceMotion ?? false)}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

AlertDescription.displayName = "AlertDescription";

const AlertAction = forwardRef<HTMLDivElement, AlertActionProps>(
  ({ children, className, ...props }, ref) => {
    const context = useContext(AlertContext);

    return (
      <motion.div
        className={cn(
          "mt-2 flex flex-wrap items-center gap-2",
          context?.hasIcon ? "col-start-2" : "col-start-1",
          className
        )}
        data-slot="alert-action"
        ref={ref}
        variants={getChildVariants(context?.reduceMotion ?? false)}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

AlertAction.displayName = "AlertAction";

function isAlertTitleChild(child: ReactNode) {
  if (!isValidElement(child)) {
    return false;
  }

  return (
    child.type === AlertTitle ||
    getComponentDisplayName(child.type) === AlertTitle.displayName
  );
}

function isAlertDescriptionChild(child: ReactNode) {
  if (!isValidElement(child)) {
    return false;
  }

  return (
    child.type === AlertDescription ||
    getComponentDisplayName(child.type) === AlertDescription.displayName
  );
}

function isAlertActionChild(child: ReactNode) {
  if (!isValidElement(child)) {
    return false;
  }

  return (
    child.type === AlertAction ||
    getComponentDisplayName(child.type) === AlertAction.displayName
  );
}

function splitAlertChildren(children: ReactNode) {
  const childArray = Children.toArray(children);
  const [firstChild, ...remainingChildren] = childArray;

  let leadingIcon: ReactNode = null;
  let contentChildren = childArray;

  if (
    firstChild &&
    !isAlertTitleChild(firstChild) &&
    !isAlertDescriptionChild(firstChild) &&
    !isAlertActionChild(firstChild)
  ) {
    leadingIcon = firstChild;
    contentChildren = remainingChildren;
  }

  const actionChildren = contentChildren.filter(isAlertActionChild);
  const textChildren = contentChildren.filter(
    (child) => !isAlertActionChild(child)
  );

  return {
    actionChildren,
    contentChildren: textChildren,
    leadingIcon,
  };
}

function useAlertLifecycle({
  defaultOpen = true,
  onDismiss,
  onOpenChange,
  open,
  showDismiss,
  timeout,
}: {
  defaultOpen?: boolean;
  onDismiss?: () => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  showDismiss: boolean;
  timeout: number;
}) {
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const visible = isControlled ? open : uncontrolledOpen;
  const [mounted, setMounted] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [isDocumentHidden, setIsDocumentHidden] = useState(false);
  const timeoutIdRef = useRef<number | null>(null);
  const remainingTimeRef = useRef(timeout);
  const timerStartedAtRef = useRef<number | null>(null);
  const dismissalRequestedRef = useRef(false);
  const previousTimeoutRef = useRef(timeout);

  const setVisible = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }

      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange]
  );

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open === true) {
      dismissalRequestedRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentHidden(document.hidden);
    };

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const clearTimer = useCallback(() => {
    if (timeoutIdRef.current !== null) {
      window.clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }

    timerStartedAtRef.current = null;
  }, []);

  const requestDismiss = useCallback(() => {
    if (dismissalRequestedRef.current) {
      return;
    }

    dismissalRequestedRef.current = true;
    clearTimer();
    setVisible(false);
  }, [clearTimer, setVisible]);

  const pauseTimer = useCallback(() => {
    if (timeoutIdRef.current === null || timerStartedAtRef.current === null) {
      return;
    }

    const elapsed = Date.now() - timerStartedAtRef.current;
    remainingTimeRef.current = Math.max(0, remainingTimeRef.current - elapsed);
    clearTimer();
  }, [clearTimer]);

  const startTimer = useCallback(() => {
    if (remainingTimeRef.current <= 0) {
      if (timeoutIdRef.current === null) {
        requestDismiss();
      }

      return;
    }

    if (timeoutIdRef.current !== null) {
      return;
    }

    timerStartedAtRef.current = Date.now();
    timeoutIdRef.current = window.setTimeout(() => {
      clearTimer();
      requestDismiss();
    }, remainingTimeRef.current);
  }, [clearTimer, requestDismiss]);

  useEffect(() => {
    if (previousTimeoutRef.current === timeout) {
      return;
    }

    previousTimeoutRef.current = timeout;
    clearTimer();
    remainingTimeRef.current = timeout;

    if (
      visible &&
      timeout > 0 &&
      !(isHovered || isFocusWithin || isDocumentHidden)
    ) {
      startTimer();
    }
  }, [
    clearTimer,
    isDocumentHidden,
    isFocusWithin,
    isHovered,
    startTimer,
    timeout,
    visible,
  ]);

  useEffect(() => {
    if (!visible || timeout <= 0) {
      clearTimer();
      return;
    }

    if (isHovered || isFocusWithin || isDocumentHidden) {
      pauseTimer();
      return;
    }

    startTimer();
  }, [
    clearTimer,
    isDocumentHidden,
    isFocusWithin,
    isHovered,
    pauseTimer,
    startTimer,
    timeout,
    visible,
  ]);

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!(visible && showDismiss)) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      requestDismiss();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [requestDismiss, showDismiss, visible]);

  const handleBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocusedNode = event.relatedTarget;

    if (
      nextFocusedNode instanceof Node &&
      event.currentTarget.contains(nextFocusedNode)
    ) {
      return;
    }

    setIsFocusWithin(false);
  };

  const handleExitComplete = useCallback(() => {
    if (!dismissalRequestedRef.current) {
      return;
    }

    onDismiss?.();
  }, [onDismiss]);

  return {
    handleBlurCapture,
    handleExitComplete,
    mounted,
    requestDismiss,
    setIsFocusWithin,
    setIsHovered,
    visible,
  };
}

function AlertIcon({ children }: { children: ReactNode }) {
  const context = useContext(AlertContext);

  if (!children) {
    return null;
  }

  return (
    <motion.div
      className="col-start-1 row-start-1 shrink-0 [&_svg]:size-4 [&_svg]:translate-y-0.5 [&_svg]:text-current"
      variants={getIconVariants(context?.reduceMotion ?? false)}
    >
      {children}
    </motion.div>
  );
}

function getDismissButtonClasses(
  appearance?: VariantProps<typeof alertVariants>["appearance"]
) {
  switch (appearance) {
    case "warning":
      return "text-[color-mix(in_oklab,var(--chart-2)_55%,transparent)] hover:text-[var(--chart-2)]";
    case "success":
      return "text-[color-mix(in_oklab,var(--positive)_55%,transparent)] hover:text-[var(--positive)]";
    case "info":
      return "text-[color-mix(in_oklab,var(--chart-1)_55%,transparent)] hover:text-[var(--chart-1)]";
    case "destructive":
      return "text-destructive/40 hover:text-destructive";
    default:
      return "text-foreground/35 hover:text-foreground/70";
  }
}

function AlertDismissButton({
  appearance,
  className,
  onDismiss,
  show,
}: {
  appearance?: VariantProps<typeof alertVariants>["appearance"];
  className?: string;
  onDismiss: () => void;
  show: boolean;
}) {
  const context = useContext(AlertContext);

  if (!show) {
    return null;
  }

  return (
    <motion.button
      aria-label="Dismiss alert"
      className={cn(
        "supports-[corner-shape:squircle]:corner-squircle relative -my-2 -mr-2 inline-flex size-10 shrink-0 items-center justify-center self-start rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring supports-[corner-shape:squircle]:rounded-[11px]",
        getDismissButtonClasses(appearance),
        className
      )}
      data-slot="alert-dismiss"
      onClick={onDismiss}
      type="button"
      variants={getChildVariants(context?.reduceMotion ?? false)}
    >
      <svg fill="none" height="14" viewBox="0 0 14 14" width="14">
        <path
          d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.2"
        />
      </svg>
    </motion.button>
  );
}

function getAlertGridClasses({
  hasIcon,
  showDismiss,
}: {
  hasIcon: boolean;
  showDismiss: boolean;
}) {
  if (hasIcon) {
    return showDismiss
      ? "grid-cols-[calc(var(--spacing)*4)_1fr_auto] gap-x-3"
      : "grid-cols-[calc(var(--spacing)*4)_1fr] gap-x-3";
  }

  return showDismiss ? "grid-cols-[1fr_auto]" : undefined;
}

function AlertCard({
  appearance,
  className,
  content,
  descriptionId,
  hasDescription,
  hasIcon,
  hasTitle,
  icon,
  motionProps,
  onBlurCapture,
  onDismiss,
  onExitComplete,
  onFocusCapture,
  onPointerEnter,
  onPointerLeave,
  position,
  reduceMotion,
  ref,
  showDismiss,
  size,
  stackOffsetStyle,
  titleId,
  titleLines,
  variants,
  variant,
  visible,
  width,
}: {
  appearance?: VariantProps<typeof alertVariants>["appearance"];
  className?: MotionDivProps["className"];
  content: ReactNode;
  descriptionId: string;
  hasDescription: boolean;
  hasIcon: boolean;
  hasTitle: boolean;
  icon: ReactNode;
  motionProps: MotionDivProps;
  onBlurCapture: (event: FocusEvent<HTMLDivElement>) => void;
  onDismiss: () => void;
  onExitComplete: () => void;
  onFocusCapture: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  position?: AlertPosition;
  reduceMotion: boolean;
  ref?: Ref<HTMLDivElement>;
  showDismiss: boolean;
  size?: AlertSize;
  stackOffsetStyle?: CSSProperties;
  titleId: string;
  titleLines: AlertTitleLines;
  variants: Variants;
  variant: AlertVariant;
  visible: boolean;
  width?: string | number;
}) {
  const dismissColumnClass = hasIcon
    ? "col-start-3 row-start-1"
    : "col-start-2 row-start-1";
  const alertWidth = resolveAlertWidth({
    size: size ?? DEFAULT_ALERT_SIZE,
    width,
    variant,
  });

  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {visible ? (
        <AlertContext.Provider
          value={{
            descriptionId,
            hasIcon,
            reduceMotion,
            titleId,
            titleLines,
          }}
        >
          <motion.div
            {...motionProps}
            animate="visible"
            aria-atomic={true}
            aria-describedby={hasDescription ? descriptionId : undefined}
            aria-labelledby={hasTitle ? titleId : undefined}
            aria-live={variant === "toast" ? "polite" : undefined}
            className={cn(
              componentThemeClassName,
              alertVariants({ appearance }),
              getAlertGridClasses({ hasIcon, showDismiss }),
              reduceMotion
                ? "will-change-[opacity]"
                : "transform-gpu will-change-[transform,opacity,filter]",
              alertWidth.className,
              position ? positionClasses[position] : undefined,
              position && "z-[300] shadow-[var(--ic-shadow-soft)]",
              className
            )}
            data-slot="alert"
            exit="exit"
            initial="hidden"
            onBlurCapture={onBlurCapture}
            onFocusCapture={onFocusCapture}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            ref={ref}
            role={variant === "toast" ? "status" : "alert"}
            style={{
              ...motionProps.style,
              ...alertWidth.style,
              ...stackOffsetStyle,
            }}
            variants={variants}
          >
            {icon ? <AlertIcon>{icon}</AlertIcon> : null}
            {content}
            <AlertDismissButton
              appearance={appearance}
              className={dismissColumnClass}
              onDismiss={onDismiss}
              show={showDismiss}
            />
          </motion.div>
        </AlertContext.Provider>
      ) : null}
    </AnimatePresence>
  );
}

export function getAlertConfig({
  dismissible,
  hasCompoundChildren,
  position,
  timeout,
  variant,
}: {
  dismissible?: boolean;
  hasCompoundChildren: boolean;
  position?: AlertPosition;
  timeout?: number;
  variant?: AlertVariant;
}) {
  const resolvedVariant: AlertVariant = position
    ? "toast"
    : (variant ?? "inline");

  return {
    resolvedDismissible:
      dismissible ?? (hasCompoundChildren ? resolvedVariant === "toast" : true),
    resolvedPosition:
      resolvedVariant === "toast"
        ? (position ?? DEFAULT_TOAST_POSITION)
        : undefined,
    resolvedTimeout:
      timeout ??
      (hasCompoundChildren && resolvedVariant === "inline" ? 0 : 5000),
    resolvedVariant,
  };
}

function getLegacyAlertContent({
  action,
  message,
  title,
}: {
  action?: ReactNode;
  message?: ReactNode;
  title?: ReactNode;
}) {
  return (
    <>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {message ? <AlertDescription>{message}</AlertDescription> : null}
      {action ? <AlertAction>{action}</AlertAction> : null}
    </>
  );
}

function getAlertContent({
  action,
  children,
  hasCompoundChildren,
  icon,
  message,
  title,
}: {
  action?: ReactNode;
  children?: ReactNode;
  hasCompoundChildren: boolean;
  icon?: ReactNode;
  message?: ReactNode;
  title?: ReactNode;
}) {
  if (hasCompoundChildren) {
    const { actionChildren, contentChildren, leadingIcon } =
      splitAlertChildren(children);
    const renderedIcon = icon ?? leadingIcon;

    return {
      hasDescription: contentChildren.some(isAlertDescriptionChild),
      hasIcon: Boolean(renderedIcon),
      hasTitle: contentChildren.some(isAlertTitleChild),
      renderedContent: (
        <>
          {contentChildren}
          {actionChildren}
          {action ? <AlertAction>{action}</AlertAction> : null}
        </>
      ),
      renderedIcon,
    };
  }

  const renderedIcon = icon;

  return {
    hasDescription: Boolean(message),
    hasIcon: Boolean(renderedIcon),
    hasTitle: Boolean(title),
    renderedContent: getLegacyAlertContent({
      action,
      message,
      title,
    }),
    renderedIcon,
  };
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  {
    appearance,
    children,
    className,
    icon,
    title,
    message,
    action,
    dismissible,
    size = DEFAULT_ALERT_SIZE,
    width,
    variant,
    position,
    timeout,
    open,
    defaultOpen = true,
    onOpenChange,
    titleLines = 1,
    onDismiss,
    ...props
  },
  ref
) {
  const hasCompoundChildren = Children.count(children) > 0;
  const reduceMotion = useReducedMotion() ?? false;
  const toastId = useId();
  const [toastStackIndex, setToastStackIndex] = useState(0);
  const {
    resolvedDismissible,
    resolvedPosition,
    resolvedTimeout,
    resolvedVariant,
  } = getAlertConfig({
    dismissible,
    hasCompoundChildren,
    position,
    timeout,
    variant,
  });
  const {
    handleBlurCapture,
    handleExitComplete,
    mounted,
    requestDismiss,
    setIsFocusWithin,
    setIsHovered,
    visible,
  } = useAlertLifecycle({
    defaultOpen,
    onDismiss,
    onOpenChange,
    open,
    showDismiss: resolvedDismissible,
    timeout: resolvedTimeout,
  });

  useEffect(() => {
    if (resolvedVariant !== "toast" || !resolvedPosition || !visible) {
      return;
    }

    registerAlertToast(toastId, resolvedPosition);

    const updateStackIndex = () => {
      setToastStackIndex(getAlertToastStackIndex(toastId, resolvedPosition));
    };

    const unsubscribe = subscribeAlertToasts(updateStackIndex);
    updateStackIndex();

    return () => {
      unsubscribe();
    };
  }, [resolvedPosition, resolvedVariant, toastId, visible]);

  const handleToastExitComplete = useCallback(() => {
    if (resolvedVariant === "toast" && resolvedPosition) {
      unregisterAlertToast(toastId);
    }

    handleExitComplete();
  }, [handleExitComplete, resolvedPosition, resolvedVariant, toastId]);

  useEffect(
    () => () => {
      unregisterAlertToast(toastId);
    },
    [toastId]
  );

  const titleId = useId();
  const messageId = useId();

  const containerVariants = getContainerVariants(
    resolvedPosition,
    reduceMotion
  );
  const { hasDescription, hasTitle, renderedContent, renderedIcon } =
    getAlertContent({
      action,
      children,
      hasCompoundChildren,
      icon,
      message,
      title,
    });

  const stackOffsetStyle =
    resolvedVariant === "toast" && resolvedPosition
      ? resolveAlertToastStackOffset({
          position: resolvedPosition,
          stackIndex: toastStackIndex,
        })
      : undefined;

  const card = (
    <AlertCard
      appearance={appearance}
      className={className}
      content={renderedContent}
      descriptionId={messageId}
      hasDescription={hasDescription}
      hasIcon={Boolean(renderedIcon)}
      hasTitle={hasTitle}
      icon={renderedIcon}
      motionProps={props}
      onBlurCapture={handleBlurCapture}
      onDismiss={requestDismiss}
      onExitComplete={handleToastExitComplete}
      onFocusCapture={() => setIsFocusWithin(true)}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      position={resolvedPosition}
      reduceMotion={reduceMotion}
      ref={ref}
      showDismiss={resolvedDismissible}
      size={size}
      stackOffsetStyle={stackOffsetStyle}
      titleId={titleId}
      titleLines={titleLines}
      variant={resolvedVariant}
      variants={containerVariants}
      visible={visible}
      width={width}
    />
  );

  /**
   * When a position is given, portal the alert to document.body so it
   * escapes any ancestor CSS transform (Motion scale/y), which
   * would otherwise make `position: fixed` relative to the transformed
   * element instead of the viewport.
   */
  if (resolvedVariant === "toast") {
    if (!mounted || typeof document === "undefined") {
      return null;
    }

    return createPortal(card, document.body);
  }

  return card;
});

Alert.displayName = "Alert";

export default Alert;
export { AlertAction, AlertDescription, AlertTitle };
