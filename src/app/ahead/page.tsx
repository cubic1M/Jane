import type { Route } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AreaPage } from "@/components/area-page/area-page";
import { previousMonth } from "@/insights/check-in";
import { DECISIONS, itemId, plansTree } from "@/lib/area-pages/plans";
import { scopedDb } from "@/lib/db-scoped";
import { loadTradeoffs } from "@/lib/goal-tradeoffs";
import { listGoals } from "@/lib/goals";
import { loadAheadHub } from "@/lib/hubs/ahead";
import { loadNetWorthHistory } from "@/lib/net-worth-history";
import { requireUser } from "@/lib/session";

// Plans & goals (spec step 80; docs/design/area-pages.md): the area's tree, with what's coming
// up first, then goals and net worth, then the planning tools and the look-backs. Math from
// the person's own numbers, not advice.

const LINK = "font-medium underline underline-offset-2 hover:no-underline";

const go = (href: Route, label: string) => (
  <Link href={href} className={`${LINK} text-sm`}>
    {label}
  </Link>
);

const DECISION_LINKS: Record<string, string> = {
  afford: "Check a purchase",
  "what-if": "Pick a what-if",
  "long-view": "See the long view",
};

async function AheadContent({
  searchParams,
}: {
  searchParams: PageProps<"/ahead">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const params = await searchParams;
  const focus = typeof params.focus === "string" ? params.focus : undefined;
  const db = await scopedDb();
  const [data, accounts, goals, worth] = await Promise.all([
    loadAheadHub(user.id),
    db.accounts.count(),
    listGoals(user.id),
    loadNetWorthHistory(user.id),
  ]);
  // Spec step 241: only worth the year plan's work with two goals or more.
  const tradeoffs = goals.length >= 2 ? await loadTradeoffs(user.id) : null;
  const late = new Map((tradeoffs?.current?.dates ?? []).map((d) => [d.id, d.lateMonths]));
  const dates = data.dates ?? [];

  const area = plansTree({
    asOf: data.asOf,
    deadlines: dates,
    goals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      targetCents: g.targetCents,
      targetDate: g.targetDate,
      status: g.progress.status,
      savedCents: g.progress.savedCents,
      monthlyCents: g.progress.status === "on_the_way" ? g.progress.monthlyCents : null,
      lateMonths: tradeoffs?.competing ? (late.get(g.id) ?? null) : null,
    })),
    competing: !!tradeoffs?.competing,
    netWorth: worth
      ? {
          todayCents: worth.todayCents,
          lastMonthCents: worth.months.at(-2)?.netCents ?? null,
        }
      : null,
    lifeEvents: data.lifeEvents,
    lastMonth: {
      label: new Date(`${previousMonth(data.asOf)}-01T00:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        timeZone: "UTC",
      }),
    },
    year: Number(data.asOf.slice(0, 4)),
    yearly: data.yearly,
    debt: data.debt,
  });

  const details: Record<string, ReactNode> = {};
  const more: Record<string, ReactNode> = {};
  for (const d of dates) {
    const id = itemId("coming", d.key);
    details[id] = d.href
      ? go(d.href as Route, "Open it")
      : go("/deadlines", "See it with your dates");
    if (d.detail) more[id] = <p>{d.detail}</p>;
  }
  details[itemId("coming", "all")] = go("/deadlines", "See all your dates");
  more[itemId("coming", "all")] = (
    <p>
      Add one of your own, like a visa renewal or a lease end, on{" "}
      <Link href="/deadlines" className={LINK}>
        your dates
      </Link>
      .
    </p>
  );
  for (const g of goals)
    details[itemId("goals", g.id)] = (
      <>
        <p className="text-xs text-zinc-500">
          {g.accountName ? `Tracked with ${g.accountName}.` : "Tracked by hand."}
        </p>
        {go("/goals", "Change or delete it")}
      </>
    );
  details[itemId("goals", "tradeoffs")] = go("/goals", "Pick an order");
  details[itemId("goals", "add")] = go("/goals", goals.length === 0 ? "Set a goal" : "Add a goal");
  details[itemId("worth", "today")] = go("/net-worth", "See what you have and owe");
  for (const d of DECISIONS) details[itemId("decide", d.key)] = go(d.href, DECISION_LINKS[d.key]);
  details[itemId("life", "open")] = go("/life-events", "Open the checklist");
  details[itemId("life", "start")] = go("/life-events", "Start a checklist");
  details[itemId("back", "monthly")] = go("/monthly", "Read the report");
  details[itemId("back", "year")] = go("/year", "See your year");
  details[itemId("money", "yearly")] = go(
    data.yearly.bills > 0 ? "/budgets#yearly" : "/budgets",
    "See yearly bills",
  );
  details[itemId("money", "debt")] = go("/debt", "See the payoff plan");

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Plans &amp; goals</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          What&apos;s coming up and the tools to get ready. Math from your own numbers, not advice.
        </p>
        <nav aria-label="Plans pages" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/goals" className={LINK}>
            Goals
          </Link>
          <Link href="/net-worth" className={LINK}>
            Net worth
          </Link>
          <Link href="/deadlines" className={LINK}>
            Dates
          </Link>
          <Link href="/afford" className={LINK}>
            Can I afford this?
          </Link>
        </nav>
      </div>
      {accounts === 0 && (
        <p className="border border-zinc-300 p-4 dark:border-zinc-700">
          Link a bank and these fill in from your own numbers.{" "}
          <Link href="/connect" className={LINK}>
            Link an account
          </Link>
        </p>
      )}
      <AreaPage
        tree={area.tree}
        label="Plans & goals"
        chips={area.chips}
        summaries={area.summaries}
        details={details}
        more={more}
        focus={focus}
      />
    </>
  );
}

export default function AheadPage({ searchParams }: PageProps<"/ahead">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <AheadContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
