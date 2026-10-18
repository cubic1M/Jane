"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { SETTINGS_TAB, tabFor } from "@/config/navigation";
import { signOutToHome } from "@/lib/auth-actions";

// The profile menu (spec step 79): who's signed in, Settings and Sign out. Settings lives
// here rather than in the main menu; its pages (and /connect, /import) light the icon up.
export function ProfileMenu({ email }: { email: string | null | undefined }) {
  const inSettings = tabFor(usePathname()) === "settings";
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Closes on a click outside and on Escape.
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
      } else if (!wrapper.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative ml-auto shrink-0">
      <button
        type="button"
        aria-label="Your account and settings"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className={`flex size-11 items-center justify-center rounded-full border ${
          inSettings
            ? "border-emerald-700 bg-emerald-50 text-emerald-700 dark:bg-emerald-950"
            : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
        }`}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          className="size-5"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      </button>
      <div
        id={menuId}
        hidden={!open}
        className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-zinc-200 bg-white p-2 text-sm shadow-lg [&:not([hidden])]:flex dark:border-zinc-800 dark:bg-zinc-900"
      >
        {/* Long emails wrap instead of pushing the page sideways on a phone. */}
        <p className="break-all px-3 py-2 text-zinc-600 dark:text-zinc-400">Signed in as {email}</p>
        <Link
          href={SETTINGS_TAB.href}
          aria-current={inSettings ? "page" : undefined}
          onClick={() => setOpen(false)}
          className="flex min-h-11 items-center rounded-lg px-3 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Settings
        </Link>
        <form action={signOutToHome}>
          <button
            type="submit"
            className="flex min-h-11 w-full items-center rounded-lg px-3 text-left font-medium text-emerald-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
