import type { Route } from "next";
import Link from "next/link";
import { after, connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AreaPage } from "@/components/area-page/area-page";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { BacktestsSection } from "@/components/backtests";
import { LevelStrategiesSection } from "@/components/level-strategies";
import { NewsThemesSection } from "@/components/news-themes";
import { StrategyMenuSection } from "@/components/strategy-menu";
import { PracticeIdeasSummary } from "@/components/practice-ideas-summary";
import { RuleReplaySection } from "@/components/rule-replay";
import { SimulatedBanner } from "@/components/simulated-banner";
import { ViewTracker } from "@/components/view-tracker";
import { areaOfCapability } from "@/config/areas";
import { SIMULATED_PARTNER } from "@/config/brokerage";
import { PRACTICE_TOPIC } from "@/config/practice-suggestions";
import { PAGES, investingTree, itemId } from "@/lib/area-pages/investing";
import { explainer } from "@/config/learn";
import { RETURNS_NOTE } from "@/config/returns";
import { formatReturn } from "@/insights/returns";
import { cryptoTotal } from "@/lib/crypto/crypto";
import { loadReturns } from "@/lib/investments/returns";
import { backtestsFor } from "@/lib/investments/backtest";
import { ruleReplaysFor } from "@/lib/investments/rule-replay";
import { latestStrategies } from "@/lib/investments/strategy-eval";
import { practiceIdeasView } from "@/lib/practice/ideas-view";
import { practiceProfileOf } from "@/lib/practice/preferences";
import { autopilotOf } from "@/lib/autopilot";
import { investmentsByHerself } from "@/lib/jane-agent/investments/replies";
import { autopilotFor } from "@/lib/sector-autopilot";
import { scopedFor } from "@/lib/db-scoped";
import { formatBps, type HoldingView } from "@/insights/investments";
import { loadInvestments } from "@/lib/investments/holdings";
import { profileOf } from "@/lib/investments/profile";
import { profileSummary } from "@/planning/investor-profile";
import { formatCents } from "@/lib/money";
import { scanOnOpenQuietly } from "@/lib/practice/scan";
import { requireUser } from "@/lib/session";

// What the person owns (spec step 128): every investment and retirement account, what's in
// it and where each number came from, and the balances month by month. The page is a tree
// (docs/design/area-pages.md): Jane's ideas, what's owned, how it's done, the practice
// portfolio with its strategies and news alerts, then the sub-pages; each section is the
// detail of its item.

const LINK = "font-medium underline underline-offset-2 hover:no-underline";
const CARD = "flex flex-col gap-1 border border-zinc-200 p-4 dark:border-zinc-800";
const PRACTICE_TOPICS: readonly string[] = Object.values(PRACTICE_TOPIC);

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const signed = (cents: number) =>
  cents < 0 ? `−${formatCents(-cents)}` : `+${formatCents(cents)}`;
const shares = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

