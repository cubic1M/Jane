import { Suspense } from "react";
import { signOutToHome } from "@/lib/auth-actions";
import { requireUser } from "@/lib/session";

async function ImportContent() {
  const user = await requireUser();
  return (
    <>
      <header className="flex items-center justify-between gap-4 text-sm text-zinc-600 dark:text-zinc-400">
        <span>Signed in as {user.email}</span>
        <form action={signOutToHome}>
          <button type="submit" className="font-medium text-emerald-700 hover:underline">
            Sign out
          </button>
        </form>
      </header>

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Import your transactions</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          CSV upload is on its way. Soon you&apos;ll add your bank and card exports here and see
          what you could save.
        </p>
      </div>
    </>
  );
}

export default function ImportPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ImportContent />
      </Suspense>
    </main>
  );
}
