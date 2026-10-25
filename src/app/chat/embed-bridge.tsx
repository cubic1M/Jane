"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { containScroll } from "@/lib/contain-scroll";
import { chatInFrame, isFrameMessage, leavesFrame, type FrameMessage } from "@/lib/side-chat";

// The chat inside the side panel (/chat?embed=1, docs/design/home-hub.md). A link to another
// page opens in the main window, not in the panel; a link to the chat keeps the panel's view;
// and the page says where the panel is (docked, full or a sheet) and when to reload.
export function EmbedBridge() {
  const router = useRouter();

  useEffect(() => {
    const root = document.documentElement;
    // Opened on its own (the e2e tests do): the chat as it is, with its suggestions.
    if (window.self === window.top) {
      root.dataset.chatEmbedCards = "";
      return () => {
        delete root.dataset.chatEmbedCards;
      };
    }
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
    // "Ask Jane" from the giant tree: the question goes in the box and is sent at once, and the
    // page hears where it landed (for its dotted line), when Jane starts and when she's done.
    const tell = (message: FrameMessage) => window.parent.postMessage(message, origin);
    const tellWhere = (el: Element) => {
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      tell({ type: "jane:bubble", x: r.left, y: r.top + r.height / 2 });
    };
    let watching: MutationObserver | null = null;
    const sendNow = (text: string) => {
      const box = document.querySelector<HTMLInputElement>('input[name="message"]');
      const form = box?.form;
      // One at a time: while an answer is coming, a second ask waits for the next click.
      if (!box || !form || document.querySelector('[aria-label="Sending"]')) return;
      box.value = text;
      watching?.disconnect();
      let sent = false;
      let answering = false;
      watching = new MutationObserver(() => {
        const question = document.querySelector("[data-draft-question]");
        if (question && !sent) {
          sent = true;
          tellWhere(question);
        }
        if (document.querySelector("[data-draft-answer]") && !answering) {
          answering = true;
          tell({ type: "jane:answering" });
        }
        if (sent && !document.querySelector('[aria-label="Sending"]')) {
          tell({ type: "jane:answered" });
          watching?.disconnect();
          watching = null;
        }
      });
      watching.observe(document.body, { childList: true, subtree: true, characterData: true });
      form.requestSubmit();
    };
    // Asked before: scroll to the person's own message with that question.
    const findAsked = (text: string) => {
      const mine = [...document.querySelectorAll("li")].findLast((el) =>
        el.textContent?.includes(text),
      );
      if (mine) tellWhere(mine);
      tell({ type: "jane:answered" });
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== window.parent) return;
      if (!isFrameMessage(event.data)) return;
      if (event.data.type === "jane:refresh") router.refresh();
      else if (event.data.type === "jane:ask") {
        // "Ask Jane about this" (the feature map): the question waits in the box to be sent.
        const box = document.querySelector<HTMLInputElement>('input[name="message"]');
        if (box) {
          box.value = event.data.text;
          box.focus({ preventScroll: true });
          box.setSelectionRange(box.value.length, box.value.length);
          box.scrollIntoView({ block: "center" });
          // Where it is now, for the page's dotted line to it.
          requestAnimationFrame(() => {
            const r = box.getBoundingClientRect();
            tell({ type: "jane:box", x: r.left, y: r.top + r.height / 2 });
          });
        }
      } else if (event.data.type === "jane:send") {
        sendNow(event.data.text);
      } else if (event.data.type === "jane:find") {
        findAsked(event.data.text);
      } else if (event.data.type === "jane:panel") {
        root.dataset.chatEmbed = event.data.state;
        // On a computer the dock above the panel has Jane's cards, so the chat leaves them out;
        // in the phone's sheet they sit over its message box.
        if (event.data.state === "sheet") root.dataset.chatEmbedCards = "";
        else delete root.dataset.chatEmbedCards;
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
    // Scrolling past the chat's ends never scrolls the page around the panel.
    const releaseScroll = containScroll(document);
    return () => {
      releaseScroll();
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      watching?.disconnect();
      delete root.dataset.chatEmbed;
      delete root.dataset.chatEmbedCards;
    };
  }, [router]);

  return null;
}
