import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { loadDetectionInput } from "@/detection/engine";
import { recurringCharges, type RecurringCharge } from "@/detection/subscriptions";
import { frequencyWords } from "@/lib/explain-input";
import { scopedDb } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

const day = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "–";

function Rows({ rows, cards }: { rows: RecurringCharge[]; cards: Map<string, string> }) {
  return (
    <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
      {rows.map((r) => (
        <li
          key={r.key}
          className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 [overflow-wrap:anywhere]"
        >
          <span className="flex flex-col">
            <span className="font-medium">{r.merchant}</span>
            <span className="text-xs text-zinc-500">
              {formatCents(r.lastAmountCents)} {frequencyWords(r.frequency)} · last{" "}
              {day(r.lastDate)} · next {day(r.nextDate)}
            </span>
            {cards.has(r.key) && (
              <Link
                href={`/report/${cards.get(r.key)}`}
                className="text-xs font-medium text-emerald-700 hover:underline"
              >
                Cancel or review
              </Link>
            )}
          </span>
          <span className="font-medium">{formatCents(r.annualCostCents)} a year</span>
        </li>
      ))}
    </ul>
  );
}

async function Subscriptions() {
  const user = await requireUser();
  const db = await scopedDb();
  const [input, confirmed] = await Promise.all([
    loadDetectionInput(user.id),
    db.subscriptionChecks.findMany({
      where: { isSubscription: true },
      select: { merchantKey: true },
    }),
  ]);
  if (input.accounts.length === 0) redirect("/connect");
  input.subscriptionMerchantKeys = confirmed.map((c) => c.merchantKey);
  const rows = recurringCharges(input);
  const findings = await db.findings.findMany({
    where: {
      type: "subscription_review",
      status: { in: ["new", "shown"] },
      key: { in: rows.map((r) => r.key) },
    },
    select: { id: true, key: true },
  });
  const cards = new Map(findings.map((f) => [f.key, f.id]));
  const subscriptions = rows.filter((r) => r.subscription);
  const other = rows.filter((r) => !r.subscription);
  const total = (list: RecurringCharge[]) => list.reduce((sum, r) => sum + r.annualCostCents, 0);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Subscriptions and regular bills</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Everything that charges you on a schedule, from your transactions. Next dates are
          estimates. Yearly and quarterly renewals get an alert a week ahead.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">Subscriptions</h2>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatCents(total(subscriptions))} a year
          </span>
        </div>
        {subscriptions.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">No subscriptions found.</p>
        ) : (
          <Rows rows={subscriptions} cards={cards} />
        )}
      </section>

      {other.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold">Other regular bills</h2>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {formatCents(total(other))} a year
            </span>
          </div>
          <Rows rows={other} cards={cards} />
        </section>
      )}
    </>
  );
}

export default function SubscriptionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Subscriptions />
      </Suspense>
    </main>
  );
}
