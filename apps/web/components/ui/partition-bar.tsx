"use client";

import {
  Children,
  createContext,
  type CSSProperties,
  type HTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const partitionBarVariants = cva("flex flex-row", {
  variants: {
    size: {
      sm: "text-xs",
      md: "text-sm",
      lg: "text-base",
    },
  },
  defaultVariants: { size: "md" },
});

const partitionBarLineVariants = cva("", {
  variants: {
    variant: {
      default: "bg-[var(--positive)]",
      secondary: "bg-[color-mix(in_oklab,var(--positive)_60%,transparent)]",
      destructive: "bg-[var(--negative)]",
      outline: "border border-input bg-background",
      muted: "bg-[color-mix(in_oklab,var(--positive)_40%,transparent)]",
    },
  },
  defaultVariants: { variant: "default" },
});

const partitionBarTitleVariants = cva("", {
  variants: {
    variant: {
      default: "text-[var(--positive)]",
      secondary: "text-[color-mix(in_oklab,var(--positive)_74%,var(--foreground))]",
      destructive: "text-[var(--negative)]",
      outline: "text-foreground",
      muted: "text-muted-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

type PartitionBarContextValue = {
  size: VariantProps<typeof partitionBarVariants>["size"];
  total: number;
};

const PartitionBarContext = createContext<PartitionBarContextValue | null>(null);

function usePartitionBarContext() {
  const context = useContext(PartitionBarContext);

  if (!context) {
    throw new Error("PartitionBar segments must be used within <PartitionBar>.");
  }

  return context;
}

export interface PartitionBarSegmentProps
  extends HTMLAttributes<HTMLLIElement>,
    VariantProps<typeof partitionBarLineVariants> {
  alignment?: "left" | "center" | "right";
  children?: ReactNode;
  num?: number;
  /** Trusted CSS color used when a data series needs its own tint. */
  tint?: string;
}

export interface PartitionBarProps
  extends HTMLAttributes<HTMLUListElement>,
    VariantProps<typeof partitionBarVariants> {
  children?: ReactElement<PartitionBarSegmentProps> | ReactElement<PartitionBarSegmentProps>[];
  gap?: number;
}

export function PartitionBar({ children, className, gap = 1, size, style, ...props }: PartitionBarProps) {
  const total = Children.toArray(children).reduce<number>((sum, child) => {
    return isValidElement(child) ? sum + ((child.props as PartitionBarSegmentProps).num ?? 0) : sum;
  }, 0);

  return (
    <PartitionBarContext.Provider value={{ size, total }}>
      <ul
        className={cn("w-full", partitionBarVariants({ size }), className)}
        style={{ ...style, gap: `${gap * 4}px` }}
        {...props}
      >
        {children}
      </ul>
    </PartitionBarContext.Provider>
  );
}

export function PartitionBarSegment({
  alignment = "center",
  children,
  className,
  num = 0,
  style,
  tint,
  variant = "default",
  ...props
}: PartitionBarSegmentProps) {
  const { size, total } = usePartitionBarContext();
  const widthPercent = total > 0 ? (num / total) * 100 : 0;
  const tintStyle = tint ? ({ "--partition-tint": tint } as CSSProperties) : undefined;

  return (
    <li
      className="flex min-w-0 shrink-0 grow-0 flex-col transition-[flex-basis] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none"
      style={{ ...style, ...tintStyle, flexBasis: `${widthPercent}%` }}
      {...props}
    >
      <div
        aria-hidden="true"
        className={cn(
          partitionBarLineVariants({ variant }),
          "w-full shrink-0 rounded-full",
          size === "sm" ? "h-2" : size === "lg" ? "h-4" : "h-3",
          tint && "bg-[color-mix(in_oklab,var(--partition-tint)_100%,transparent)]",
          className
        )}
      />
      <div
        className={cn(
          partitionBarTitleVariants({ variant }),
          "flex w-full flex-col whitespace-normal",
          size === "sm" ? "mt-2" : size === "lg" ? "mt-4" : "mt-3",
          alignment === "left" && "items-start",
          alignment === "center" && "items-center",
          alignment === "right" && "items-end",
          tint && "text-[color-mix(in_oklab,var(--partition-tint)_82%,var(--foreground))]"
        )}
      >
        {children}
      </div>
    </li>
  );
}

export function PartitionBarSegmentTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("w-fit font-semibold", className)}>{children}</div>;
}

export function PartitionBarSegmentValue({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("w-fit text-[80%] text-muted-foreground tabular-nums", className)}>{children}</div>;
}

export default PartitionBar;
