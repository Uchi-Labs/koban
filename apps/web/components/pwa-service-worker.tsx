"use client";

import { useEffect } from "react";

export function PwaServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !canRegisterServiceWorker(window.location)) {
      return;
    }

    let cancelled = false;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const register = () => {
      if (cancelled) {
        return;
      }

      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Registration is opportunistic; the app should stay usable if the browser rejects it.
      });
    };

    const scheduleRegistration = () => {
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(register, { timeout: 2_000 });
      } else {
        timeoutId = setTimeout(register, 1_000);
      }
    };

    if (document.readyState === "complete") {
      scheduleRegistration();
    } else {
      window.addEventListener("load", scheduleRegistration, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", scheduleRegistration);
      if (idleId !== undefined) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  return null;
}

function canRegisterServiceWorker(location: Location) {
  return window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
}
