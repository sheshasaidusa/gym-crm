"use client";

import { useEffect } from "react";

/** Registers the member app's service worker (installable app + offline page). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/m-sw.js", { scope: "/m" }).catch(() => {
      // Not installable here (private mode, old browser); the app still works.
    });
  }, []);
  return null;
}
