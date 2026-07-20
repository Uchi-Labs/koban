"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";
import { AgentPanel } from "@/components/agent-panel";
import type {
  AgentConversationDetail,
  AgentConversationListResponse,
  AgentConversationSummary,
  AgentConversationTurnSummary
} from "@/lib/agent-conversations";
import { useAgentStream } from "@/lib/hooks/use-agent-stream";

interface AgentPanelContextValue {
  activeConversationId: string | null;
  busyConversationId: string | null;
  closeAgent: () => void;
  conversations: AgentConversationSummary[];
  conversationsLoading: boolean;
  deleteConversation: (id: string) => Promise<void>;
  insertedConversationId: string | null;
  open: boolean;
  openAgent: (prefill?: string) => void;
  openConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  startNewConversation: () => void;
}

interface AgentRun {
  conversationId: string | null;
  epoch: number;
  id: number;
  question: string;
  shouldTitle: boolean;
  terminalConsumed: boolean;
  userTurn: AgentConversationTurnSummary | null;
}

type ConversationWriteTails = Map<string, Promise<void>>;

const AgentPanelContext = React.createContext<AgentPanelContextValue | null>(null);

export function AgentPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState("");
  const [requestId, setRequestId] = React.useState(0);
  const [conversations, setConversations] = React.useState<AgentConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = React.useState(true);
  const [activeConversationId, setActiveConversationId] = React.useState<string | null>(null);
  const [turns, setTurns] = React.useState<AgentConversationTurnSummary[]>([]);
  const [conversationLoading, setConversationLoading] = React.useState(false);
  const [requestStarting, setRequestStarting] = React.useState(false);
  const [savingAssistant, setSavingAssistant] = React.useState(false);
  const [busyConversationId, setBusyConversationId] = React.useState<string | null>(null);
  const [insertedConversationId, setInsertedConversationId] = React.useState<string | null>(null);
  const [persistenceError, setPersistenceError] = React.useState("");
  const stream = useAgentStream();
  const activeConversationIdRef = React.useRef<string | null>(null);
  const activeRunRef = React.useRef<AgentRun | null>(null);
  const sessionEpochRef = React.useRef(0);
  const runSequenceRef = React.useRef(0);
  const loadSequenceRef = React.useRef(0);
  const mutationVersionsRef = React.useRef(new Map<string, number>());
  const untitledConversationIdsRef = React.useRef(new Set<string>());
  const deletingConversationIdsRef = React.useRef(new Set<string>());
  const deletedConversationIdsRef = React.useRef(new Set<string>());
  const titleRequestsRef = React.useRef(new Map<string, Promise<boolean>>());
  const busyRunIdRef = React.useRef<number | null>(null);
  const writeTailsRef = React.useRef<ConversationWriteTails>(new Map());

  React.useEffect(() => {
    const controller = new AbortController();

    void requestJson<AgentConversationListResponse>("/api/v1/conversations", {
      signal: controller.signal
    })
      .then((body) => {
        const available = body.data.filter(
          (conversation) => !deletedConversationIdsRef.current.has(conversation.id)
        );

        setConversations((current) => {
          const currentIds = new Set(current.map((conversation) => conversation.id));

          for (const conversation of available) {
            if (currentIds.has(conversation.id)) {
              continue;
            }

            if (conversation.title === "New chat") {
              untitledConversationIdsRef.current.add(conversation.id);
            } else {
              untitledConversationIdsRef.current.delete(conversation.id);
            }
          }

          return mergeConversationLists(available, current);
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setPersistenceError(errorMessage(error, "Chats could not be loaded."));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setConversationsLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  const resetView = React.useCallback(() => {
    sessionEpochRef.current += 1;
    loadSequenceRef.current += 1;
    activeRunRef.current = null;
    busyRunIdRef.current = null;
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setBusyConversationId(null);
    setConversationLoading(false);
    setPersistenceError("");
    setPrefill("");
    setRequestId((current) => current + 1);
    setRequestStarting(false);
    setSavingAssistant(false);
    setTurns([]);
    stream.reset();
    setOpen(true);
  }, [stream]);

  const askConversation = React.useCallback(async (rawQuestion: string) => {
    const question = rawQuestion.trim();

    if (!question || activeRunRef.current) {
      return;
    }

    const run: AgentRun = {
      conversationId: activeConversationIdRef.current,
      epoch: sessionEpochRef.current,
      id: runSequenceRef.current + 1,
      question,
      shouldTitle: activeConversationIdRef.current
        ? untitledConversationIdsRef.current.has(activeConversationIdRef.current)
        : false,
      terminalConsumed: false,
      userTurn: null
    };
    runSequenceRef.current = run.id;
    activeRunRef.current = run;
    setRequestStarting(true);
    setPersistenceError("");

    let createdConversationId: string | null = null;

    try {
      let conversationId = run.conversationId;

      if (!conversationId) {
        const created = await requestJson<AgentConversationSummary>("/api/v1/conversations", {
          body: "{}",
          headers: { "content-type": "application/json" },
          method: "POST"
        });
        conversationId = created.id;
        createdConversationId = created.id;
        run.conversationId = created.id;
        run.shouldTitle = true;
        untitledConversationIdsRef.current.add(created.id);
        setInsertedConversationId(created.id);
        window.setTimeout(() => {
          setInsertedConversationId((current) => current === created.id ? null : current);
        }, 500);
        setConversations((current) => [
          { ...created, title: conversationPreviewTitle(question) },
          ...current.filter((conversation) => conversation.id !== created.id)
        ]);

        if (isCurrentRun(activeRunRef, run)) {
          activeConversationIdRef.current = created.id;
          setActiveConversationId(created.id);
        }
      }

      const userTurn = await enqueueConversationWrite(
        writeTailsRef.current,
        conversationId,
        () => requestJson<AgentConversationTurnSummary>(
          `/api/v1/conversations/${encodeURIComponent(conversationId)}/turns`,
          {
            body: JSON.stringify({ content: question, role: "user" }),
            headers: { "content-type": "application/json" },
            method: "POST"
          }
        )
      );
      run.userTurn = userTurn;
      setConversations((current) => bumpConversation(current, conversationId, userTurn.created_at));

      if (!isCurrentRun(activeRunRef, run)) {
        if (createdConversationId && activeConversationIdRef.current !== createdConversationId) {
          deletingConversationIdsRef.current.add(createdConversationId);
          try {
            await requestJson(`/api/v1/conversations/${encodeURIComponent(createdConversationId)}`, {
              method: "DELETE"
            });
            setConversations((current) => current.filter((conversation) => conversation.id !== createdConversationId));
            untitledConversationIdsRef.current.delete(createdConversationId);
            deletedConversationIdsRef.current.add(createdConversationId);
          } catch {
            // The stale view must stay stale even if cleanup is temporarily unavailable.
          } finally {
            deletingConversationIdsRef.current.delete(createdConversationId);
          }
        }
        return;
      }

      setBusyConversationId(conversationId);
      busyRunIdRef.current = run.id;
      setRequestStarting(false);
      stream.ask(question);
    } catch (error) {
      let cleanedCreatedConversation = false;
      const failureMessage = errorMessage(error, "This chat could not be saved.");

      if (createdConversationId) {
        deletingConversationIdsRef.current.add(createdConversationId);
        try {
          await requestJson(`/api/v1/conversations/${encodeURIComponent(createdConversationId)}`, {
            method: "DELETE"
          });
          setConversations((current) => current.filter((conversation) => conversation.id !== createdConversationId));
          untitledConversationIdsRef.current.delete(createdConversationId);
          deletedConversationIdsRef.current.add(createdConversationId);
          cleanedCreatedConversation = true;
        } catch {
          // The original persistence error is more actionable than cleanup failure.
        } finally {
          deletingConversationIdsRef.current.delete(createdConversationId);
        }
      }

      if (cleanedCreatedConversation && activeConversationIdRef.current === createdConversationId) {
        sessionEpochRef.current += 1;
        loadSequenceRef.current += 1;
        activeRunRef.current = null;
        busyRunIdRef.current = null;
        activeConversationIdRef.current = null;
        setActiveConversationId(null);
        setBusyConversationId(null);
        setConversationLoading(false);
        setRequestStarting(false);
        setSavingAssistant(false);
        setTurns([]);
        setPersistenceError(failureMessage);
        stream.reset();
      }

      if (isCurrentRun(activeRunRef, run)) {
        setRequestStarting(false);
        activeRunRef.current = null;
        busyRunIdRef.current = null;
        setBusyConversationId(null);
        if (cleanedCreatedConversation) {
          activeConversationIdRef.current = null;
          setActiveConversationId(null);
          setTurns([]);
        }
        setPersistenceError(failureMessage);
        stream.reset();
      }
    } finally {
      if (isCurrentRun(activeRunRef, run)) {
        setRequestStarting(false);
      }
    }
  }, [stream]);

  React.useEffect(() => {
    if (stream.status !== "done" && stream.status !== "error") {
      return;
    }

    const run = activeRunRef.current;

    if (!run || run.terminalConsumed || !run.conversationId || !run.userTurn) {
      return;
    }

    run.terminalConsumed = true;
    const conversationId = run.conversationId;
    const userTurn = run.userTurn;
    const answer = stream.answer;
    const meta = stream.meta;
    const failed = stream.status === "error" || !answer.trim();
    const titleMutationVersion = mutationVersionsRef.current.get(conversationId) ?? 0;
    if (failed) {
      if (isCurrentRun(activeRunRef, run)) {
        if (busyRunIdRef.current === run.id) {
          busyRunIdRef.current = null;
          setBusyConversationId((current) => current === conversationId ? null : current);
        }
        setTurns((current) => appendTurns(current, [userTurn]));
        setPersistenceError(
          stream.error || (answer.trim() ? "The finance agent could not finish this answer." : "The finance agent returned an empty answer.")
        );
        activeRunRef.current = null;
        stream.reset();
      }
      return;
    }

    setSavingAssistant(true);
    void enqueueConversationWrite(
      writeTailsRef.current,
      conversationId,
      () => requestJson<AgentConversationTurnSummary>(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}/turns`,
        {
          body: JSON.stringify({ content: answer, meta, role: "assistant" }),
          headers: { "content-type": "application/json" },
          method: "POST"
        }
      )
    )
      .then((assistantTurn) => {
        setConversations((current) => bumpConversation(current, conversationId, assistantTurn.created_at));

        if (isCurrentRun(activeRunRef, run)) {
          setTurns((current) => appendTurns(current, [userTurn, assistantTurn]));
          activeRunRef.current = null;
          setSavingAssistant(false);
          stream.reset();
        }

        const titleRequest = run.shouldTitle
          ? titleConversation(
              conversationId,
              titleMutationVersion,
              mutationVersionsRef,
              untitledConversationIdsRef,
              titleRequestsRef,
              setConversations
            )
          : Promise.resolve();

        void titleRequest.finally(() => {
          if (busyRunIdRef.current === run.id) {
            window.setTimeout(() => {
              if (busyRunIdRef.current === run.id) {
                busyRunIdRef.current = null;
                setBusyConversationId((current) => current === conversationId ? null : current);
              }
            }, 220);
          }
        });
      })
      .catch((error) => {
        if (busyRunIdRef.current === run.id) {
          busyRunIdRef.current = null;
          setBusyConversationId((current) => current === conversationId ? null : current);
        }
        if (isCurrentRun(activeRunRef, run)) {
          setTurns((current) => appendTurns(current, [userTurn]));
          setPersistenceError(errorMessage(error, "The answer finished, but its chat history could not be saved."));
          activeRunRef.current = null;
          setSavingAssistant(false);
          stream.reset();
        }
      });
  }, [stream.answer, stream.error, stream.meta, stream.reset, stream.status]);

  const startNewConversation = React.useCallback(() => {
    resetView();
  }, [resetView]);

  const openAgent = React.useCallback((nextPrefill = "") => {
    const question = nextPrefill.trim();

    if (!question) {
      setOpen(true);
      return;
    }

    resetView();
    setPrefill(question);
    void askConversation(question);
  }, [askConversation, resetView]);

  const openConversation = React.useCallback(async (id: string) => {
    if (!id) {
      return;
    }

    if (deletingConversationIdsRef.current.has(id) || deletedConversationIdsRef.current.has(id)) {
      return;
    }

    if (id === activeConversationIdRef.current) {
      setOpen(true);
      return;
    }

    sessionEpochRef.current += 1;
    const epoch = sessionEpochRef.current;
    const loadMutationVersion = mutationVersionsRef.current.get(id) ?? 0;
    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    activeRunRef.current = null;
    busyRunIdRef.current = null;
    activeConversationIdRef.current = id;
    setActiveConversationId(id);
    setBusyConversationId(null);
    setConversationLoading(true);
    setPersistenceError("");
    setPrefill("");
    setRequestId((current) => current + 1);
    setRequestStarting(false);
    setSavingAssistant(false);
    setTurns([]);
    stream.reset();
    setOpen(true);

    try {
      await writeTailsRef.current.get(id)?.catch(() => undefined);
      const conversation = await requestJson<AgentConversationDetail>(
        `/api/v1/conversations/${encodeURIComponent(id)}`
      );

      if (
        loadSequenceRef.current !== loadSequence ||
        sessionEpochRef.current !== epoch ||
        activeConversationIdRef.current !== id
      ) {
        return;
      }

      setTurns(conversation.turns);
      if ((mutationVersionsRef.current.get(id) ?? 0) === loadMutationVersion) {
        setConversations((current) => replaceConversation(current, conversation));
      }
    } catch (error) {
      if (loadSequenceRef.current === loadSequence && sessionEpochRef.current === epoch) {
        activeConversationIdRef.current = null;
        setActiveConversationId(null);
        setTurns([]);
        setPersistenceError(errorMessage(error, "This chat could not be opened."));
      }
    } finally {
      if (loadSequenceRef.current === loadSequence && sessionEpochRef.current === epoch) {
        setConversationLoading(false);
      }
    }
  }, [stream]);

  const renameConversation = React.useCallback(async (id: string, rawTitle: string) => {
    const title = rawTitle.trim().replace(/\s+/g, " ");

    if (!title || title === "New chat") {
      throw new Error(title === "New chat" ? "Choose a title other than New chat." : "Enter a chat title.");
    }

    mutationVersionsRef.current.set(id, (mutationVersionsRef.current.get(id) ?? 0) + 1);
    const renamed = await requestJson<AgentConversationSummary>(
      `/api/v1/conversations/${encodeURIComponent(id)}`,
      {
        body: JSON.stringify({ title }),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      }
    );
    untitledConversationIdsRef.current.delete(id);
    setConversations((current) => replaceAndBumpConversation(current, renamed));
  }, []);

  const deleteConversation = React.useCallback(async (id: string) => {
    const run = activeRunRef.current;

    if (busyConversationId === id || run?.conversationId === id) {
      throw new Error("Wait for this answer to finish before deleting the chat.");
    }

    deletingConversationIdsRef.current.add(id);
    try {
      await requestJson(`/api/v1/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
    } finally {
      deletingConversationIdsRef.current.delete(id);
    }
    mutationVersionsRef.current.set(id, (mutationVersionsRef.current.get(id) ?? 0) + 1);
    untitledConversationIdsRef.current.delete(id);
    deletedConversationIdsRef.current.add(id);
    setConversations((current) => current.filter((conversation) => conversation.id !== id));

    if (activeConversationIdRef.current === id) {
      sessionEpochRef.current += 1;
      loadSequenceRef.current += 1;
      activeConversationIdRef.current = null;
      activeRunRef.current = null;
      busyRunIdRef.current = null;
      setActiveConversationId(null);
      setConversationLoading(false);
      setTurns([]);
      setPersistenceError("");
      setPrefill("");
      setRequestId((current) => current + 1);
      stream.reset();
    }
  }, [busyConversationId, stream]);

  const closeAgent = React.useCallback(() => {
    setOpen(false);
  }, []);

  const value = React.useMemo<AgentPanelContextValue>(() => ({
    activeConversationId,
    busyConversationId,
    closeAgent,
    conversations,
    conversationsLoading,
    deleteConversation,
    insertedConversationId,
    open,
    openAgent,
    openConversation,
    renameConversation,
    startNewConversation
  }), [
    activeConversationId,
    busyConversationId,
    closeAgent,
    conversations,
    conversationsLoading,
    deleteConversation,
    insertedConversationId,
    open,
    openAgent,
    openConversation,
    renameConversation,
    startNewConversation
  ]);

  return (
    <AgentPanelContext.Provider value={value}>
      <React.Suspense fallback={null}>
        <AgentPanelDeepLink />
      </React.Suspense>
      {children}
      <AgentPanel
        conversationLoading={conversationLoading}
        draftPrefill={prefill}
        key={requestId}
        onAskAction={(question) => void askConversation(question)}
        onCloseAction={closeAgent}
        open={open}
        persistenceError={persistenceError}
        stream={stream}
        submitting={conversationLoading || requestStarting || savingAssistant || stream.status === "streaming"}
        turns={turns}
      />
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

function isCurrentRun(
  activeRunRef: React.RefObject<AgentRun | null>,
  run: AgentRun
) {
  return activeRunRef.current?.id === run.id && activeRunRef.current.epoch === run.epoch;
}

async function enqueueConversationWrite<T>(
  tails: ConversationWriteTails,
  conversationId: string,
  write: () => Promise<T>
) {
  const previous = tails.get(conversationId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(write);
  const tail = result.then(() => undefined, () => undefined);
  tails.set(conversationId, tail);

  try {
    return await result;
  } finally {
    if (tails.get(conversationId) === tail) {
      tails.delete(conversationId);
    }
  }
}

async function titleConversation(
  conversationId: string,
  mutationVersion: number,
  mutationVersionsRef: React.RefObject<Map<string, number>>,
  untitledConversationIdsRef: React.RefObject<Set<string>>,
  titleRequestsRef: React.RefObject<Map<string, Promise<boolean>>>,
  setConversations: React.Dispatch<React.SetStateAction<AgentConversationSummary[]>>
): Promise<boolean> {
  const inFlight = titleRequestsRef.current.get(conversationId);

  if (inFlight) {
    return inFlight.then((succeeded) => succeeded
      ? true
      : titleConversation(
          conversationId,
          mutationVersion,
          mutationVersionsRef,
          untitledConversationIdsRef,
          titleRequestsRef,
          setConversations
        ));
  }

  const request = (async () => {
    try {
      const titled = await requestJson<AgentConversationSummary>(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}/title`,
        { body: "{}", headers: { "content-type": "application/json" }, method: "POST" }
      );

      if ((mutationVersionsRef.current.get(conversationId) ?? 0) === mutationVersion) {
        mutationVersionsRef.current.set(conversationId, mutationVersion + 1);
        setConversations((current) => replaceAndBumpConversation(current, titled));
      }
      untitledConversationIdsRef.current.delete(conversationId);
      return true;
    } catch {
      // The optimistic question title remains usable; a later eligible run retries.
      return false;
    }
  })();
  const tracked = request.finally(() => {
    if (titleRequestsRef.current.get(conversationId) === tracked) {
      titleRequestsRef.current.delete(conversationId);
    }
  });
  titleRequestsRef.current.set(conversationId, tracked);
  return tracked;
}

async function requestJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    let message = "Request failed.";

    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error) {
        message = body.error;
      }
    } catch {
      // Keep the generic message when the route did not return JSON.
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

function conversationPreviewTitle(question: string) {
  return question.replace(/\s+/g, " ").trim().slice(0, 32);
}

function appendTurns(
  current: AgentConversationTurnSummary[],
  additions: AgentConversationTurnSummary[]
) {
  const existing = new Set(current.map((turn) => turn.id));
  return [...current, ...additions.filter((turn) => !existing.has(turn.id))];
}

function mergeConversationLists(
  server: AgentConversationSummary[],
  current: AgentConversationSummary[]
) {
  const merged = new Map(server.map((conversation) => [conversation.id, conversation]));

  for (const conversation of current) {
    const serverConversation = merged.get(conversation.id);
    const serverUpdatedAt = serverConversation ? Date.parse(serverConversation.updated_at) : Number.NEGATIVE_INFINITY;
    const currentUpdatedAt = Date.parse(conversation.updated_at);

    if (!serverConversation || !Number.isFinite(serverUpdatedAt) || currentUpdatedAt >= serverUpdatedAt) {
      merged.set(conversation.id, conversation);
    }
  }

  return [...merged.values()].sort((left, right) => {
    const byUpdatedAt = Date.parse(right.updated_at) - Date.parse(left.updated_at);
    return byUpdatedAt || right.id.localeCompare(left.id);
  });
}

function replaceConversation(
  current: AgentConversationSummary[],
  conversation: AgentConversationSummary
) {
  return current.map((item) => item.id === conversation.id ? { ...item, ...conversation } : item);
}

function replaceAndBumpConversation(
  current: AgentConversationSummary[],
  conversation: AgentConversationSummary
) {
  return [conversation, ...current.filter((item) => item.id !== conversation.id)];
}

function bumpConversation(current: AgentConversationSummary[], id: string, updatedAt: string) {
  const conversation = current.find((item) => item.id === id);

  if (!conversation) {
    return current;
  }

  return [
    { ...conversation, updated_at: updatedAt },
    ...current.filter((item) => item.id !== id)
  ];
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
