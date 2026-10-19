import Link from "next/link";
import { redirect } from "next/navigation";
import { after, connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { markChatRead } from "@/lib/jane-agent/messages";
import { openChat } from "@/lib/jane-agent/open";
import { requireUser } from "@/lib/session";
import { ChatMessageItem } from "./message";
import { ScrollToEnd } from "./scroll-to-end";

// Jane's chat, the home screen (spec step 81): what Jane noticed, did and suggests, newest
// at the bottom, each with its buttons. The last CHAT_PAGE_SIZE messages, with "Show
// earlier". The message box opens Ask for now; typing to Jane in the chat is step 84.

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
  after(() => markChatRead(user.id));

  return (
    <>
      <AppHeader email={user.email} />
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

      {/* The message box: a stand-in until step 84 lets people type to Jane here. */}
      <Link
        id="chat-end"
        href="/ask"
        className="flex min-h-12 scroll-mb-[calc(4.5rem+env(safe-area-inset-bottom))] items-center gap-2 border border-zinc-400 px-3 text-zinc-600 hover:border-emerald-700 hover:text-zinc-950 sm:scroll-mb-4 dark:border-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        <span aria-hidden="true" className="text-emerald-700">
          &gt;
        </span>
        <span className="flex-1">Ask Jane anything</span>
        <span aria-hidden="true">›</span>
      </Link>
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
