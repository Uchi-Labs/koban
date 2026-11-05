"use client";

import { Download, Power, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/b-progress";
import {
  disposeBrowserModel,
  isBrowserModelCached,
  loadBrowserModel,
  transformersCacheName,
  type BrowserModelProgress
} from "@/lib/browser-llm/browser-model";
import { detectBrowserModelSupport, type BrowserModelReadiness } from "@/lib/browser-llm/readiness";
import {
  browserModelDownloadBytes,
  browserModelId,
  browserModelLabel,
  formatDownloadSize,
  readBrowserModelSettings,
  writeBrowserModelSettings
} from "@/lib/browser-llm/settings";
import { cn } from "@/lib/utils";

/**
 * Turns the in-browser Ask model on or off for this browser. Off until someone
 * presses the button, which states the download size first; on a device
 * without a real WebGPU adapter it says why and cannot be turned on.
 */
export function BrowserModelOption({ onEnabledChange }: { onEnabledChange?: (enabled: boolean) => void }) {
  const [readiness, setReadiness] = useState<BrowserModelReadiness | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [cached, setCached] = useState(false);
  const [progress, setProgress] = useState<BrowserModelProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void detectBrowserModelSupport().then(async (result) => {
      const isCached = result.status === "ready" ? await isBrowserModelCached(result.dtype) : false;
      if (cancelled) return;
      setReadiness(result);
      setCached(isCached);
      setEnabled(result.status === "ready" && readBrowserModelSettings().enabled);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function setOn(next: boolean) {
    writeBrowserModelSettings({ enabled: next });
    setEnabled(next);
    onEnabledChange?.(next);
  }

  async function turnOn() {
    if (readiness?.status !== "ready") return;
    setBusy(true);
    setMessage(null);
    setProgress({ loadedBytes: 0, totalBytes: browserModelDownloadBytes[readiness.dtype] });

    try {
      await loadBrowserModel(readiness.dtype, setProgress);
      setCached(true);
      setOn(true);
      setMessage({ error: false, text: `Ask in this browser now answers with ${browserModelLabel} on your GPU.` });
    } catch (error) {
      setMessage({ error: true, text: `The model did not load: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function turnOff() {
    disposeBrowserModel();
    setOn(false);
    setMessage({ error: false, text: "Turned off. Ask uses the server's model again." });
  }

  async function deleteDownload() {
    turnOff();

    try {
      const cache = await caches.open(transformersCacheName);
      const keys = await cache.keys();
      await Promise.all(keys.filter((request) => request.url.includes(browserModelId)).map((request) => cache.delete(request)));
      setCached(false);
      setMessage({ error: false, text: "Deleted the downloaded model from this browser." });
    } catch {
      setMessage({ error: true, text: "Could not delete the download. Clear this site's data in the browser instead." });
    }
  }

  const size = readiness?.status === "ready" ? formatDownloadSize(browserModelDownloadBytes[readiness.dtype]) : "";
  const percent = progress && progress.totalBytes > 0 ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100)) : 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/30 px-3 py-3" data-testid="browser-model-option">
      {readiness === null ? (
        <p className="text-sm text-muted-foreground">Checking this browser for WebGPU…</p>
      ) : readiness.status === "unsupported" ? (
        <p className="text-sm" data-testid="browser-model-unsupported">
          Not available here. {readiness.reason}
        </p>
      ) : (
        <>
          <p className="text-sm" data-testid="browser-model-status">
            {enabled
              ? `On. Ask in this browser runs ${browserModelLabel} on this device's GPU (${readiness.adapter}).`
              : `Runs ${browserModelLabel} on this device's GPU (${readiness.adapter}) with WebGPU. ${
                  cached ? "Already downloaded in this browser." : `One-time download of ${size}, kept in this browser's cache.`
                }`}
          </p>
          {progress ? (
            <div className="flex flex-col gap-1.5">
              <Progress
                ariaLabel="Model download"
                getValueLabel={() => `${percent}%`}
                max={100}
                showValue={false}
                size="sm"
                value={percent}
              />
              <span className="text-xs text-muted-foreground tabular-nums">
                {progress.loadedBytes >= progress.totalBytes && progress.totalBytes > 0
                  ? "Preparing the model on the GPU…"
                  : `${formatDownloadSize(progress.loadedBytes)} of ${formatDownloadSize(progress.totalBytes)} (${percent}%)`}
              </span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {enabled ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={turnOff} type="button">
                <Power className="size-4" />
                Turn off
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => void turnOn()} type="button">
                <Download className="size-4" />
                {busy ? "Loading…" : cached ? "Turn on" : `Download ${size} and turn on`}
              </Button>
            )}
            {cached && !busy ? (
              <Button variant="ghost" size="sm" onClick={() => void deleteDownload()} type="button">
                <Trash2 className="size-4" />
                Delete download
              </Button>
            ) : null}
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        The model runs in this tab and looks up your ledger through Koban&apos;s own API; questions never go to a model
        provider. This choice is saved in this browser only: other devices, and background enrichment, keep using the
        server&apos;s model.
      </p>
      {message ? (
        <p role="status" className={cn("text-sm", message.error ? "text-destructive" : "text-muted-foreground")}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
