"use client";

import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import * as React from "react";
import {
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger
} from "@/components/motion/popover";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  groupAgentConversationsByDate,
  type AgentConversationSummary
} from "@/lib/agent-conversations";
import { EASE_SMOOTH_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

const rowTransition = {
  duration: 0.35,
  ease: EASE_SMOOTH_OUT,
  layout: { duration: 0.35, ease: EASE_SMOOTH_OUT }
} as const;

// The chat list lives in the agent panel (its History view), not the app
// sidebar, so it uses plain list markup rather than the sidebar primitives.

export interface AgentChatHistoryProps {
  activeConversationId: string | null;
  busyConversationId: string | null;
  conversations: AgentConversationSummary[];
  insertedConversationId: string | null;
  loading: boolean;
  onDeleteConversation: (id: string) => Promise<void>;
  onOpenConversation: (id: string) => Promise<void> | void;
  onRenameConversation: (id: string, title: string) => Promise<void>;
}

export function AgentChatHistory({
  activeConversationId,
  busyConversationId,
  conversations,
  insertedConversationId,
  loading,
  onDeleteConversation,
  onOpenConversation,
  onRenameConversation
}: AgentChatHistoryProps) {
  const reduce = useReducedMotion();

  if (loading) {
    return <AgentChatHistorySkeleton />;
  }

  if (conversations.length === 0) {
    return <p className="px-3 py-6 text-center text-sm text-muted-foreground">No chats yet. Ask Koban something to start one.</p>;
  }

  const groups = groupAgentConversationsByDate(conversations);

  return (
    <div className="flex flex-col gap-2" data-testid="agent-chat-history">
        <LazyMotion features={domAnimation}>
          <AnimatePresence initial={false} mode="popLayout">
            {groups.map((group) => {
              const groupKey = group.label.toLowerCase().replace(/\s+/g, "-");

              return (
                <m.section
                  aria-labelledby={`agent-chat-group-${groupKey}`}
                  key={group.label}
                  layout={reduce ? false : "position"}
                  transition={reduce ? { duration: 0 } : rowTransition}
                >
                  <h3
                    className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                    id={`agent-chat-group-${groupKey}`}
                  >
                    {group.label}
                  </h3>
                  <ul className="flex flex-col gap-0.5">
                    <AnimatePresence initial={insertedConversationId !== null} mode="popLayout">
                      {group.conversations.map((conversation) => {
                        const inserted = conversation.id === insertedConversationId;

                        return (
                          <ConversationRow
                            active={conversation.id === activeConversationId}
                            busy={conversation.id === busyConversationId}
                            conversation={conversation}
                            inserted={inserted}
                            key={conversation.id}
                            onDeleteConversation={onDeleteConversation}
                            onOpenConversation={onOpenConversation}
                            onRenameConversation={onRenameConversation}
                            reduce={Boolean(reduce)}
                          />
                        );
                      })}
                    </AnimatePresence>
                  </ul>
                </m.section>
              );
            })}
          </AnimatePresence>
        </LazyMotion>
    </div>
  );
}

function AgentChatHistorySkeleton() {
  const reduce = useReducedMotion();
  const widths = ["78%", "64%", "86%", "58%"];

  return (
    <div aria-busy="true" data-testid="agent-chat-history-loading">
        <LazyMotion features={domAnimation}>
          <ul aria-label="Loading chats">
            {widths.map((width, index) => (
              <li className="flex h-11 items-center px-3" key={width}>
                <span
                  className="relative block h-3 overflow-hidden rounded-full bg-muted"
                  style={{ width }}
                >
                  {!reduce ? (
                    <m.span
                      animate={{ x: ["-110%", "210%"] }}
                      aria-hidden="true"
                      className="absolute inset-0 bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--foreground)_10%,transparent),transparent)]"
                      initial={false}
                      transition={{
                        delay: index * 0.07,
                        duration: 1.25,
                        ease: "linear",
                        repeat: Number.POSITIVE_INFINITY
                      }}
                    />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </LazyMotion>
    </div>
  );
}

function ConversationRow({
  active,
  busy,
  conversation,
  inserted,
  onDeleteConversation,
  onOpenConversation,
  onRenameConversation,
  reduce
}: {
  active: boolean;
  busy: boolean;
  conversation: AgentConversationSummary;
  inserted: boolean;
  onDeleteConversation: AgentChatHistoryProps["onDeleteConversation"];
  onOpenConversation: AgentChatHistoryProps["onOpenConversation"];
  onRenameConversation: AgentChatHistoryProps["onRenameConversation"];
  reduce: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const committingRef = React.useRef(false);
  const renameCancelledRef = React.useRef(false);
  const renameFinishedRef = React.useRef(false);
  const menuTriggerId = React.useId();
  const renameErrorId = React.useId();
  const [deleteError, setDeleteError] = React.useState("");
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [draft, setDraft] = React.useState(conversation.title);
  const [editing, setEditing] = React.useState(false);
  const [committing, setCommitting] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [renameError, setRenameError] = React.useState("");

  React.useEffect(() => {
    if (!editing) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  function startRename() {
    renameCancelledRef.current = false;
    renameFinishedRef.current = false;
    setDraft(conversation.title);
    setRenameError("");
    setMenuOpen(false);
    setEditing(true);
  }

  function cancelRename() {
    renameCancelledRef.current = true;
    setDraft(conversation.title);
    setRenameError("");
    setEditing(false);
  }

  async function commitRename() {
    if (
      committingRef.current ||
      renameCancelledRef.current ||
      renameFinishedRef.current
    ) {
      return;
    }

    const title = draft.trim().replace(/\s+/g, " ");

    if (!title) {
      setRenameError("Enter a conversation title.");
      return;
    }

    if (title === "New chat") {
      setRenameError('Choose a title other than "New chat".');
      return;
    }

    if (title === conversation.title) {
      renameFinishedRef.current = true;
      setEditing(false);
      return;
    }

    committingRef.current = true;
    setCommitting(true);
    setRenameError("");

    try {
      await onRenameConversation(conversation.id, title);
      renameFinishedRef.current = true;
      setEditing(false);
    } catch {
      setRenameError("Could not rename this conversation. Try again.");
    } finally {
      committingRef.current = false;
      setCommitting(false);
    }
  }

  async function deleteConversation() {
    if (deleting) {
      return;
    }

    setDeleting(true);
    setDeleteError("");

    try {
      await onDeleteConversation(conversation.id);
      setDeleteOpen(false);
    } catch {
      setDeleteError("Could not delete this conversation. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <m.li
        animate={{ filter: "blur(0px)", height: "auto", opacity: 1, y: 0 }}
        className="group/chat-row relative overflow-hidden"
        data-conversation-id={conversation.id}
        data-testid="agent-chat-row"
        exit={
          reduce
            ? { opacity: 0 }
            : { filter: "blur(6px)", height: 0, opacity: 0, y: -4 }
        }
        initial={
          reduce || !inserted
            ? false
            : { filter: "blur(6px)", height: 0, opacity: 0, y: -6 }
        }
        layout={reduce ? false : "position"}
        onContextMenu={(event) => {
          if (editing) {
            return;
          }

          event.preventDefault();
          setMenuOpen(true);
        }}
        transition={reduce ? { duration: 0 } : rowTransition}
      >
        {editing ? (
          <form
            className="relative px-1 py-1"
            onSubmit={(event) => {
              event.preventDefault();
              void commitRename();
            }}
          >
            <Input
              aria-describedby={renameError ? renameErrorId : undefined}
              aria-invalid={renameError ? true : undefined}
              aria-label={`Rename ${conversation.title}`}
              className="h-9 rounded-xl pr-2 text-sm"
              disabled={committing}
              maxLength={120}
              onBlur={() => void commitRename()}
              onChange={(event) => {
                setDraft(event.target.value);
                if (renameError) {
                  setRenameError("");
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  if (committing) {
                    return;
                  }
                  event.preventDefault();
                  cancelRename();
                }
              }}
              ref={inputRef}
              value={draft}
            />
            {renameError ? (
              <p className="px-2 pt-1 text-2xs leading-tight text-destructive" id={renameErrorId} role="alert">
                {renameError}
              </p>
            ) : null}
          </form>
        ) : (
          <>
            <button
              aria-current={active ? "true" : undefined}
              aria-label={`Open chat ${conversation.title}`}
              className={cn(
                "flex h-11 w-full min-w-0 items-center rounded-xl pr-11 pl-3 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none",
                active && "bg-muted font-medium"
              )}
              data-sound="none"
              onClick={() => void onOpenConversation(conversation.id)}
              type="button"
            >
              <ConversationTitle reduce={reduce} title={conversation.title} />
            </button>

            {busy ? (
              <span
                aria-label={`${conversation.title} is responding`}
                className="pointer-events-none absolute top-1/2 right-3.5 z-10 -translate-y-1/2 text-muted-foreground opacity-100 transition-opacity group-focus-within/chat-row:opacity-0 group-hover/chat-row:opacity-0 motion-reduce:transition-none"
                role="status"
              >
                <Spinner decorative size="sm" variant="ring" />
              </span>
            ) : null}

            <Popover
              onOpenChange={setMenuOpen}
              open={menuOpen}
              triggerId={menuOpen ? menuTriggerId : null}
            >
              <PopoverTrigger
                id={menuTriggerId}
                render={
                  <button
                    aria-label={`Actions for ${conversation.title}`}
                    className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover/chat-row:opacity-100 aria-expanded:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
                    data-sound="none"
                    onClick={(event) => event.stopPropagation()}
                    type="button"
                  >
                    <Ellipsis className="size-4" />
                  </button>
                }
              />
              <ConversationActionsMenu
                onDelete={() => {
                  setMenuOpen(false);
                  setDeleteError("");
                  setDeleteOpen(true);
                }}
                onRename={startRename}
              />
            </Popover>
          </>
        )}
      </m.li>

      <Dialog
        onOpenChange={(open) => {
          if (!deleting) {
            setDeleteOpen(open);
            if (!open) {
              setDeleteError("");
            }
          }
        }}
        open={deleteOpen}
      >
        <DialogContent className="sm:max-w-sm" showCloseButton={!deleting}>
          <DialogHeader>
            <DialogTitle>Delete conversation?</DialogTitle>
            <DialogDescription>
              “{conversation.title}” and its messages will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p className="text-sm text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              data-testid="confirm-delete-chat"
              disabled={deleting}
              onClick={() => void deleteConversation()}
              type="button"
              variant="destructive"
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConversationTitle({ reduce, title }: { reduce: boolean; title: string }) {
  return (
    <span className="relative block min-w-0 flex-1 overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        <m.span
          animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
          className="block truncate"
          exit={reduce ? { opacity: 0 } : { filter: "blur(5px)", opacity: 0, y: -2 }}
          initial={reduce ? false : { filter: "blur(5px)", opacity: 0, y: 2 }}
          key={title}
          transition={reduce ? { duration: 0 } : { duration: 0.2, ease: EASE_SMOOTH_OUT }}
        >
          {title}
        </m.span>
      </AnimatePresence>
    </span>
  );
}

function ConversationActionsMenu({
  onDelete,
  onRename
}: {
  onDelete: () => void;
  onRename: () => void;
}) {
  return (
    <PopoverPortal>
      <PopoverPositioner align="end" className="isolate z-[60]" side="bottom" sideOffset={4}>
        <PopoverPopup
          aria-label="Conversation actions"
          className="relative z-50 w-36 overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/5 outline-none dark:ring-foreground/10"
        >
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted motion-reduce:transition-none"
            data-sound="none"
            onClick={onRename}
            type="button"
          >
            <Pencil className="size-3.5 text-muted-foreground" />
            Rename
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10 motion-reduce:transition-none"
            data-sound="none"
            onClick={onDelete}
            type="button"
          >
            <Trash2 className="size-3.5" />
            Delete
          </button>
        </PopoverPopup>
      </PopoverPositioner>
    </PopoverPortal>
  );
}
