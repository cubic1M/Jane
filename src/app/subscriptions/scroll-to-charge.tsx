"use client";

import { useEffect } from "react";

// A mark on a spending row links to /subscriptions#charge-…, but the list streams in after the
// browser has looked for that id, so the page stayed at the top. Once the rows are mounted this
// scrolls the one named in the address to the middle and lets it glow for a moment (it also
// runs on a direct load and on back / forward). Draws nothing.

const FLASH_MS = 2500;

export function ScrollToCharge() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let flashed: Element | null = null;
    const go = () => {
      let id = "";
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      const row = id ? document.getElementById(id) : null;
      if (!row) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
      flashed?.removeAttribute("data-flash");
      row.setAttribute("data-flash", "");
      flashed = row;
      clearTimeout(timer);
      timer = setTimeout(() => row.removeAttribute("data-flash"), FLASH_MS);
    };
    go();
    window.addEventListener("hashchange", go);
    window.addEventListener("popstate", go);
    return () => {
      window.removeEventListener("hashchange", go);
      window.removeEventListener("popstate", go);
      clearTimeout(timer);
    };
  }, []);
  return null;
}
