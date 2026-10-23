"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { chatInFrame, isFrameMessage, leavesFrame } from "@/lib/side-chat";

// The chat inside the side panel (/chat?embed=1, docs/design/home-hub.md). A link to another
// page opens in the main window, not in the panel; a link to the chat keeps the panel's view;
// and the page says where the panel is (docked, full or a sheet) and when to reload.
export function EmbedBridge() {
  const router = useRouter();

  useEffect(() => {
    if (window.self === window.top) return;
    const root = document.documentElement;
    root.dataset.chatEmbed = "open";
    const origin = window.location.origin;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      const href = link.getAttribute("href") ?? "";
      const out = leavesFrame(href, origin, {
        target: link.getAttribute("target"),
        download: link.hasAttribute("download"),
      });
      const stay = out ? null : chatInFrame(href, origin);
      if (!out && !stay) return;
      event.preventDefault();
      event.stopPropagation();
      if (out) window.parent.postMessage({ type: "jane:navigate", href: out }, origin);
      else if (stay) router.push(stay);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== window.parent) return;
      if (!isFrameMessage(event.data)) return;
      if (event.data.type === "jane:refresh") router.refresh();
      else if (event.data.type === "jane:panel") {
        root.dataset.chatEmbed = event.data.state;
        // Beside Home the hub shows the suggestions; full screen, the chat shows them again.
        if (event.data.home && event.data.state !== "full") delete root.dataset.chatEmbedCards;
        else root.dataset.chatEmbedCards = "";
      }
    };
    // The panel growing or shrinking keeps the end of the chat in view if it was.
    let atEnd = true;
    const nearEnd = () =>
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 80;
    const onScroll = () => {
      atEnd = nearEnd();
    };
    const onResize = () => {
      if (atEnd) window.scrollTo({ top: document.documentElement.scrollHeight });
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("message", onMessage);
    window.addEventListener("scroll", onScroll, { passive: true });
    // Listening now: ask the page where the panel is.
    window.parent.postMessage({ type: "jane:ready" }, origin);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      delete root.dataset.chatEmbed;
      delete root.dataset.chatEmbedCards;
    };
  }, [router]);

  return null;
}
