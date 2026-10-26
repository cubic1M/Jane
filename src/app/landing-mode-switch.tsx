"use client";

import { useEffect, useSyncExternalStore } from "react";

// The landing's light/dark switch, top right (founder, 2026-10-26: "an inverted version of the
// landing page ... a switch on the top right to toggle"). It follows the viewer's system until
// they flip it; the choice is remembered on this device. landing.css swaps the palette on
// html[data-landing-mode], so the white page becomes its exact negative, column included.
const KEY = "jane-landing-mode";
type Mode = "light" | "dark";

function systemMode(): Mode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function storedMode(): Mode | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

// The mode lives on <html> (where landing.css reads it); the button follows it.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-landing-mode"] });
  return () => observer.disconnect();
}

function currentMode(): Mode | null {
  const value = document.documentElement.dataset.landingMode;
  return value === "light" || value === "dark" ? value : null;
}

export function LandingModeSwitch() {
  const mode = useSyncExternalStore(subscribe, currentMode, () => null);

  useEffect(() => {
    document.documentElement.dataset.landingMode = storedMode() ?? systemMode();
    return () => {
      delete document.documentElement.dataset.landingMode;
    };
  }, []);

  function flip() {
    const next: Mode = mode === "dark" ? "light" : "dark";
    document.documentElement.dataset.landingMode = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Private windows: the switch still works for this visit.
    }
  }

  const dark = mode === "dark";
  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={dark}
      aria-label="Dark mode"
      data-testid="landing-mode-switch"
      className="fixed top-4 right-4 z-20 flex items-center gap-1 border border-dashed border-[var(--landing-dot)] bg-[var(--landing-bg)] px-3 py-1.5 font-mono text-xs text-[var(--landing-mid)] hover:text-[var(--landing-hi)] sm:top-6 sm:right-6"
    >
      <span aria-hidden="true">[</span>
      <span
        className={dark ? "text-[var(--landing-dot)]" : "font-semibold text-[var(--landing-hi)]"}
      >
        light
      </span>
      <span aria-hidden="true">/</span>
      <span
        className={dark ? "font-semibold text-[var(--landing-hi)]" : "text-[var(--landing-dot)]"}
      >
        dark
      </span>
      <span aria-hidden="true">]</span>
    </button>
  );
}
