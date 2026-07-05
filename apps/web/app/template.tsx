"use client";

import { useEffect, useRef } from "react";

/*
 * Re-mounts on every route navigation (Next.js template semantics), giving a
 * page-level entrance: fade + 6px rise with a whisper of blur. Motion tokens
 * from shadcn.css; disabled for prefers-reduced-motion via the CSS guard.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.setAttribute("data-entered", "true");
  }, []);

  return (
    <div className="page-enter min-h-svh" ref={ref}>
      {children}
    </div>
  );
}
