"use client";

import {
  ActionSwapIcon,
  ActionSwapText,
  type ActionSwapIconProps,
  type ActionSwapTextProps
} from "@/components/ui/action-swap";

export type ActionSwapCascadeTextProps = Omit<ActionSwapTextProps, "animation">;
export type ActionSwapCascadeIconProps = Omit<ActionSwapIconProps, "animation">;

export function ActionSwapCascadeText(props: ActionSwapCascadeTextProps) {
  return <ActionSwapText {...props} animation="cascade" />;
}

export function ActionSwapCascadeIcon(props: ActionSwapCascadeIconProps) {
  return <ActionSwapIcon {...props} animation="cascade" />;
}
