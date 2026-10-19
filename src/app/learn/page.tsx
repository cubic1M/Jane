import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { EXPLAINERS } from "@/config/learn";
import { requireUser } from "@/lib/session";

// Learn (spec step 136): every explainer, one line each.

async function LearnContent() {
  const user = await requireUser();
  await connection();
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Learn</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Short, plain explanations of the words Jane uses. They explain how things work; they
          aren&apos;t advice.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {EXPLAINERS.map((e) => (
          <li key={e.slug} className="flex flex-col gap-1">
            <Link
              href={`/learn/${e.slug}`}
              className="font-medium text-emerald-700 hover:underline"
            >
              {e.title}
            </Link>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">{e.summary}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function LearnPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <LearnContent />
      </Suspense>
    </main>
  );
}
