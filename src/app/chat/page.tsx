import Link from "next/link";
import { redirect } from "next/navigation";
import { after, connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { CHAT_MAX_MESSAGE } from "@/config/agent-chat";
import { scopedFor } from "@/lib/db-scoped";
import { markChatRead, pinnedMessages, stackedSuggestions } from "@/lib/jane-agent/messages";
import { toView } from "@/lib/jane-agent/view";
import { openChat, timezoneOf } from "@/lib/jane-agent/open";
import { requireUser } from "@/lib/session";
import { ChatComposer } from "./composer";
import { ChatMessageItem } from "./message";
import { ScanRefresher } from "./scan-refresher";
import { ScrollToEnd } from "./scroll-to-end";
import { SuggestionCards } from "./suggestion-cards";

// Jane's chat, the home screen (spec step 81): what Jane noticed, did and suggests, newest
// at the bottom, each with its buttons. The last CHAT_PAGE_SIZE messages, with "Show
// earlier". The message box at the end is for typing to Jane (spec step 84); conversations
// from Ask Jane stay readable on /ask.

const MAX_PAGES = 20;

function pagesFrom(value: string | string[] | undefined): number {
  const n = Number(typeof value === "string" ? value : "1");
  return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_PAGES) : 1;
}

async function Chat({ searchParams }: { searchParams: PageProps<"/chat">["searchParams"] }) {
  await connection();
  const user = await requireUser();
  const pages = pagesFrom((await searchParams).pages);
  // Nothing here waits on anything else, so a first visit waits for the slowest, not the sum.
  const [chat, askHistory, pinned, stackedRows, zone] = await Promise.all([
    openChat(user.id, { pages }),
    scopedFor(user.id).askConversations.count(),
    pinnedMessages(user.id),
    // The day's suggestions still waiting, one card at a time by the message box.
    stackedSuggestions(user.id),
    timezoneOf(user.id),
  ]);
  const stacked = stackedRows.map((m) => toView(m, new Date(), zone));
  if (!chat) redirect("/connect");
  const hasAskHistory = askHistory > 0;
  after(() => markChatRead(user.id));

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Chat with Jane</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          I look at your money every day and bring you what matters. What I bring up on my own has a
          yellow edge; my answers to your questions don&apos;t.
        </p>
      </div>

      {chat.scanning && <ScanRefresher />}

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

      {chat.messages.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Nothing new from me yet. I&apos;ll post here as soon as I spot something.
        </p>
      ) : (
        <ol aria-label="Messages" className="flex flex-col gap-4">
          {chat.messages.map((message) => (
            <ChatMessageItem key={message.id} initial={message} />
          ))}
        </ol>
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
      {/* Last, so its room under the message box is the end of the page. */}
      <SuggestionCards messages={stacked} />
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
