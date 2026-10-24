import Link from "next/link";
import { redirect } from "next/navigation";
import { after, connection } from "next/server";
import { Suspense } from "react";
import { CHAT_MAX_MESSAGE } from "@/config/agent-chat";
import { scopedFor } from "@/lib/db-scoped";
import {
  markChatRead,
  openPopupMessages,
  pinnedMessages,
  POPUP_LIMIT,
  stackedSuggestions,
} from "@/lib/jane-agent/messages";
import { isPopup, popupOrder, withoutPopups } from "@/lib/jane-agent/popups";
import { inTheList, toView, type MessageView } from "@/lib/jane-agent/view";
import { openChat, timezoneOf } from "@/lib/jane-agent/open";
import { practiceCards } from "@/lib/practice/cards";
import { requireUser } from "@/lib/session";
import { chatRedirect } from "@/lib/side-chat";
import { ChatComposer } from "./composer";
import { ChatMessageItem } from "./message";
import { ScanRefresher } from "./scan-refresher";
import { ScrollToEnd } from "./scroll-to-end";
import { ChatCards } from "./chat-cards";
import { EmbedBridge } from "./embed-bridge";

// Jane's chat (spec step 81), shown only in the side panel since the founder's "I don't want an
// individual chat": /chat itself opens Home with the panel open. What Jane noticed, did and suggests, newest
// at the bottom, each with its buttons. The last CHAT_PAGE_SIZE messages, with "Show
// earlier". The message box at the end is for typing to Jane (spec step 84); conversations
// from Ask Jane stay readable on /ask.
// The home hub (docs/design/home-hub.md): ?embed=1 is the same chat inside the side panel,
// without the page header and intro, its links opening in the main window.

const MAX_PAGES = 20;

// The options in Jane's latest answer, while still open: an older answer's options never come
// back once the conversation has moved on.
function latestOptions(messages: MessageView[]): MessageView | null {
  const last = messages.findLast((m) => m.kind === "reply");
  return last?.options ? last : null;
}

function pagesFrom(value: string | string[] | undefined): number {
  const n = Number(typeof value === "string" ? value : "1");
  return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_PAGES) : 1;
}

async function Chat({ searchParams }: { searchParams: PageProps<"/chat">["searchParams"] }) {
  await connection();
  const user = await requireUser();
  const params = await searchParams;
  const pages = pagesFrom(params.pages);
  const embed = params.embed === "1";
  // No chat page of its own: Home, with the side chat open (src/lib/side-chat.ts).
  if (!embed) redirect(chatRedirect(params));
  // Nothing here waits on anything else, so a first visit waits for the slowest, not the sum.
  const [chat, askHistory, pinned, stackedRows, zone, practice, popupRows] = await Promise.all([
    openChat(user.id, { pages }),
    scopedFor(user.id).askConversations.count(),
    pinnedMessages(user.id),
    // The day's suggestions still waiting, one card at a time by the message box.
    stackedSuggestions(user.id),
    timezoneOf(user.id),
    // Spec step 296: the practice portfolio's cards (demo advice mode only).
    practiceCards(user.id),
    // Anything else Jane brought up that waits on the person: a pop-up too.
    openPopupMessages(user.id),
  ]);
  const now = new Date();
  const stacked = [
    ...stackedRows.map((m) => toView(m, now, zone)),
    ...popupOrder(
      popupRows.map((m) => toView(m, now, zone)).filter((m) => isPopup(m) && !m.suggestion),
    ).slice(0, POPUP_LIMIT),
  ];
  if (!chat) {
    return (
      <p data-chat-embed className="text-sm text-zinc-600 dark:text-zinc-400">
        Link a bank and I&apos;ll start looking after your money.{" "}
        <Link href="/connect" className="font-medium text-emerald-700 hover:underline">
          Link a bank
        </Link>
      </p>
    );
  }
  // The floating cards are the one place a waiting suggestion or decision shows: the list has
  // no card of its own, and no gap where one was.
  const listed = withoutPopups(inTheList(chat.messages, stacked), stacked);
  const hasAskHistory = askHistory > 0;
  after(() => markChatRead(user.id));

  return (
    <>
      <EmbedBridge />
      <h1 data-chat-embed className="sr-only">
        Chat with Jane
      </h1>

      {/* Every message counts here, the floating ones too: the pulse counts them all. */}
      {chat.scanning && <ScanRefresher shown={chat.hasEarlier ? -1 : chat.messages.length} />}

      {/* Spec step 96: search everything said here, and what the person pinned. */}
      <form action="/chat/search" role="search" className="flex gap-2">
        <input
          name="q"
          type="search"
          aria-label="Search the chat"
          placeholder="Search the chat: words, $17.99, Oct 20"
          maxLength={100}
          className="min-h-11 min-w-0 flex-1 border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-semibold text-emerald-700 hover:underline"
        >
          <span aria-hidden="true">[</span>Search<span aria-hidden="true">]</span>
        </button>
      </form>
      {pinned.length > 0 && (
        <section aria-labelledby="pinned-heading" className="flex flex-col gap-2">
          <h2 id="pinned-heading" className="text-sm font-semibold">
            Pinned
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {pinned.map((m) => (
              <li key={m.id}>
                <a
                  href={`#${m.id}`}
                  className="inline-flex min-h-11 items-center text-emerald-700 hover:underline [overflow-wrap:anywhere]"
                >
                  {m.body.split("\n")[0].slice(0, 90)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {chat.hasEarlier && (
        <Link
          href={`/chat?pages=${pages + 1}`}
          className="inline-flex min-h-11 items-center self-center text-sm font-medium text-emerald-700 hover:underline"
        >
          Show earlier
        </Link>
      )}

      {listed.length > 0 && (
        <ol aria-label="Messages" className="flex flex-col gap-4">
          {listed.map((message) => (
            // Keyed by its state too: a tap on a floating card answers it on the server, and the
            // reload shows that here.
            <ChatMessageItem key={`${message.id}:${message.status}`} initial={message} />
          ))}
        </ol>
      )}
      {listed.length === 0 && stacked.length === 0 && !chat.scanning && (
        <p className="text-zinc-600 dark:text-zinc-400">
          Nothing new from me yet. I&apos;ll post here as soon as I spot something.
        </p>
      )}

      {/* The message box (spec step 84): typing to Jane, answered under it. */}
      <ChatComposer
        id="chat-end"
        maxLength={CHAT_MAX_MESSAGE}
        typed={chat.messages
          .filter((m) => m.kind === "user")
          .map((m) => ({ id: m.id, body: m.body }))}
      />
      {hasAskHistory && (
        <Link
          href="/ask"
          className="-mt-4 inline-flex min-h-11 items-center self-start text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          Your earlier Ask Jane conversations ›
        </Link>
      )}
      {pages === 1 && <ScrollToEnd targetId="chat-end" />}
      {/* Last, so its room under the message box is the end of the page: one set of cards at
          a time, the options Jane just gave, then the day's suggestions, then the practice
          portfolio's. */}
      <ChatCards options={latestOptions(chat.messages)} suggestions={stacked} practice={practice} />
    </>
  );
}

export default function ChatPage({ searchParams }: PageProps<"/chat">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading your chat…</p>}>
        <Chat searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
