"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, tabFor, type TabKey } from "@/config/navigation";

// The main menu (spec step 79): a tab bar along the bottom on phones, a row at the top on
// bigger screens. The tab for the page you're on is highlighted (src/config/navigation.ts).

// ASCII style: each tab has a small text glyph instead of a drawn icon.
const GLYPHS: Record<Exclude<TabKey, "settings">, string> = {
  today: "(*)",
  jane: "<J>",
  money: "[$]",
  ahead: ">>>",
  ask: "[?]",
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
                <span aria-hidden className="text-sm sm:text-xs">
                  {GLYPHS[tab.key as keyof typeof GLYPHS]}
                </span>
                <span>
                  {current && <span aria-hidden="true">[</span>}
                  {tab.label}
                  {current && <span aria-hidden="true">]</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
