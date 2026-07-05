import { ChevronRight } from "lucide-react";
import Link from "next/link";
import React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function DashboardCard({
  action,
  children,
  className = "",
  contentClassName,
  layered = true,
  title
}: {
  action?: { href: string; label: string };
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  layered?: boolean;
  title: string;
}) {
  return (
    <Card
      data-dashboard-card={layered ? "layered" : "flat"}
      size="sm"
      className={cn(
        "gap-0 py-0",
        layered && "bg-popover/70 p-2 ring-border/80",
        className
      )}
    >
      <div
        data-dashboard-card-plane="secondary"
        className={cn(
          "flex items-center justify-between gap-3",
          layered ? "px-3 pt-1 pb-3" : "px-5 pt-4 pb-3"
        )}
      >
        <h2 className="card-label">{title}</h2>
        {action ? (
          <Link
            href={action.href}
            className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {action.label}
            <ChevronRight className="size-3.5" />
          </Link>
        ) : null}
      </div>
      <div
        data-dashboard-card-plane="primary"
        className={cn(
          layered
            ? "relative flex flex-col gap-2 overflow-hidden rounded-[min(var(--radius-3xl),20px)] border border-border bg-card/95 p-4 shadow-sm ring-1 ring-foreground/5"
            : "px-5 pb-5",
          contentClassName
        )}
      >
        {children}
      </div>
    </Card>
  );
}
