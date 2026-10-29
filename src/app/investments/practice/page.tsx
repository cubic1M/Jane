import Link from "next/link";
import { after, connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { PracticeIdeasSection } from "@/components/practice-ideas";
import { RISK_LEVELS } from "@/config/investing";
import {
  CRYPTO_PRACTICE_TICKERS,
  DAY_TRADE_TICKER,
  HARVEST_PARTNERS,
  MODEL_PORTFOLIOS,
  PRACTICE_ETFS,
} from "@/config/portfolios";
import { adviceMode } from "@/lib/advice-mode";
import { practicePaidIn } from "@/lib/investments/practice-paid-in";
import { formatCents } from "@/lib/money";
import { tradeLog } from "@/lib/practice/autopilot";
import { practiceIdeasView } from "@/lib/practice/ideas-view";
import { loadPractice } from "@/lib/practice/portfolio";
import { scanOnOpenQuietly } from "@/lib/practice/scan";
import { requireUser } from "@/lib/session";
import { pauseSwitch, runNow, startPracticePortfolio, undoLast } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// The practice portfolio (spec steps 288 to 294, Phase AW, Stage A): a paper portfolio run by
// Jane on practice money, with its trade log and a pause switch. Nothing here is a real account
// and no real money moves. Demo advice only.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const OUTLINE = "h-10 rounded-lg border border-zinc-300 px-4 text-sm dark:border-zinc-700";
const MESSAGES: Record<string, string> = {
  started: "Started with practice money. Jane has bought the model for your level.",
  ran: "Done. Anything that needed doing is in the log.",
  paused: "Paused. Jane won't trade until you resume.",
  resumed: "Resumed.",
  undone: "The last trade is undone.",
  nothing: "There's nothing to undo.",
  exists: "You already have a practice portfolio.",
  level: "Pick a level first.",
  idea_done: "Done in your practice portfolio: it's in the log below.",
  idea_held: "A cap stopped it, so nothing was done.",
  idea_paused: "Your practice portfolio is paused, so nothing was done.",
  idea_no: "OK, put away. Jane brings that kind of idea a little later now.",
  idea_gone: "That idea has already moved on.",
};
// A fund's name with its ticker, for the model funds and their swap partners; a coin by its name;
// a stock by ticker.
const COINS: Readonly<Record<string, string>> = {
  [CRYPTO_PRACTICE_TICKERS.BTC]: "Bitcoin",
  [CRYPTO_PRACTICE_TICKERS.ETH]: "Ether",
};
const fundName = (ticker: string) => {
  if (COINS[ticker]) return `${COINS[ticker]} (crypto sleeve)`;
  if (ticker === DAY_TRADE_TICKER) return `S&P 500 ETF (${ticker}, day trading)`;
  const fund = [...Object.values(PRACTICE_ETFS), ...Object.values(HARVEST_PARTNERS)].find(
    (e) => e?.ticker === ticker,
  );
  return fund ? `${fund.name} (${ticker})` : ticker;
};

const when = (d: Date) =>
  d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/practice">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done: rawDone } = await searchParams;
  const done = Array.isArray(rawDone) ? rawDone[0] : rawDone;
  const advice = await adviceMode(user.id);
  // Constant search (Phase AW): a cheap scan, after the page is sent; demo advice only.
  if (advice) after(() => scanOnOpenQuietly(user.id));
  const practice = advice ? await loadPractice(user.id) : null;
  const [log, ideas, paidIn] = practice
    ? await Promise.all([tradeLog(user.id), practiceIdeasView(user.id), practicePaidIn(user.id)])
    : [[], null, 0];
  // Up or down against all the practice money put in, not the starting money alone.
  const gain = practice ? practice.totalCents - paidIn : 0;
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Practice portfolio</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane runs a portfolio on practice money: it buys a model for your risk level, keeps it on
          target and adds a little each month. It is a paper portfolio. No real money moves and no
          real account is touched.
        </p>
      </div>
      {done && MESSAGES[done] && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {MESSAGES[done]}
        </p>
      )}
      {!advice && (
        <p className="text-zinc-600 dark:text-zinc-400">
          The practice portfolio is only available in demo advice mode for now.
        </p>
      )}
      {advice && !practice && (
        <form action={startPracticePortfolio} className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="font-semibold">Pick a level</legend>
            {([1, 2, 3, 4, 5] as const).map((l) => {
              const w = MODEL_PORTFOLIOS[l].weights;
              return (
                <label key={l} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="level"
                    value={l}
                    defaultChecked={l === 3}
                    className="mt-1"
                  />
                  <span>
                    <strong>{RISK_LEVELS[l].label}</strong>:{" "}
                    {Math.round((w.us_stocks + w.intl_stocks) * 100)}% stocks,{" "}
                    {Math.round(w.bonds * 100)}% bonds, {Math.round(w.cash * 100)}% short-term
                    bills. {RISK_LEVELS[l].description}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <SubmitButton className={`${BUTTON} self-start`}>Start with practice money</SubmitButton>
          <Link href="/investments/practice/settings" className={`text-sm ${LINK}`}>
            Set your goal, extra moves and what to avoid first →
          </Link>
          <DemoAdviceLabel />
        </form>
      )}
      {advice && practice && (
        <>
          <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-xl font-semibold">
              {RISK_LEVELS[practice.level].label}: {formatCents(practice.totalCents)}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {paidIn > practice.startingCents
                ? `You've put in ${formatCents(paidIn)} of practice money: ${formatCents(practice.startingCents)} to start, then ${formatCents(practice.monthlyAddCents)} a month.`
                : `Started with ${formatCents(practice.startingCents)} of practice money.`}{" "}
              {gain === 0
                ? "That's even."
                : `That's ${formatCents(Math.abs(gain))} ${gain > 0 ? "more" : "less"} than went in.`}{" "}
              {formatCents(practice.state.cashCents)} is waiting as cash.
            </p>
            <ul className="text-sm">
              {practice.holdings.map((h) => (
                <li key={h.ticker}>
                  {fundName(h.ticker)}: {formatCents(h.valueCents)}
                </li>
              ))}
            </ul>
            {/* The pause switch: a card in the chat opens it here (step 296). */}
            <div id="pause" className="flex scroll-mt-20 flex-wrap gap-2">
              <form action={pauseSwitch}>
                <input type="hidden" name="which" value="all" />
                <input type="hidden" name="paused" value={practice.paused ? "0" : "1"} />
                <SubmitButton className={OUTLINE}>
                  {practice.paused ? "Resume Jane" : "Pause Jane"}
                </SubmitButton>
              </form>
              <form action={pauseSwitch}>
                <input type="hidden" name="which" value="opportunities" />
                <input
                  type="hidden"
                  name="paused"
                  value={practice.opportunitiesPaused ? "0" : "1"}
                />
                <SubmitButton className={OUTLINE}>
                  {practice.opportunitiesPaused ? "Resume opportunities" : "Pause opportunities"}
                </SubmitButton>
              </form>
              <form action={runNow}>
                <SubmitButton className={OUTLINE} disabled={practice.paused}>
                  Check now
                </SubmitButton>
              </form>
              <form action={undoLast}>
                <SubmitButton className={OUTLINE}>Undo the last trade</SubmitButton>
              </form>
            </div>
            {practice.paused && <p className="text-sm">Paused: no trades until you resume.</p>}
            {!practice.paused && practice.opportunitiesPaused && (
              <p className="text-sm">Opportunities paused: Jane only keeps the model on target.</p>
            )}
            <Link href="/investments/practice/settings" className={`text-sm ${LINK}`}>
              Settings: risk, goal, extra moves, what to avoid →
            </Link>
            <DemoAdviceLabel />
          </section>
          {ideas && <PracticeIdeasSection view={ideas} />}
          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">Everything Jane did</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="font-normal">When</th>
                  <th className="font-normal">What</th>
                  <th className="text-right font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {log.map((t) => (
                  <tr key={t.id} className={t.undone ? "text-zinc-400 line-through" : ""}>
                    <td className="align-top">{when(t.placedAt)}</td>
                    <td>
                      {t.side === "deposit"
                        ? "Practice money in"
                        : `${t.side === "buy" ? "Bought" : "Sold"} ${t.ticker}`}
                      <span className="block text-xs text-zinc-500">{t.reason}</span>
                    </td>
                    <td className="text-right align-top">{formatCents(t.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}

export default function PracticePage(props: PageProps<"/investments/practice">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
