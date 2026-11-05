import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  // Sits beside the title, e.g. a status badge.
  meta?: ReactNode;
  title: ReactNode;
}

// The one page header every top-level screen uses, so titles land in the same
// place and size wherever the sidebar takes you.
export function PageHeader({ actions, className, description, meta, title }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-3", className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          {typeof title === "string" ? <h1 className="app-page-title">{title}</h1> : title}
          {meta}
        </div>
        {description ? <p className="app-page-description">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

// Shared outer frame for top-level pages: one max width, one gutter scale.
export const pageFrameClassName = "mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-5 md:px-6 lg:px-8";
