"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LoadingBar } from "./loading-bar";

// Every tap on a link answers at once (the founder's "every button is an instant response"):
// from the tap until the next page is on screen, the ASCII loading bar under the top bar (in
// the flow, so it covers nothing; founder: "it should always show a loading bar"). Most pages are prefetched and come in a frame later; on a slow
// network or a page that wasn't, this is what the person sees instead of nothing. It clears
// when the address changes, and on its own after a while in case the link went nowhere.

const GIVE_UP_MS = 15_000;

// A tap, as far as the rule needs it: which button, any modifier key, whether something else
// already handled it, and the link it landed on (null when it isn't on a link).
export type Tap = {
  button: number;
  modified: boolean;
  defaultPrevented: boolean;
  link: { href: string; target: string; download: boolean } | null;
};

// A plain left click on a link to another page of this site, opened here: the page it goes to.
export function pageLinkTarget(tap: Tap, here: URL): URL | null {
  if (tap.defaultPrevented || tap.button !== 0 || tap.modified || !tap.link) return null;
  if ((tap.link.target && tap.link.target !== "_self") || tap.link.download) return null;
  const to = new URL(tap.link.href, here);
  if (to.origin !== here.origin || to.pathname.startsWith("/api/")) return null;
  // Same page (a hash or the page itself): nothing to wait for.
  if (to.pathname === here.pathname && to.search === here.search) return null;
  return to;
}

function tapOf(event: MouseEvent): Tap {
  const link = (event.target as Element | null)?.closest?.("a[href]");
  return {
    button: event.button,
    modified: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
    defaultPrevented: event.defaultPrevented,
    link:
      link instanceof HTMLAnchorElement
        ? { href: link.href, target: link.target, download: link.hasAttribute("download") }
        : null,
  };
}

export function NavPending() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, setPending] = useState(false);

  // The new page is here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPending(false), [pathname, search]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (pageLinkTarget(tapOf(event), new URL(window.location.href))) setPending(true);
    };
    // Capture: Next's <Link> cancels the click's default before it would bubble up here.
    document.addEventListener("click", onClick, true);
    // Taps are answered from here on (e2e/tap.spec.ts waits for it).
    document.documentElement.dataset.taps = "ready";
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const id = window.setTimeout(() => setPending(false), GIVE_UP_MS);
    return () => window.clearTimeout(id);
  }, [pending]);

  if (!pending) return null;
  // Under the top bar, in the flow (the app header's #page-loading): the ASCII bar, covering
  // nothing. A page without the app header gets a hairline along the top edge.
  const slot = document.getElementById("page-loading");
  if (slot) {
    return createPortal(
      <div data-nav-pending="">
        <LoadingBar label="Loading" />
      </div>,
      slot,
    );
  }
  return (
    // Visual only: Next's route announcer tells screen readers about the new page.
    <div aria-hidden data-nav-pending="" className="pointer-events-none fixed inset-x-0 top-0 z-50">
      <div className="h-0.5 bg-zinc-900 dark:bg-zinc-100" />
    </div>
  );
}
