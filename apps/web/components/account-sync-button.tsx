"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatefulButton } from "@/components/ui/stateful-button";
import { useToast } from "@/components/ui/toast";
import { playError, playSuccess } from "@/lib/ui-sound";

// Providers that expose a manual sync endpoint. Accounts on other providers
// (copilot import, manual) render no button.
const SYNC_ENDPOINTS: Record<string, string> = {
  plaid: "/api/v1/plaid/sync",
  snaptrade: "/api/v1/snaptrade/sync",
  simplefin: "/api/v1/simplefin/sync"
};

const PROVIDER_LABEL: Record<string, string> = {
  plaid: "Plaid",
  snaptrade: "SnapTrade",
  simplefin: "SimpleFIN"
};

export function AccountSyncButton({ provider }: { provider: string }) {
  const endpoint = SYNC_ENDPOINTS[provider];
  const router = useRouter();
  const { showToast } = useToast();
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");

  if (!endpoint) {
    return null;
  }

  async function sync() {
    setState("loading");
    try {
      const response = await fetch(endpoint, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${PROVIDER_LABEL[provider]} sync failed.`);
      }
      setState("success");
      playSuccess();
      showToast({
        description: `${PROVIDER_LABEL[provider]} account is up to date.`,
        status: "success",
        title: "Synced"
      });
      router.refresh();
      window.setTimeout(() => setState("idle"), 1800);
    } catch (error) {
      setState("error");
      playError();
      showToast({
        description: error instanceof Error ? error.message : "Please try again.",
        status: "error",
        title: "Sync failed"
      });
      window.setTimeout(() => setState("idle"), 2400);
    }
  }

  return (
    <StatefulButton
      className="shrink-0"
      data-demo-hidden=""
      data-sound="sync"
      icon={<RefreshCw className="size-3.5" />}
      loadingText="Syncing"
      onClick={sync}
      size="sm"
      state={state}
      successText="Synced"
      type="button"
      variant="outline"
    >
      Sync
    </StatefulButton>
  );
}
