import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { HubGroups } from "@/components/hub-tile";
import { scopedDb } from "@/lib/db-scoped";
import { aheadTiles, loadAheadHub } from "@/lib/hubs/ahead";
import { requireUser } from "@/lib/session";

// The Ahead hub (spec step 80): the planning pages, with a live line where there's data.

async function AheadContent() {
  const user = await requireUser();
  await connection();
  const db = await scopedDb();
  const [data, accounts] = await Promise.all([loadAheadHub(user.id), db.accounts.count()]);

  return (
    <>
      <AppHeader email={user.email} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Plan ahead</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          What&apos;s coming up and the tools to get ready for it. Math from your own numbers, not
          advice.
        </p>
      </div>
      {accounts === 0 && (
        <p className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950">
          Link a bank and these fill in from your own numbers.{" "}
          <Link href="/connect" className="font-medium text-emerald-700 hover:underline">
            Link an account
          </Link>
        </p>
      )}
      <HubGroups groups={aheadTiles(data)} />
    </>
  );
}

export default function AheadPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <AheadContent />
      </Suspense>
    </main>
  );
}
