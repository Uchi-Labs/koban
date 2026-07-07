"use client";

import { createContext, use, useMemo, type ReactNode } from "react";

import {
  AnimatedToastStack,
  useAnimatedToastStack,
  type ToastInput,
} from "@/components/ui/animated-toast-stack";

type ToastApi = {
  clearToasts: () => void;
  dismissToast: (id: string) => void;
  showToast: (input: ToastInput) => string;
  updateToast: (id: string, patch: Partial<ToastInput>) => void;
};

const noopToastApi: ToastApi = {
  clearToasts: () => undefined,
  dismissToast: () => undefined,
  showToast: () => "",
  updateToast: () => undefined,
};

const ToastContext = createContext<ToastApi>(noopToastApi);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { clearToasts, dismissToast, showToast, toasts, updateToast } = useAnimatedToastStack({ limit: 5 });
  const contextValue = useMemo(
    () => ({ clearToasts, dismissToast, showToast, updateToast }),
    [clearToasts, dismissToast, showToast, updateToast]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <AnimatedToastStack fixed onDismiss={dismissToast} position="bottom-right" toasts={toasts} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return use(ToastContext);
}
