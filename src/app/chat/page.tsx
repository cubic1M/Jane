import Link from "next/link";
import { redirect } from "next/navigation";
import { after, connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { CHAT_MAX_MESSAGE } from "@/config/agent-chat";
import { scopedFor } from "@/lib/db-scoped";
import { markChatRead } from "@/lib/jane-agent/messages";
import { openChat } from "@/lib/jane-agent/open";
import { requireUser } from "@/lib/session";
import { ChatComposer } from "./composer";
import { ChatMessageItem } from "./message";
import { ScrollToEnd } from "./scroll-to-end";

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
  const chat = await openChat(user.id, { pages });
  if (!chat) redirect("/connect");
  const hasAskHistory = (await scopedFor(user.id).askConversations.count()) > 0;
  after(() => markChatRead(user.id));

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Chat with Jane</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          I look at your money every day and bring you what matters. Tap to answer.
        </p>
      </div>

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
      <ChatComposer id="chat-end" maxLength={CHAT_MAX_MESSAGE} />
      {hasAskHistory && (
        <Link
          href="/ask"
          className="-mt-4 inline-flex min-h-11 items-center self-start text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          Your earlier Ask Jane conversations ›
        </Link>
      )}
      {pages === 1 && <ScrollToEnd targetId="chat-end" />}
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
