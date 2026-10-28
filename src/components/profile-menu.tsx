"use client";

import Link from "next/link";
import { PixelIcon } from "@/components/pixel-icon";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { PROFILE_TABS, tabFor } from "@/config/navigation";
import { signOutToHome } from "@/lib/auth-actions";
import { SubmitButton } from "@/components/submit-button";

// The profile menu (spec step 79): who's signed in, What Jane did, Settings and Sign out. These
// live here rather than in the area tabs; their pages (and /connect, /import) light the icon up.
export function ProfileMenu({ email }: { email: string | null | undefined }) {
  const pathname = usePathname();
  const tab = tabFor(pathname);
  const inSettings = PROFILE_TABS.some((t) => t.key === tab);
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
    <div ref={wrapper} className="relative shrink-0">
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
        <PixelIcon name="person" />
      </button>
      <div
        id={menuId}
        hidden={!open}
        className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-zinc-200 bg-white p-2 text-sm shadow-lg [&:not([hidden])]:flex dark:border-zinc-800 dark:bg-zinc-900"
      >
        {/* Long emails wrap instead of pushing the page sideways on a phone. */}
        <p className="break-all px-3 py-2 text-zinc-600 dark:text-zinc-400">Signed in as {email}</p>
        {PROFILE_TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={tab === t.key ? "page" : undefined}
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center px-3 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {t.label}
          </Link>
        ))}
        {/* Closed beta: the person's own words about this page, nothing else (src/app/report-a-problem). */}
        <Link
          href={`/report-a-problem?from=${encodeURIComponent(pathname)}`}
          data-report-problem=""
          onClick={() => setOpen(false)}
          className="flex min-h-11 items-center px-3 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Report a problem
        </Link>
        <form action={signOutToHome}>
          <SubmitButton className="flex min-h-11 w-full items-center rounded-lg px-3 text-left font-medium text-emerald-700 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            Sign out
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
