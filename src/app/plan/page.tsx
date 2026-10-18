import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import { scopedDb } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { markPlanShown, planFor } from "@/lib/plan";
import { savingsLine } from "@/lib/savings-text";
import { requireUser } from "@/lib/session";
import { PlanItem } from "./plan-item";
import { YesToAll } from "./yes-to-all";

async function Plan({ searchParams }: { searchParams: PageProps<"/plan">["searchParams"] }) {
  const user = await requireUser();
  const db = await scopedDb();
  if ((await db.accounts.count()) === 0) redirect("/connect");
  const items = await planFor(user.id);
  await markPlanShown(
    user.id,
    items.map((i) => i.card.findingId),
  );
  const total = items.reduce((sum, i) => sum + (i.card.annualSavingsCents ?? 0), 0);
  // After "Yes to all".
  const params = await searchParams;
  const count = (value: unknown) => {
    const n = Number(typeof value === "string" ? value : NaN);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  const approved = count(params.approved);
  const skipped = count(params.skipped) ?? 0;

  return (
    <>
      <AppHeader email={user.email} />
      <ViewTracker event="plan_viewed" />
      {approved !== null && (
        <p role="status" className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950">
          Approved {approved} {approved === 1 ? "thing" : "things"}. Jane is on it; follow along on{" "}
          <Link href="/actions" className="font-medium text-emerald-700 underline">
            your actions
          </Link>
          .
          {skipped > 0 &&
            ` ${skipped} changed or were already answered, so they were left for you to look at again.`}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Jane&apos;s plan</h1>
        {items.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nothing to decide right now. Jane keeps watching and adds to your plan when it finds
            something. See what&apos;s underway on{" "}
            <Link href="/actions" className="font-medium text-emerald-700 hover:underline">
              your actions
            </Link>
            .
          </p>
        ) : (
          <p className="text-zinc-600 dark:text-zinc-400">
            {items.length} {items.length === 1 ? "thing" : "things"} Jane can do for you
            {total > 0
              ? `, worth up to about ${formatCents(total)} a year if you say yes to all`
              : ""}
            . Say yes, no, or change how Jane does it. Nothing happens until you say yes.
          </p>
        )}
      </div>
      {items.length > 1 && (
        <YesToAll
          items={items.map((i) => ({ findingId: i.card.findingId, cardHash: i.cardHash }))}
        />
      )}
      <ul className="flex flex-col gap-3">
        {items.map((i) => (
          <PlanItem
            key={i.card.findingId}
            item={{
              findingId: i.card.findingId,
              cardHash: i.cardHash,
              actionType: i.card.actionType,
              title: i.card.title,
              whatChanges: i.card.whatChanges,
              savings: savingsLine(i.card.findingType, i.card.annualSavingsCents),
              urgent: i.urgent,
              options: i.options,
            }}
          />
        ))}
      </ul>
    </>
  );
}

export default function PlanPage({ searchParams }: PageProps<"/plan">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Putting your plan together…</p>}>
        <Plan searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
