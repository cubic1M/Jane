"use client";

import { useEffect, useRef } from "react";
import { sendEvent } from "@/lib/analytics-client";

export function LandingViewTracker() {
  // Strict Mode runs effects twice in dev; the ref keeps it to one event.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    sendEvent("landing_viewed");
  }, []);

  return null;
}
