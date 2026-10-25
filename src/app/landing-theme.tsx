"use client";

import { useEffect } from "react";

// The landing's colours on the page around it (body, footer) only while the landing is the
// page showing (founder: "when you go from the landing page to the home page, the background is
// sometimes white"). Next keeps the page you left mounted but hidden, for a quick Back, so
// `body:has(.landing)` stayed true on /home; an effect's cleanup runs when a page is hidden, so
// this mark goes as soon as the landing does, and comes back with it.
export function LandingTheme() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.landing = "";
    return () => {
      delete root.dataset.landing;
    };
  }, []);
  return null;
}