function HoldingRow({ h }: { h: HoldingView }) {
  return (
    <li className="flex flex-col gap-2 border-t border-zinc-100 pt-3 first:border-0 first:pt-0 dark:border-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="font-medium break-words">
            {h.name}
            {h.ticker && <span className="ml-1 text-sm text-zinc-500">{h.ticker}</span>}
          </span>
          <span className="text-sm text-zinc-500">
            {h.category ?? h.type ?? "Security"}
            {!h.isCash && ` · ${shares(h.quantity)} at ${formatCents(h.priceCents)}`}
          </span>
        </div>
        <span className="font-semibold">{formatCents(h.valueCents)}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        {h.costBasisCents !== null && !h.isCash && (
          <div>
            <dt className="text-zinc-500">Paid</dt>
            <dd>
              {formatCents(h.costBasisCents)}
              {h.gainCents !== null && (
                <span className={h.gainCents < 0 ? "ml-1 font-semibold" : "ml-1"}>
                  {signed(h.gainCents)}
                </span>
              )}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-zinc-500">Yearly fund cost</dt>
          <dd>{h.expenseRatioBps === null ? "Not known" : formatBps(h.expenseRatioBps)}</dd>
        </div>
      </dl>
      <p className="text-xs text-zinc-500">
        Source: {h.source}
        {h.factsSource ? `. Fund facts: ${h.factsSource}` : ""}.
      </p>
    </li>
  );
}

// "Did the extra rules help?": a few seconds of replay the first time, so it streams in after
// the rest of the page.
// The strategy each level follows (the daily replay's choice), with the person's own level.
async function LevelStrategies({ userId }: { userId: string }) {
  const [latest, profile] = await Promise.all([latestStrategies(), practiceProfileOf(userId)]);
  return <LevelStrategiesSection latest={latest} level={profile.level} />;
}

// More strategies, at the person's own level.
async function StrategyMenu({ userId }: { userId: string }) {
  const profile = await practiceProfileOf(userId);
  return (
    <StrategyMenuSection
      level={profile.level}
      choice={profile.strategyChoice}
      crypto={profile.crypto?.strategy ?? null}
      dayTrading={profile.dayTrade?.rule ?? null}
    />
  );
}

async function RuleReplays({ userId }: { userId: string }) {
  const [replays, profile] = await Promise.all([ruleReplaysFor(userId), practiceProfileOf(userId)]);
  return replays.advice && replays.data ? (
    <RuleReplaySection data={replays.data} level={profile.level} />
  ) : null;
}

async function InvestmentsContent({
  searchParams,
}: {
  searchParams: PageProps<"/investments">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const params = await searchParams;
  const focus = typeof params.focus === "string" ? params.focus : undefined;
  // Constant search (Phase AW): a cheap practice scan, after the page is sent.
  after(() => scanOnOpenQuietly(user.id));
  const db = scopedFor(user.id);
  const data = await loadInvestments(user.id);
  const [answers, simulated, level, investing, returns, crypto, backtests, suggestions] =
    await Promise.all([
      profileOf(user.id),
      // Spec step 133: holdings shaped by simulated orders say so.
      db.brokerageOrders.count({ where: { partner: SIMULATED_PARTNER } }),
      // Spec step 137: what Jane does by herself at the person's autopilot level.
      autopilotOf(user.id),
      // Spec step 141: what the Investing area may do by itself.
      autopilotFor(user.id, "investing"),
      // Spec step 156: how they've done.
      loadReturns(user.id, { investments: data }),
      // Spec step 161: crypto, read-only, counted in the mix.
      cryptoTotal(user.id),
      // Spec step 295: each risk level replayed over past prices (demo advice only).
      backtestsFor(user.id),
      // Jane's open ideas on real money in this area (practice ideas are the practice branch's).
      db.suggestions.findMany({
        where: { status: { in: ["waiting", "selected"] } },
        select: {
          key: true,
          capability: true,
          topic: true,
          short: true,
          why: true,
          worthCents: true,
          worthKind: true,
          urgency: true,
          actionLabel: true,
          actionHref: true,
        },
        orderBy: { score: "desc" },
      }),
    ]);
  // The practice portfolio and its ideas: demo advice only.
  const started = backtests.advice
    ? !!(await db.practicePortfolios.findFirst({ select: { id: true } }))
    : false;
  const ideas = started ? await practiceIdeasView(user.id) : null;
  const mine = suggestions.filter(
    (s) => areaOfCapability(s.capability) === "investments" && !PRACTICE_TOPICS.includes(s.topic),
  );
  const byHerself = investmentsByHerself(level, investing);
  const profile = profileSummary(answers, data.asOf);
  const max = Math.max(1, ...data.months.map((m) => m.totalCents ?? 0));
  const hasMonths = data.months.some((m) => m.totalCents !== null);

  const area = investingTree({
    suggestions: mine,
    accounts: data.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      balanceCents: a.balanceCents,
      holdings: a.holdings.length,
    })),
    totalCents: data.totalCents,
    byType: data.byAssetClass.length,
    cryptoCents: crypto,
    profile: { complete: profile.complete, label: profile.complete ? profile.label : null },
    returns: { periods: returns.periods.length },
    months: data.accounts.length > 0,
    practice: backtests.advice
      ? {
          started,
          ideas: (ideas?.ideas ?? []).map((i) => ({
            key: i.suggestionKey,
            kind: i.kind,
            headline: i.headline,
            percent: i.confidence.percent,
            worthCents: i.worthCents,
          })),
          strategy: ideas?.strategy ?? null,
        }
      : null,
  });

  const details: Record<string, ReactNode> = {};
  const more: Record<string, ReactNode> = {};
  const go = (href: Route, label: string) => (
    <Link href={href} className={`${LINK} text-sm`}>
      {label}
    </Link>
  );

  for (const s of mine) {
    const id = itemId("ideas", s.key);
    details[id] = s.actionHref ? go(s.actionHref as Route, s.actionLabel ?? "Open it") : null;
    if (s.why) more[id] = <p>{s.why}</p>;
  }

  details[itemId("owned", "total")] = (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className={CARD}>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">In total</span>
        <span className="text-2xl font-semibold">{formatCents(data.totalCents)}</span>
        <span className="text-xs text-zinc-500">
          The same as in your{" "}
          <Link href="/net-worth" className={LINK}>
            net worth
          </Link>
        </span>
      </div>
      <div className={CARD}>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">Retirement</span>
        <span className="text-2xl font-semibold">{formatCents(data.byKind.retirement)}</span>
      </div>
      <div className={CARD}>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">Other investing</span>
        <span className="text-2xl font-semibold">{formatCents(data.byKind.investment)}</span>
      </div>
    </div>
  );
  for (const a of data.accounts)
    details[itemId("owned", a.id)] = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-zinc-500">
          {a.label}
          {a.institution ? ` · ${a.institution}` : ""}
          {a.balanceCents === null ? "" : ` · ${formatCents(a.balanceCents)}`}
        </p>
        {a.holdings.length > 0 && (
          <>
            <ul className="flex flex-col gap-3">
              {a.holdings.map((h) => (
                <HoldingRow key={h.id} h={h} />
              ))}
            </ul>
            {!a.holdingsMatch && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                The holdings add up to {formatCents(a.holdingsCents)}, not the balance your bank
                reports; the balance is what counts in your net worth.
              </p>
            )}
          </>
        )}
      </div>
    );
  details[itemId("owned", "by-type")] = (
    <ul className="flex flex-col gap-1 text-sm">
      {data.byAssetClass.map((c) => (
        <li key={c.assetClass} className="flex justify-between gap-2">
          <span>{c.label}</span>
          <span>{formatCents(c.valueCents)}</span>
        </li>
      ))}
      {crypto > 0 && (
        <li className="flex justify-between gap-2">
          <span>Crypto</span>
          <span>{formatCents(crypto)}</span>
        </li>
      )}
    </ul>
  );
  more[itemId("owned", "by-type")] = (
    <p>Funds are split by what they hold, from the fund facts shown on each one.</p>
  );
  details[itemId("owned", "crypto")] = go("/investments/crypto", "See your crypto");

  details[itemId("done", "returns")] = (
    <section className="flex flex-col gap-2" aria-labelledby="returns-heading">
      <h2 id="returns-heading" className="text-lg font-semibold">
        How they&apos;ve done
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="font-normal">Period</th>
              <th className="text-right font-normal">Investments</th>
              <th className="text-right font-normal">Your money</th>
              <th className="text-right font-normal">Similar mix</th>
              <th className="text-right font-normal">Paid out</th>
            </tr>
          </thead>
          <tbody>
            {returns.periods.map((p) => (
              <tr key={p.key}>
                <td>{p.label}</td>
                <td className="text-right">
                  {p.timeWeighted === null ? "–" : formatReturn(p.timeWeighted)}
                </td>
                <td className="text-right">
                  {p.moneyWeighted === null ? "–" : formatReturn(p.moneyWeighted)}
                </td>
                <td className="text-right">
                  {p.benchmark === null ? "–" : formatReturn(p.benchmark)}
                </td>
                <td className="text-right">{formatCents(p.incomeCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
  more[itemId("done", "returns")] = (
    <p>
      Investments: how what you own did, leaving out money you paid in. Your money: what your own
      money earned, timing included. Similar mix: low-cost index funds in the same shares as yours.
      Paid out: dividends and interest. {RETURNS_NOTE}
      {returns.simulatedPrices && " Prices come from the demo price feed (made up)."}
    </p>
  );
  details[itemId("done", "months")] = hasMonths ? (
    <>
      <ul className="flex flex-col gap-2 text-sm">
        {data.months.map((m) => (
          <li key={m.month} className="grid grid-cols-[5.5rem_1fr_7rem] items-center gap-2">
            <span className="text-zinc-500">{monthLabel(m.month)}</span>
            <span className="flex h-3 overflow-hidden bg-zinc-100 dark:bg-zinc-900" aria-hidden>
              <span
                className="block h-full bg-zinc-900 dark:bg-zinc-100"
                style={{ width: `${(m.retirementCents / max) * 100}%` }}
              />
              <span
                className="block h-full bg-zinc-400 dark:bg-zinc-500"
                style={{ width: `${(m.investmentCents / max) * 100}%` }}
              />
            </span>
            <span className="text-right">
              {m.totalCents === null ? "–" : formatCents(m.totalCents)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-500">Darker: retirement. Lighter: other investing.</p>
    </>
  ) : (
    <p className="text-sm text-zinc-600 dark:text-zinc-400">
      We take a snapshot of your balances each day; this fills in from today.
    </p>
  );
  details[itemId("done", "performance")] = go(
    "/investments/performance",
    "How your money really did",
  );

  for (const i of ideas?.ideas ?? []) {
    const branch = i.kind === "news_idea" ? "news" : "practice";
    details[itemId(branch, i.suggestionKey)] = (
      <>
        {go("/investments/practice", "Answer it on your practice portfolio")}
        <DemoAdviceLabel />
      </>
    );
    more[itemId(branch, i.suggestionKey)] = (
      <p>
        {i.confidence.percent}% sure: {i.confidence.reason}
      </p>
    );
  }
  details[itemId("practice", "portfolio")] = ideas ? (
    <PracticeIdeasSummary view={ideas} />
  ) : (
    go("/investments/practice", "Practice portfolio")
  );
  details[itemId("news", "none")] = go("/investments/practice", "Your practice portfolio");
  details[itemId("strategies", "today")] = go("/investments/practice", "Your practice portfolio");
  details[itemId("strategies", "levels")] = <LevelStrategies userId={user.id} />;
  details[itemId("strategies", "menu")] = <StrategyMenu userId={user.id} />;
  details[itemId("news", "themes")] = <NewsThemesSection />;
  if (backtests.advice)
    details[itemId("strategies", "backtests")] = (
      <BacktestsSection backtests={backtests.backtests} />
    );
  details[itemId("strategies", "rules")] = (
    <Suspense
      fallback={<p className="text-sm text-zinc-500">Replaying the autopilot&apos;s rules…</p>}
    >
      <RuleReplays userId={user.id} />
    </Suspense>
  );

  details[itemId("plan", "profile")] = go(
    "/investments/profile",
    profile.complete ? "Change it" : "Answer them",
  );
  for (const branch of ["plan", "kinds", "costs"] as const)
    for (const pg of PAGES[branch]) details[itemId(branch, pg.key)] = go(pg.href, pg.label);

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="investments_viewed" />
      {simulated > 0 && <SimulatedBanner />}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Investments</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Your retirement and investment accounts, as your bank reports them. Open a branch to see
          more.
        </p>
        <nav aria-label="Investing pages" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link prefetch={false} href="/investments/practice" className={LINK}>
            Practice portfolio
          </Link>
          <Link prefetch={false} href="/investments/review" className={LINK}>
            Portfolio review
          </Link>
          <Link prefetch={false} href="/investments/fees" className={LINK}>
            Fees
          </Link>
          <Link prefetch={false} href="/investments/profile" className={LINK}>
            Investor profile
          </Link>
        </nav>
      </div>

      {data.accounts.length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">
          No investment or retirement accounts yet. When you{" "}
          <Link href="/connect" className={LINK}>
            link one
          </Link>
          , what it holds shows here.
        </p>
      )}

      <AreaPage
        tree={area.tree}
        label="Investing"
        chips={area.chips}
        summaries={area.summaries}
        details={details}
        more={more}
        focus={focus}
      />

      {/* Below the tree: nothing open by default (docs/design/area-pages.md). */}
      <div className="flex flex-col gap-2">
        <details className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <summary className={`cursor-pointer text-sm ${LINK}`}>What Jane does by herself</summary>
          <section aria-labelledby="by-herself" className="mt-2 flex flex-col gap-2 text-sm">
            <h2 id="by-herself" className="sr-only">
              What Jane does by herself
            </h2>
            <ul className="list-disc pl-5">
              {byHerself.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <Link href="/settings#sectors" className={LINK}>
              Change your autopilot
            </Link>
          </section>
        </details>
        <details className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <summary className={`cursor-pointer text-sm ${LINK}`}>Learn the basics</summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {["index-funds", "fees", "the-match", "roth-vs-traditional", "rebalancing"].map(
              (slug) => (
                <li key={slug}>
                  <Link href={`/learn/${slug}`} className={LINK}>
                    {explainer(slug)?.title.toLowerCase()}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </details>
      </div>
    </>
  );
}

export default function InvestmentsPage({ searchParams }: PageProps<"/investments">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <InvestmentsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
