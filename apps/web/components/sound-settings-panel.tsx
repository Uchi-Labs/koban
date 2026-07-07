"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  isUiSoundMuted,
  playToggleOn,
  prepareUiSound,
  setUiSoundMuted,
  subscribeUiSoundMuted,
} from "@/lib/ui-sound";

const subscribe = (listener: () => void) => subscribeUiSoundMuted(listener);
const getSnapshot = () => isUiSoundMuted();
const getServerSnapshot = () => false;

export function SoundSettingsPanel() {
  const muted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const enabled = !muted;

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b pb-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Interface sounds</h2>
          <p className="text-sm text-muted-foreground">Quiet feedback for taps, selection, sync, toasts, and errors.</p>
        </div>
        <label className="flex items-center gap-2 text-sm" htmlFor="ui-sound-enabled">
          <span className="t-icon-swap text-muted-foreground" data-state={enabled ? "a" : "b"} aria-hidden="true">
            <span className="t-icon" data-icon="a">
              <Volume2 className="size-4" />
            </span>
            <span className="t-icon" data-icon="b">
              <VolumeX className="size-4" />
            </span>
          </span>
          <span className="text-muted-foreground">{enabled ? "On" : "Off"}</span>
          <Switch
            checked={enabled}
            id="ui-sound-enabled"
            onCheckedChange={(checked) => {
              prepareUiSound();
              setUiSoundMuted(!checked);

              if (checked) {
                playToggleOn();
              }
            }}
          />
        </label>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Stored on this device. Motion preferences do not change sound; this switch is the only sound gate.
        </p>
      </CardContent>
    </Card>
  );
}
