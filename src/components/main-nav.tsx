"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { TABS, tabFor, type TabKey } from "@/config/navigation";

// The main menu (spec step 79): a tab bar along the bottom on phones, a row at the top on
// bigger screens. The tab for the page you're on is highlighted (src/config/navigation.ts).

const ICON_PATHS: Record<Exclude<TabKey, "settings">, ReactNode> = {
  today: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  jane: (
    <>
      <path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z" />
      <path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  money: (
    <>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v4" />
      <path d="M3 7.5v10A2.5 2.5 0 0 0 5.5 20H21V9H5.5A2.5 2.5 0 0 1 3 7.5z" />
      <circle cx="16.5" cy="14.5" r="1" />
    </>
  ),
  ahead: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4M12 14v3M10.5 15.5L12 17l1.5-1.5" />
    </>
  ),
  ask: <path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.4-4.9A8.5 8.5 0 1 1 21 12z" />,
};

export function MainNav() {
  const active = tabFor(usePathname());
  return (
    <nav
      id="main-nav"
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:pb-0 dark:border-zinc-800 dark:bg-zinc-950 sm:dark:bg-transparent print:hidden"
    >
      <ul className="mx-auto flex max-w-3xl sm:gap-1">
        {TABS.map((tab) => {
          const current = tab.key === active;
          return (
            <li key={tab.key} className="flex-1 sm:flex-none">
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs sm:min-h-11 sm:flex-row sm:gap-1.5 sm:rounded-full sm:px-3 sm:text-sm ${
                  current
                    ? "font-semibold text-emerald-700 sm:bg-emerald-50 sm:dark:bg-emerald-950"
                    : "font-medium text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
                }`}
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={current ? 2.2 : 1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-6 sm:size-4"
                >
                  {ICON_PATHS[tab.key as keyof typeof ICON_PATHS]}
                </svg>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
