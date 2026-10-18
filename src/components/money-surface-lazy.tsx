"use client";

import dynamic from "next/dynamic";

// The money wave pulls in three.js, which is large: load it only in the browser, after the
// page's text is on screen, so the landing page stays fast and the rest of the app never
// downloads it.
export const MoneySurfaceLazy = dynamic(() => import("@/components/ui/money-surface"), {
  ssr: false,
});
