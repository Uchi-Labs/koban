"use client";

import { ExternalLink, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ProviderStatusBadge } from "@/components/provider-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ProviderStatus } from "@ai-finances/schema";

type Choice = "claude" | "chatgpt" | "ollama" | "openai_compatible";

interface AiSettingsResponse {
  base_url?: string;
  choice?: Choice | "env";
  error?: string;
  has_api_key?: boolean;
  model?: string;
  provider?: {
    base_url?: string;
    claude_credential?: "oauth_login" | "setup_token" | "env" | "claude_code";
    configured: boolean;
    error_message?: string;
    model?: string;
    provider: string;
    status: ProviderStatus;
  };
}

interface ClaudeStatusResponse {
  connected?: boolean;
  error?: string;
  error_message?: string;
  source?: "oauth_login" | "setup_token" | "env" | "claude_code";
  url?: string;
}

const choices: Array<{ description: string; label: string; value: Choice }> = [
  { description: "Your Claude Pro or Max plan", label: "Claude", value: "claude" },
  { description: "Your ChatGPT plan", label: "ChatGPT", value: "chatgpt" },
  { description: "A model on this machine", label: "Ollama", value: "ollama" },
  { description: "llama.cpp, LM Studio, vLLM", label: "Local server", value: "openai_compatible" }
];

const defaultOllamaUrl = "http://127.0.0.1:11434/v1";

const claudeSourceLabels: Record<NonNullable<ClaudeStatusResponse["source"]>, string> = {
  claude_code: "Using your Claude Code login on this machine",
  env: "Using CLAUDE_CODE_OAUTH_TOKEN from the environment",
  oauth_login: "Signed in with Claude",
  setup_token: "Connected with a setup token"
};

/**
 * Which model answers Ask Koban: a subscription (Claude, ChatGPT) or a model
 * running on the user's own machine (Ollama, or any OpenAI-compatible server).
 */
