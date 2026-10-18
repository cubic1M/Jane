import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ASK_MAX_QUESTION } from "@/config/ask";
import { scopedDb } from "@/lib/db-scoped";
import { requireUser } from "@/lib/session";
import { deleteAskConversation } from "./actions";
import { AskChat, type ChatMessage } from "./chat";

const RECENT = 20;

async function Ask({ searchParams }: { searchParams: PageProps<"/ask">["searchParams"] }) {
  const user = await requireUser();
  const db = await scopedDb();
  const { c } = await searchParams;
  const conversations = await db.askConversations.findMany({
    select: { id: true, title: true },
    orderBy: { updatedAt: "desc" },
    take: RECENT,
  });
  const current = typeof c === "string" ? conversations.find((x) => x.id === c) : undefined;
  const messages = current
    ? await db.askMessages.findMany({
        where: { conversationId: current.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { role: true, content: true, blocked: true },
      })
    : [];

  return (
    <>
      <AppHeader email={user.email} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Ask Jane</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Questions about your own spending, bills and savings. Jane looks up your data to answer
          and only uses numbers she found. It&apos;s not financial, tax or legal advice.
        </p>
      </div>

      <AskChat
        key={current?.id ?? "new"}
        conversationId={current?.id ?? null}
        initial={messages.map((m): ChatMessage => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
          blocked: m.blocked,
        }))}
        maxLength={ASK_MAX_QUESTION}
      />

      {conversations.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-semibold">Your conversations</h2>
            {current && (
              <Link href="/ask" className="text-sm font-medium text-emerald-700 hover:underline">
                New conversation
              </Link>
            )}
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {conversations.map((conversation) => (
              <li key={conversation.id} className="flex items-center justify-between gap-2">
                <Link
                  href={`/ask?c=${conversation.id}`}
                  className={`min-w-0 truncate hover:underline ${conversation.id === current?.id ? "font-semibold" : ""}`}
                >
                  {conversation.title}
                </Link>
                <form action={deleteAskConversation}>
                  <input type="hidden" name="conversationId" value={conversation.id} />
                  <button
                    type="submit"
                    className="text-xs text-zinc-500 hover:text-red-700 hover:underline"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export default function AskPage({ searchParams }: PageProps<"/ask">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Ask searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
