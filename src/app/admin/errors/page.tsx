import { Suspense } from "react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";

// Recent server errors, already scrubbed of personal data (src/lib/error-log.ts).
async function Errors() {
  const admin = await requireAdmin();
  const errors = await db.errorEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Server errors</h1>
      {errors.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">No errors recorded.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {errors.map((e) => (
            <li
              key={e.id}
              className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800"
            >
              <p className="font-semibold break-words">{e.message}</p>
              <p className="text-zinc-500">
                {e.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC · {e.method ?? ""}{" "}
                {e.path ?? ""} · {e.routeType ?? ""}
                {e.digest ? ` · digest ${e.digest}` : ""}
              </p>
              {e.stack && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-zinc-500">Stack</summary>
                  <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap">{e.stack}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ErrorsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Errors />
      </Suspense>
    </main>
  );
}
