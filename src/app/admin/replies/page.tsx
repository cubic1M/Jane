import { Suspense } from "react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { deleteReply } from "./actions";
import { ReplyForm } from "./reply-form";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

async function Replies() {
  const admin = await requireAdmin();
  const replies = await db.savedReply.findMany({ orderBy: { title: "asc" } });
  return (
    <>
      <AdminNav email={admin.email} />
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Saved replies</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Common updates to people, to insert on an action page. Write them so they make sense
          without a name: they go to many people.
        </p>
      </div>
      <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <summary className="cursor-pointer font-semibold">Add a reply</summary>
        <div className="mt-4">
          <ReplyForm reply={null} />
        </div>
      </details>
      <ul className="flex flex-col gap-3">
        {replies.map((r) => (
          <li
            key={r.id}
            className="rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800"
          >
            <details>
              <summary className="cursor-pointer font-semibold">{r.title}</summary>
              <div className="mt-3 flex flex-col gap-3">
                <ReplyForm reply={r} />
                <form action={deleteReply}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton className="text-xs text-zinc-500 hover:text-red-700 hover:underline">
                    Delete
                  </SubmitButton>
                </form>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function RepliesPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Replies />
      </Suspense>
    </main>
  );
}
