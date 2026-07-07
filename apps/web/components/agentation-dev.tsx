"use client";

import dynamic from "next/dynamic";

// Dev-only visual annotation toolbar (agentation.com): click elements in the
// running app to annotate; feedback flows to the coding agent via the
// agentation MCP server. ssr:false keeps it out of server rendering entirely
// (same pattern as the sonner toaster workaround).
const Agentation = dynamic(() => import("agentation").then((m) => m.Agentation), { ssr: false });

export function AgentationDev() {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return <Agentation />;
}
