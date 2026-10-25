"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { AREA_TABS, tabFor } from "@/config/navigation";
import { panelShowsOn } from "@/lib/side-chat";

// The area tabs along the top (docs/design/home-hub.md): one link per area, the one you're on
// lit up. On a phone the row scrolls sideways, and the current tab is scrolled into view.
// Each tab is its own page, so these are links in a navigation, not ARIA tabs.
export function AreaTabs() {
  const pathname = usePathname();
  const active = tabFor(pathname);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const row = list.current;
    const current = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !current || row.scrollWidth <= row.clientWidth) return;
    // Only sideways: scrollIntoView would also move the page.
    const left = current.offsetLeft - (row.clientWidth - current.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, left) });
  }, [active]);

  return (
    <nav
      id="main-nav"
      aria-label="Main"
      // No room for the side chat on the chat's own pages (src/app/globals.css).
      data-chat-page={panelShowsOn(pathname) ? undefined : ""}
      className="-mx-4 min-w-0 sm:-mx-6 lg:mx-0 lg:flex-1 print:hidden"
    >
      <ul
        ref={list}
        className="flex [scrollbar-width:none] gap-1 overflow-x-auto px-4 sm:px-6 lg:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {AREA_TABS.map((tab) => {
          const current = active === tab.key;
          return (
            <li key={tab.key} className="shrink-0">
              <Link
                href={tab.href}
                // Every area page reads the person's data when it renders, so prefetching all
                // six on every page kept the database busy for the page being shown (speed pass,
                // 2026-10-24). A tap loads it; its shell streams at once.
                prefetch={false}
                aria-current={current ? "page" : undefined}
                className={`relative inline-flex min-h-11 items-center px-2.5 text-sm whitespace-nowrap ${
                  current
                    ? "font-semibold text-emerald-700 after:absolute after:inset-x-2.5 after:bottom-1 after:h-0.5 after:bg-emerald-700"
                    : "font-medium text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
                }`}
              >
                {current && <span aria-hidden>[</span>}
                {tab.label}
                {current && <span aria-hidden>]</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