export function AskModelSettings({ chatGptEnabled }: { chatGptEnabled: boolean }) {
  const formId = useId();
  const [loaded, setLoaded] = useState(false);
  const [choice, setChoice] = useState<Choice | "env">("env");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [provider, setProvider] = useState<AiSettingsResponse["provider"]>();
  const [claude, setClaude] = useState<ClaudeStatusResponse>({});
  const [setupToken, setSetupToken] = useState("");
  const [oauthUrl, setOauthUrl] = useState("");
  const [oauthCode, setOauthCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  function applySettings(body: AiSettingsResponse) {
    setChoice(body.choice ?? "env");
    setBaseUrl(body.base_url ?? "");
    setModel(body.model ?? "");
    setHasApiKey(body.has_api_key ?? false);
    setProvider(body.provider);
  }

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      fetch("/api/v1/ai/settings", { cache: "no-store" }).then((response) => response.json() as Promise<AiSettingsResponse>),
      fetch("/api/auth/claude", { cache: "no-store" }).then((response) => response.json() as Promise<ClaudeStatusResponse>)
    ])
      .then(([settings, claudeStatus]) => {
        if (cancelled) return;
        applySettings(settings);
        setClaude(claudeStatus);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setMessage({ error: true, text: "Could not load the AI settings." });
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function run<T>(action: () => Promise<T>, success?: string) {
    setBusy(true);
    setMessage(null);

    try {
      await action();
      if (success) setMessage({ error: false, text: success });
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  async function requestJson<T extends { error?: string }>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: init?.body ? { "content-type": "application/json" } : undefined
    });
    const body = (await response.json()) as T;

    if (!response.ok) {
      throw new Error(body.error ?? `Request failed (${response.status}).`);
    }

    return body;
  }

  function selectChoice(next: Choice) {
    setChoice(next);
    setModels([]);
    setModel("");
    setBaseUrl(next === "ollama" ? defaultOllamaUrl : "");
    setMessage(null);
  }

  const listModels = () =>
    run(async () => {
      const body = await requestJson<{ data?: Array<{ id: string }>; error?: string }>("/api/v1/ai/local-models", {
        body: JSON.stringify({
          api_key: apiKey || undefined,
          base_url: baseUrl || undefined,
          kind: choice === "ollama" ? "ollama" : "openai_compatible"
        }),
        method: "POST"
      });
      const ids = (body.data ?? []).map((entry) => entry.id);
      setModels(ids);

      if (!model && ids[0]) {
        setModel(ids[0]);
      }

      setMessage({ error: false, text: ids.length ? `Found ${ids.length} model${ids.length === 1 ? "" : "s"}.` : "The server lists no models." });
    });

  const save = () =>
    run(async () => {
      if (choice === "env") return;
      const body = await requestJson<AiSettingsResponse>("/api/v1/ai/settings", {
        body: JSON.stringify({
          base_url: choice === "ollama" || choice === "openai_compatible" ? baseUrl : undefined,
          choice,
          model: model || undefined,
          ...(choice === "openai_compatible" && apiKey ? { api_key: apiKey } : {})
        }),
        method: "PUT"
      });
      applySettings(body);
      setApiKey("");
    }, "Saved. Ask Koban uses this model now.");

  const connectSetupToken = () =>
    run(async () => {
      const body = await requestJson<ClaudeStatusResponse>("/api/auth/claude", {
        body: JSON.stringify({ action: "setup_token", token: setupToken }),
        method: "POST"
      });
      setClaude(body);
      setSetupToken("");
    }, "Claude subscription connected.");

  const startOAuth = () =>
    run(async () => {
      const body = await requestJson<ClaudeStatusResponse>("/api/auth/claude", {
        body: JSON.stringify({ action: "start" }),
        method: "POST"
      });

      if (body.url) {
        setOauthUrl(body.url);
        window.open(body.url, "_blank", "noopener,noreferrer");
      }
    });

  const finishOAuth = () =>
    run(async () => {
      const body = await requestJson<ClaudeStatusResponse>("/api/auth/claude", {
        body: JSON.stringify({ action: "finish", code: oauthCode }),
        method: "POST"
      });
      setClaude(body);
      setOauthCode("");
      setOauthUrl("");
    }, "Claude subscription connected.");

  const disconnectClaude = () =>
    run(async () => {
      const body = await requestJson<ClaudeStatusResponse>("/api/auth/claude", { method: "DELETE" });
      setClaude(body);
    }, "Removed the Claude token saved in Koban.");

  const isLocal = choice === "ollama" || choice === "openai_compatible";
  const canSave =
    choice !== "env" &&
    !busy &&
    (choice !== "chatgpt" || chatGptEnabled) &&
    (!isLocal || (Boolean(model.trim()) && (choice === "ollama" || Boolean(baseUrl.trim()))));

  return (
    <Card size="sm" data-testid="ask-model-settings">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b pb-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Ask Koban model</h2>
          <p className="text-sm text-muted-foreground">
            Answer with your Claude or ChatGPT subscription, or with a model running on your own machine.
          </p>
        </div>
        {provider ? <ProviderStatusBadge status={provider.status} /> : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Model for Ask Koban">
          {choices.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={choice === option.value}
              disabled={!loaded}
              onClick={() => selectChoice(option.value)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors duration-150 motion-reduce:transition-none",
                choice === option.value ? "border-ring bg-muted" : "border-border bg-card hover:bg-muted/50"
              )}
            >
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
            </button>
          ))}
        </div>

        {choice === "env" && loaded ? (
          <p className="text-sm text-muted-foreground">
            Using the AI_FINANCES_LLM_* settings from the environment
            {provider?.model ? ` (${provider.model})` : ""}. Pick a model above to choose here instead.
          </p>
        ) : null}

        {choice === "claude" ? (
          <div className="flex flex-col gap-3 rounded-lg bg-muted/30 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm" data-testid="claude-connection">
                {claude.connected
                  ? claudeSourceLabels[claude.source ?? "oauth_login"]
                  : claude.error_message ?? "Not connected"}
              </span>
              {claude.connected && (claude.source === "oauth_login" || claude.source === "setup_token") ? (
                <Button variant="outline" size="sm" disabled={busy} onClick={disconnectClaude} type="button">
                  <LogOut className="size-4" />
                  Disconnect
                </Button>
              ) : null}
            </div>
            {!claude.connected || claude.source === "claude_code" || claude.source === "env" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${formId}-setup-token`}>Setup token</Label>
                  <div className="flex gap-2">
                    <Input
                      id={`${formId}-setup-token`}
                      type="password"
                      autoComplete="off"
                      placeholder="sk-ant-oat01-…"
                      value={setupToken}
                      onChange={(event) => setSetupToken(event.target.value)}
                    />
                    <Button size="sm" disabled={busy || !setupToken.trim()} onClick={connectSetupToken} type="button">
                      Connect
                    </Button>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Run <code className="font-mono">claude setup-token</code> in a terminal and paste the token it prints.
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Or sign in with Claude</span>
                  {oauthUrl ? (
                    <div className="flex gap-2">
                      <Input
                        aria-label="Code from Claude"
                        autoComplete="off"
                        placeholder="Paste the code Claude shows"
                        value={oauthCode}
                        onChange={(event) => setOauthCode(event.target.value)}
                      />
                      <Button size="sm" disabled={busy || !oauthCode.trim()} onClick={finishOAuth} type="button">
                        Finish
                      </Button>
                    </div>
                  ) : (
                    <Button className="w-fit" variant="outline" size="sm" disabled={busy} onClick={startOAuth} type="button">
                      <ExternalLink className="size-4" />
                      Sign in with Claude
                    </Button>
                  )}
                </div>
              </>
            ) : null}
            <ModelField formId={formId} label="Model (optional)" model={model} models={[]} placeholder="claude-sonnet-5-5" setModel={setModel} />
          </div>
        ) : null}

        {choice === "chatgpt" ? (
          <div className="flex flex-col gap-3 rounded-lg bg-muted/30 px-3 py-3">
            <p className="text-sm text-muted-foreground">
              {chatGptEnabled
                ? "Sign in under ChatGPT OAuth below, then save."
                : "ChatGPT sign-in is off. Set AI_FINANCES_ENABLE_CHATGPT_OAUTH=1 and restart Koban to use it."}
            </p>
            <ModelField formId={formId} label="Model (optional)" model={model} models={[]} placeholder="gpt-5.5" setModel={setModel} />
          </div>
        ) : null}

        {isLocal ? (
          <div className="flex flex-col gap-3 rounded-lg bg-muted/30 px-3 py-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${formId}-base-url`}>Server URL</Label>
              <Input
                id={`${formId}-base-url`}
                placeholder={choice === "ollama" ? defaultOllamaUrl : "http://127.0.0.1:8080/v1"}
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </div>
            {choice === "openai_compatible" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${formId}-api-key`}>API key (optional)</Label>
                <Input
                  id={`${formId}-api-key`}
                  type="password"
                  autoComplete="off"
                  placeholder={hasApiKey ? "Saved; leave empty to keep it" : "Only if your server requires one"}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <ModelField formId={formId} label="Model" model={model} models={models} placeholder={choice === "ollama" ? "llama3.2" : "lfm3-1.7b"} setModel={setModel} />
              </div>
              <Button variant="outline" size="sm" disabled={busy || (choice === "openai_compatible" && !baseUrl.trim())} onClick={listModels} type="button">
                <RefreshCw className="size-4" />
                {choice === "ollama" ? "Installed models" : "List models"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Questions and your financial data go only to this server. Reasoning models such as LFM3 keep thinking on;
              lookups take about 10 seconds on a desktop GPU.
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="truncate text-xs text-muted-foreground" data-testid="ask-model-active">
            {provider?.configured
              ? `Active: ${provider.model ?? "model"}${provider.base_url ? ` at ${provider.base_url}` : ""}`
              : provider?.error_message ?? ""}
          </span>
          <Button size="sm" disabled={!canSave} onClick={save} type="button">
            Save
          </Button>
        </div>

        {message ? (
          <p role="status" className={cn("text-sm", message.error ? "text-destructive" : "text-muted-foreground")}>
            {message.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ModelField({
  formId,
  label,
  model,
  models,
  placeholder,
  setModel
}: {
  formId: string;
  label: string;
  model: string;
  models: string[];
  placeholder: string;
  setModel: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${formId}-model`}>{label}</Label>
      <Input
        id={`${formId}-model`}
        list={models.length ? `${formId}-models` : undefined}
        placeholder={placeholder}
        value={model}
        onChange={(event) => setModel(event.target.value)}
      />
      {models.length ? (
        <datalist id={`${formId}-models`}>
          {models.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}
