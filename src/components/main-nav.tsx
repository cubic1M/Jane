"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { DETAIL_PAGES, DETAIL_TABS, TABS, isDetail, tabFor } from "@/config/navigation";

// The main menu (spec step 79): a bar along the bottom on phones, a row at the top on
// bigger screens. Spec step 86: the chat is where things happen, so the menu is Chat and a
// "Details" menu holding Today, Jane, Money and Ahead, each with every page under it
// (src/config/navigation.ts). The place you're on is highlighted.

const ITEM =
  "flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-xs sm:min-h-11 sm:w-auto sm:flex-row sm:gap-1.5 sm:rounded-full sm:px-3 sm:text-sm";
const ON = "font-semibold text-emerald-700 sm:bg-emerald-50 sm:dark:bg-emerald-950";
const OFF =
  "font-medium text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50";
const PAGE_LINK =
  "inline-flex min-h-11 items-center rounded-lg px-2 hover:bg-zinc-100 dark:hover:bg-zinc-800";

// What's highlighted shows in ASCII brackets, hidden from screen readers.
function Label({ text, current }: { text: string; current: boolean }) {
  return (
    <span>
      {current && <span aria-hidden="true">[</span>}
      {text}
      {current && <span aria-hidden="true">]</span>}
    </span>
  );
}

export function MainNav() {
  const pathname = usePathname();
  const active = tabFor(pathname);
  const inDetails = isDetail(pathname);
  const chat = TABS[0];
  // The page the menu was opened on: it closes by itself when the page changes.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const wrapper = useRef<HTMLElement>(null);
  const panelId = useId();

  // Closes on a click outside and on Escape.
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpenOn(null);
      } else if (!wrapper.current?.contains(event.target as Node)) {
        setOpenOn(null);
      }
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const current = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      ref={wrapper}
      id="main-nav"
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] sm:relative sm:z-auto sm:border-0 sm:bg-transparent sm:pb-0 dark:border-zinc-800 dark:bg-zinc-950 sm:dark:bg-transparent print:hidden"
    >
      <ul className="mx-auto flex max-w-3xl sm:gap-1">
        <li className="flex-1 sm:flex-none">
          <Link
            href={chat.href}
            aria-current={active === "chat" ? "page" : undefined}
            className={`${ITEM} ${active === "chat" ? ON : OFF}`}
          >
            <span aria-hidden className="text-sm sm:text-xs">
              &gt;_
            </span>
            <Label text={chat.label} current={active === "chat"} />
          </Link>
        </li>
        <li className="flex-1 sm:flex-none">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            // The page you're on is one of the details.
            aria-current={inDetails ? "true" : undefined}
            onClick={() => setOpenOn(open ? null : pathname)}
            className={`${ITEM} ${inDetails ? ON : OFF}`}
          >
            <span aria-hidden className="text-sm sm:text-xs">
              [=]
            </span>
            <Label text="Details" current={inDetails} />
          </button>
        </li>
      </ul>
      {/* On phones it opens above the bar; from sm up, under the button. */}
      <div
        id={panelId}
        hidden={!open}
        className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-50 max-h-[70vh] flex-col gap-3 overflow-y-auto border-t border-zinc-200 bg-white p-3 text-sm shadow-lg [&:not([hidden])]:flex sm:absolute sm:inset-x-auto sm:top-full sm:bottom-auto sm:left-0 sm:mt-2 sm:w-96 sm:max-w-[calc(100vw-2rem)] sm:rounded-xl sm:border dark:border-zinc-800 dark:bg-zinc-900"
      >
        {DETAIL_TABS.map((tab) => (
          <section key={tab.key} aria-label={tab.label} className="flex flex-col">
            <Link
              href={tab.href}
              aria-current={pathname === tab.href ? "page" : undefined}
              className={`${PAGE_LINK} font-semibold ${active === tab.key ? "text-emerald-700" : ""}`}
            >
              <Label text={tab.label} current={pathname === tab.href} />
            </Link>
            {DETAIL_PAGES[tab.key].length > 0 && (
              <ul className="flex flex-wrap gap-x-1 pl-2">
                {DETAIL_PAGES[tab.key].map((page) => (
                  <li key={page.href}>
                    <Link
                      href={page.href}
                      aria-current={current(page.href) ? "page" : undefined}
                      className={`${PAGE_LINK} ${current(page.href) ? "font-semibold text-emerald-700" : "text-zinc-700 dark:text-zinc-300"}`}
                    >
                      <Label text={page.label} current={current(page.href)} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </nav>
  );
}
