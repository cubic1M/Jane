import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { scopedDb } from "@/lib/db-scoped";
import { requireUser } from "@/lib/session";
import { deleteAskConversation } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// The person's earlier Ask Jane conversations (spec step 23), to read and delete. New questions
// go to the one chat, where Claude answers with every tool (docs/feature-audit.md, cluster 5):
// this page no longer asks anything itself. The chat links here only for people who have some.

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
        select: { id: true, role: true, content: true },
      })
    : [];

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your Ask Jane conversations</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Questions you asked before Jane&apos;s chat could answer everything. Ask anything new in
          the chat.
        </p>
        <Link
          href="/chat"
          className="inline-flex min-h-11 items-center self-start font-medium text-emerald-700 hover:underline"
        >
          Ask in the chat ›
        </Link>
      </div>

      {current && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">{current.title}</h2>
          <ul aria-label="Conversation" className="flex flex-col gap-3">
            {messages.map((m) => (
              <li
                key={m.id}
                className={
                  m.role === "assistant"
                    ? "rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                    : "self-end rounded-xl bg-zinc-100 p-3 dark:bg-zinc-900"
                }
              >
                <span className="sr-only">{m.role === "assistant" ? "Jane: " : "You: "}</span>
                <p className="whitespace-pre-line">{m.content}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {conversations.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">You have no earlier conversations.</p>
      ) : (
        <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h2 className="font-semibold">Conversations</h2>
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
                  <SubmitButton className="text-xs text-zinc-500 hover:text-red-700 hover:underline">
                    Delete
                  </SubmitButton>
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
      <Suspense fallback={<LoadingBar />}>
        <Ask searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
