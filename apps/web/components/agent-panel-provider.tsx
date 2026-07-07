"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";
import { AgentPanel } from "@/components/agent-panel";
import { useAgentStream } from "@/lib/hooks/use-agent-stream";

interface AgentPanelContextValue {
  closeAgent: () => void;
  open: boolean;
  openAgent: (prefill?: string) => void;
}

const AgentPanelContext = React.createContext<AgentPanelContextValue | null>(null);

export function AgentPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState("");
  const [requestId, setRequestId] = React.useState(0);
  const stream = useAgentStream();

  const openAgent = React.useCallback((nextPrefill = "") => {
    const question = nextPrefill.trim();

    setPrefill(nextPrefill);
    setRequestId((current) => current + 1);
    setOpen(true);

    if (question) {
      stream.ask(question);
    }
  }, [stream]);

  const closeAgent = React.useCallback(() => {
    setOpen(false);
  }, []);

  const value = React.useMemo<AgentPanelContextValue>(() => ({
    closeAgent,
    open,
    openAgent
  }), [closeAgent, open, openAgent]);

  return (
    <AgentPanelContext.Provider value={value}>
      <React.Suspense fallback={null}>
        <AgentPanelDeepLink />
      </React.Suspense>
      {children}
      <AgentPanel draftPrefill={prefill} key={requestId} onCloseAction={closeAgent} open={open} stream={stream} />
    </AgentPanelContext.Provider>
  );
}

export function useAgentPanel() {
  const context = React.use(AgentPanelContext);

  if (!context) {
    throw new Error("useAgentPanel must be used within AgentPanelProvider.");
  }

  return context;
}

function AgentPanelDeepLink() {
  const { openAgent } = useAgentPanel();
  const searchParams = useSearchParams();
  const handledRef = React.useRef(false);

  React.useEffect(() => {
    if (handledRef.current) {
      return;
    }

    const ask = searchParams.get("ask")?.trim();

    if (!ask) {
      return;
    }

    handledRef.current = true;
    openAgent(ask);
    stripAskParam();
  }, [openAgent, searchParams]);

  return null;
}

function stripAskParam() {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.delete("ask");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
