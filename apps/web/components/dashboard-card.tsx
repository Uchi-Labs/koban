import { ChevronRight } from "lucide-react";
import Link from "next/link";
import React from "react";
import {
  Card as IconiqCard,
  CardAction as IconiqCardAction,
  CardContent as IconiqCardContent,
  CardHeader as IconiqCardHeader,
  CardTitle as IconiqCardTitle
} from "@/components/ui/iconiq-card";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function DashboardCard({
  action,
  children,
  className = "",
  contentClassName,
  layered = true,
  surface,
  title
}: {
  action?: { href: string; label: string };
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  layered?: boolean;
  surface: "iconiq" | "legacy";
  title: string;
}) {
  if (surface === "legacy") {
    return (
      <Card
        className={cn(
          "gap-0 py-0",
          layered && "bg-popover/70 p-2 ring-border/80",
          className
        )}
        data-dashboard-card={layered ? "layered" : "flat"}
        size="sm"
      >
        <div
          className={cn(
            "flex items-center justify-between gap-3",
            layered ? "px-3 pt-1 pb-3" : "px-5 pt-4 pb-3"
          )}
          data-dashboard-card-plane="secondary"
        >
          <h2 className="card-label">{title}</h2>
          {action ? <DashboardCardAction action={action} compact /> : null}
        </div>
        <div
          className={cn(
            layered
              ? "relative flex flex-col gap-2 overflow-hidden rounded-[min(var(--radius-3xl),20px)] border border-border bg-card/95 p-4 shadow-sm ring-1 ring-foreground/5"
              : "px-5 pb-5",
            contentClassName
          )}
          data-dashboard-card-plane="primary"
        >
          {children}
        </div>
      </Card>
    );
  }

  return (
    <IconiqCard
      data-dashboard-card={layered ? "layered" : "flat"}
      className={cn(
        "gap-0 rounded-xl py-0",
        layered
          ? "border-border/60 bg-card/95 shadow-[var(--ic-card-rest-shadow)]"
          : "border-border/45 bg-card/70 shadow-none",
        className
      )}
    >
      <IconiqCardHeader
        data-dashboard-card-plane="secondary"
        className={cn(
          "grid grid-cols-[1fr_auto] items-center gap-3 px-5",
          layered ? "min-h-12 py-2.5" : "pt-4 pb-3"
        )}
      >
        <IconiqCardTitle as="h2" className="card-label self-center text-sm leading-none">{title}</IconiqCardTitle>
        {action ? (
          <IconiqCardAction className="row-span-1 self-center">
            <DashboardCardAction action={action} />
          </IconiqCardAction>
        ) : null}
      </IconiqCardHeader>
      <IconiqCardContent
        data-dashboard-card-plane="primary"
        className={cn(
          "relative flex flex-col gap-2 px-5 pb-5",
          layered && "pt-4",
          contentClassName
        )}
      >
        {children}
      </IconiqCardContent>
    </IconiqCard>
  );
}

function DashboardCardAction({
  action,
  compact = false
}: {
  action: { href: string; label: string };
  compact?: boolean;
}) {
  return (
    <Link
      className={cn(
        "link-underline inline-flex min-h-10 items-center gap-0.5 px-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none",
        compact && "self-start"
      )}
      href={action.href}
    >
      {action.label}
      <ChevronRight className="size-3.5" />
    </Link>
  );
}
