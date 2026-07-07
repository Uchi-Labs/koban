"use client";

import { useEffect } from "react";

export function PwaServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    // Never run the SW in development: it caches hashed chunks across code
    // changes, which caused stale-module crashes and hydration mismatches
    // (server HTML from new code, client chunks from old). Also actively
    // unregister any SW left over from a previous dev session.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          void registration.unregister();
        }
      });
      return;
    }

    if (!canRegisterServiceWorker(window.location)) {
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
