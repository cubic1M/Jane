"use client";

import { useEffect } from "react";

// Registers public/sw.js (offline page and notifications) once the page has loaded.
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Without it the site still works; only offline and notifications are missing.
    });
  }, []);
  return null;
}
