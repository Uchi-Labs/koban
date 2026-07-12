"use client";

import { Check, Copy, CopyCheck, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type RefObject } from "react";
import { ActionSwapCascadeIcon, ActionSwapCascadeText } from "@/components/ui/action-swap-cascade";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader } from "@/components/ui/loader";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useShakeReplay } from "@/lib/transitions";
import { cn } from "@/lib/utils";

const apiTokenDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short"
});

interface ApiTokensPanelProps {
  hostedAuth: boolean;
}

interface ApiKeyRecord {
  createdAt?: string | Date;
  enabled?: boolean;
  expiresAt?: string | Date | null;
  id: string;
  lastRequest?: string | Date | null;
  name?: string | null;
  start?: string | null;
}

interface ApiKeyListResponse {
  apiKeys?: ApiKeyRecord[];
}

interface ApiKeyCreateResponse extends ApiKeyRecord {
  key?: string;
}

export function ApiTokensPanel({ hostedAuth }: ApiTokensPanelProps) {
  const [copiedToken, setCopiedToken] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [name, setName] = useState("");
  const [nameErrorKey, setNameErrorKey] = useState(0);
  const [tokens, setTokens] = useState<ApiKeyRecord[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const { showToast, updateToast } = useToast();
  const nameError = nameErrorKey > 0 && name.trim().length === 0;
  const nameShake = useShakeReplay(nameErrorKey);

  const canCreate = useMemo(() => hostedAuth && name.trim().length > 0 && !isCreating, [hostedAuth, isCreating, name]);

  const loadTokens = useCallback(async () => {
    if (!hostedAuth) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/better-auth/api-key/list?sortBy=createdAt&sortDirection=desc", {
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error("API tokens could not be loaded.");
      }

      const payload = (await response.json()) as ApiKeyListResponse;
      setTokens(Array.isArray(payload.apiKeys) ? payload.apiKeys : []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "API tokens could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [hostedAuth]);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canCreate) {
      if (hostedAuth && name.trim().length === 0) {
        setErrorMessage("Name is required.");
        setNameErrorKey((current) => current + 1);
      }
      return;
    }

    setIsCreating(true);
    setCreatedToken(null);
    setErrorMessage(null);
    const toastId = showToast({
      description: `Creating token "${name.trim()}".`,
      duration: 0,
      status: "loading",
      title: "Creating API token",
    });

    try {
      const response = await fetch("/api/better-auth/api-key/create", {
        body: JSON.stringify({ name: name.trim() }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });

      if (!response.ok) {
        throw new Error("API token could not be created.");
      }

      const payload = (await response.json()) as ApiKeyCreateResponse;

      if (!payload.key) {
        throw new Error("API token response did not include a key.");
      }

      setCreatedToken(payload.key);
      setCopiedToken(false);
      setName("");
      await loadTokens();
      updateToast(toastId, {
        description: "The API token was created. Copy it from the access panel.",
        duration: 5200,
        status: "success",
        title: "API token created",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "API token could not be created.";
      setErrorMessage(message);
      updateToast(toastId, {
        description: message,
        duration: 5200,
        status: "error",
        title: "API token failed",
      });
    } finally {
      setIsCreating(false);
    }
  }

  async function copyCreatedToken() {
    if (!createdToken) {
      return;
    }

    await navigator.clipboard.writeText(createdToken);
    setCopiedToken(true);
    window.setTimeout(() => setCopiedToken(false), 1600);
  }

  async function revokeToken(keyId: string) {
    setRevokingId(keyId);
    setErrorMessage(null);
    const token = tokens.find((candidate) => candidate.id === keyId);
    const toastId = showToast({
      description: token?.name ? `Revoking "${token.name}".` : "Revoking API token.",
      duration: 0,
      status: "loading",
      title: "Revoking API token",
    });

    try {
      const response = await fetch("/api/better-auth/api-key/delete", {
        body: JSON.stringify({ keyId }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });

      if (!response.ok) {
        throw new Error("API token could not be revoked.");
      }

      await loadTokens();
      updateToast(toastId, {
        description: "The API token was revoked.",
        duration: 3600,
        status: "success",
        title: "API token revoked",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "API token could not be revoked.";
      setErrorMessage(message);
      updateToast(toastId, {
        description: message,
        duration: 5200,
        status: "error",
        title: "API token revoke failed",
      });
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary" aria-hidden="true" />
              API tokens
            </CardTitle>
            <CardDescription>Bearer access for agents, MCP, and direct API calls.</CardDescription>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={loadTokens} disabled={!hostedAuth || isLoading}>
            {isLoading ? <Loader className="size-4" label="Refreshing API tokens" size={16} /> : <RefreshCw className="size-4" aria-hidden="true" />}
            <span className="sr-only">Refresh API tokens</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        {hostedAuth ? (
          <>
            <form
              className={cn(
                "t-input-wrap grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end",
                nameError && "is-error"
              )}
              onSubmit={createToken}
            >
              <div className="grid gap-2">
                <Label htmlFor="api-token-name">Name</Label>
                <Input
                  aria-invalid={nameError}
                  className={cn("t-input", nameError && "is-error", nameShake.shaking && "is-shaking")}
                  id="api-token-name"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  maxLength={32}
                  placeholder="MCP workstation"
                  autoComplete="off"
                  ref={nameShake.ref as RefObject<HTMLInputElement>}
                />
                <p className="t-error-msg text-xs text-destructive">Name is required.</p>
              </div>
              <Button type="submit" disabled={!canCreate}>
                {isCreating ? <Loader className="size-4" label="Creating API token" size={16} /> : <KeyRound className="size-4" aria-hidden="true" />}
                Create token
              </Button>
            </form>

            {createdToken ? (
              <div className="grid gap-2 rounded-md border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <Check className="size-4" aria-hidden="true" />
                  Token created
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <code className="block overflow-x-auto rounded-md bg-background px-3 py-2 text-xs tabular-nums text-foreground ring-1 ring-border">
                    {createdToken}
                  </code>
                  <Button onClick={() => void copyCreatedToken()} size="sm" type="button" variant="outline">
                    <ActionSwapCascadeIcon className="size-4" value={copiedToken ? "copied" : "copy"}>
                      {copiedToken ? <CopyCheck className="size-4" /> : <Copy className="size-4" />}
                    </ActionSwapCascadeIcon>
                    <ActionSwapCascadeText splitText={copiedToken ? "Copied" : "Copy"} value={copiedToken ? "copied" : "copy"}>
                      {copiedToken ? "Copied" : "Copy"}
                    </ActionSwapCascadeText>
                  </Button>
                </div>
              </div>
            ) : null}

            {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

            <Separator />

            <div className="grid gap-2">
              {isLoading ? (
                Array.from({ length: 3 }, (_, index) => (
                  <div className="grid gap-2 rounded-md border border-border bg-background p-3" key={index}>
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-56 max-w-full" />
                  </div>
                ))
              ) : tokens.length === 0 ? (
                <p className="text-sm text-muted-foreground">No API tokens.</p>
              ) : (
                tokens.map((token) => (
                  <div
                    key={token.id}
                    className="grid gap-3 rounded-md border border-border bg-background p-3 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{token.name || "Untitled token"}</p>
                        {token.enabled === false ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Disabled</span>
                        ) : null}
                      </div>
                      <dl className="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                        <TokenMeta label="Created" value={formatDate(token.createdAt)} />
                        <TokenMeta label="Last used" value={formatDate(token.lastRequest)} />
                        {token.start ? <TokenMeta label="Starts" value={token.start} /> : null}
                      </dl>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn("justify-self-start sm:justify-self-end")}
                      onClick={() => void revokeToken(token.id)}
                      disabled={revokingId === token.id}
                    >
                      {revokingId === token.id ? (
                        <Loader className="size-4" label="Revoking API token" size={16} />
                      ) : (
                        <Trash2 className="size-4" aria-hidden="true" />
                      )}
                      Revoke
                    </Button>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">API tokens are available in hosted mode.</p>
        )}
      </CardContent>
    </Card>
  );
}

function TokenMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1 tabular-nums">
      <dt>{label}:</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return apiTokenDateFormatter.format(date);
}
