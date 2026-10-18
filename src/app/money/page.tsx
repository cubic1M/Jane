import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { HubGroups } from "@/components/hub-tile";
import { loadMoneyHub, moneyTiles } from "@/lib/hubs/money";
import { requireUser } from "@/lib/session";

// The Money hub (spec step 80): the picture of your money, one tile per page.

async function MoneyContent() {
  const user = await requireUser();
  await connection();
  const data = await loadMoneyHub(user.id);

  return (
    <>
      <AppHeader email={user.email} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your money</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          What you have, what goes out and what you owe, from your accounts. Open any tile for the
          details.
        </p>
      </div>
      {!data.hasAccounts && (
        <p className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950">
          Link a bank to fill these in.{" "}
          <Link href="/connect" className="font-medium text-emerald-700 hover:underline">
            Link an account
          </Link>
        </p>
      )}
      <HubGroups groups={moneyTiles(data)} />
    </>
  );
}

export default function MoneyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <MoneyContent />
      </Suspense>
    </main>
  );
}
