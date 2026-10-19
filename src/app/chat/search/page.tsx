import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { timezoneOf } from "@/lib/jane-agent/open";
import { searchChat } from "@/lib/jane-agent/search";
import { requireUser } from "@/lib/session";

// Searching Jane's chat (spec step 96): words (a merchant is a word), an amount or a day,
// over the person's own messages only. Each result opens the chat at that message.

const MAX_QUERY = 100;

async function Results({
  searchParams,
}: {
  searchParams: PageProps<"/chat/search">["searchParams"];
}) {
  await connection();
  const user = await requireUser();
  const raw = (await searchParams).q;
  const q = (typeof raw === "string" ? raw : "").slice(0, MAX_QUERY).trim();
  const timezone = await timezoneOf(user.id);
  const results = q ? await searchChat(user.id, q, { timezone }) : [];
  return (
    <>
      <AppHeader user={user} />
      <Link
        href="/chat"
        className="inline-flex min-h-11 items-center text-sm text-emerald-700 hover:underline"
      >
        ‹ Back to the chat
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Search the chat</h1>
      <form role="search" className="flex gap-2">
        <input
          name="q"
          type="search"
          defaultValue={q}
          aria-label="Search the chat"
          placeholder="Words, $17.99, Oct 20"
          maxLength={MAX_QUERY}
          className="min-h-11 min-w-0 flex-1 border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-semibold text-emerald-700 hover:underline"
        >
          <span aria-hidden="true">[</span>Search<span aria-hidden="true">]</span>
        </button>
      </form>
      {q && (
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
          {results.length === 0
            ? `Nothing found for "${q}".`
            : `${results.length} ${results.length === 1 ? "message" : "messages"} found for "${q}".`}
        </p>
      )}
      <ol aria-label="Results" className="flex flex-col gap-3">
        {results.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-1 border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <span className="text-xs text-zinc-500">
              {r.kind === "user" ? "You" : "Jane"} ·{" "}
              {r.createdAt.toLocaleString("en-US", {
                timeZone: timezone ?? "America/Los_Angeles",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <p className="whitespace-pre-line [overflow-wrap:anywhere]">{r.body}</p>
            <Link
              href={r.href}
              className="inline-flex min-h-11 items-center self-start text-sm font-medium text-emerald-700 hover:underline"
            >
              Show in the chat ›
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}

export default function ChatSearchPage({ searchParams }: PageProps<"/chat/search">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 sm:py-10">
      <Suspense fallback={<p className="text-zinc-500">Searching…</p>}>
        <Results searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
