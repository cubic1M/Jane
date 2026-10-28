"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startAgentAction, stopAgentAction } from "@/app/investments/agent-actions";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import {
  AGENT_INTERVAL_IDS,
  AGENT_INTERVALS,
  AGENT_MARKET_IDS,
  AGENT_MARKETS,
  AGENT_WARNING,
  type AgentInterval,
  type AgentMarketId,
} from "@/config/trading-agent";
import type { AgentView } from "@/lib/trading-agent/agent";
import { formatCents } from "@/lib/money";
import { VERDICT_WORDS, type EvidenceRow } from "@/planning/trading-agent/report";

// The 24-hour agent on the paper account: pick a market, how often and a strategy (each with how
// it did in the replay, losers marked), and it runs the account around the clock on simulated
// money; then its trades, each with its time, price, fees and reason. Demo advice only.

const BOX = "border border-zinc-400 bg-white dark:border-zinc-600 dark:bg-zinc-950";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center border-2 border-zinc-950 bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-60 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center border-2 border-zinc-950 px-4 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-50 dark:hover:bg-zinc-900";

const pct = (n: number) => `${n < 0 ? "−" : "+"}${Math.abs(n * 100).toFixed(1)}%`;
const time = (iso: string) =>
  `${new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} ET`;
const units = (q: number) => q.toLocaleString("en-US", { maximumFractionDigits: 6 });

export type AgentChoices = Readonly<Record<string, readonly EvidenceRow[]>>;
const keyOf = (m: AgentMarketId, i: AgentInterval) => `${m}:${i}`;

function result(r: EvidenceRow) {
  return `${pct(r.cagr)} a year (just holding ${pct(r.holdCagr)}), worst drop ${pct(-r.maxDrawdown)}: ${VERDICT_WORDS[r.verdict].toLowerCase()}`;
}

function Picker({ choices }: { choices: AgentChoices }) {
  const router = useRouter();
  const [market, setMarket] = useState<AgentMarketId>("crypto");
  const [interval, setEvery] = useState<AgentInterval>("1h");
  const rows = choices[keyOf(market, interval)] ?? [];
  const [policy, setPolicy] = useState<string>(rows[0]?.key ?? "");
  const chosen = rows.find((r) => r.key === policy) ?? rows[0];
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pick = (m: AgentMarketId, i: AgentInterval) => {
    setMarket(m);
    setEvery(i);
    setPolicy(choices[keyOf(m, i)]?.[0]?.key ?? "");
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!chosen) return;
        setError(null);
        start(async () => {
          const r = await startAgentAction(chosen.key, interval);
          if (!r.ok) return setError(r.error);
          router.refresh();
        });
      }}
    >
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 text-xs font-semibold">Market</legend>
        {AGENT_MARKET_IDS.map((m) => (
          <label key={m} className={`flex min-h-11 items-center gap-2 px-3 text-sm ${BOX}`}>
            <input
              type="radio"
              name="agent-market"
              checked={market === m}
              onChange={() => pick(m, interval)}
            />
            {AGENT_MARKETS[m].label}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 text-xs font-semibold">Every</legend>
        {AGENT_INTERVAL_IDS.map((i) => (
          <label key={i} className={`flex min-h-11 items-center gap-2 px-3 text-sm ${BOX}`}>
            <input
              type="radio"
              name="agent-interval"
              checked={interval === i}
              onChange={() => pick(market, i)}
            />
            {AGENT_INTERVALS[i].label}
          </label>
        ))}
      </fieldset>
      {rows.length === 0 ? (
        <p className="text-sm">No replay yet for this market at this interval.</p>
      ) : (
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Strategy
          <select
            value={chosen?.key}
            onChange={(e) => setPolicy(e.target.value)}
            className={`min-h-11 px-2 text-sm font-normal ${BOX}`}
            aria-label="Strategy for the 24-hour agent"
          >
            {rows.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label} ({pct(r.cagr)}/yr{r.verdict === "loses_money" ? ", lost money" : ""})
              </option>
            ))}
          </select>
        </label>
      )}
      {chosen && <p className="text-sm">In the replay: {result(chosen)}.</p>}
      <p className="text-xs">{AGENT_WARNING}</p>
      <div>
        <button type="submit" className={PRIMARY} disabled={pending || !chosen}>
          {pending ? "Starting…" : "Start the 24-hour agent"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold">
          [ERROR] {error}
        </p>
      )}
    </form>
  );
}

function Running({ view }: { view: AgentView }) {
  const router = useRouter();
  const [all, setAll] = useState(false);
  const [pending, start] = useTransition();
  const shown = all ? view.trades : view.trades.slice(0, 10);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="font-semibold">{view.label}</span> every {view.intervalLabel.toLowerCase()}
        , {view.marketLabel.toLowerCase()}.{" "}
        {view.lastBarAt ? `Caught up to the bar at ${time(view.lastBarAt)}.` : "Catching up."}{" "}
        {view.prices === "sample" ? "Sample prices: development only, not real." : "Real prices."}
      </p>
      <p className="text-xs">
        It catches up on every bar since the last each time you open this page and once a day, so
        its trades are the ones it would have made running without a break.
        {view.evidence ? ` In the replay: ${result(view.evidence)}.` : ""}
      </p>
      {view.trades.length === 0 ? (
        <p className="text-sm">No trades yet: the strategy hasn&apos;t asked for one.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="The 24-hour agent's trades">
            <thead>
              <tr className="text-left text-xs">
                <th className="py-1 pr-3 font-semibold">When</th>
                <th className="py-1 pr-3 font-semibold">Trade</th>
                <th className="py-1 pr-3 text-right font-semibold">Price</th>
                <th className="py-1 pr-3 text-right font-semibold">Fees</th>
                <th className="py-1 font-semibold">Why</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className="border-t border-zinc-300 align-top dark:border-zinc-700">
                  <td className="py-1 pr-3 whitespace-nowrap tabular-nums">{time(t.at)}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">
                    {t.side === "buy" ? "Bought" : "Sold"} {units(t.quantity)}{" "}
                    {t.ticker.replace("/USD", "")} ({formatCents(t.amountCents)})
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatCents(t.priceCents)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {formatCents(t.feeCents + t.spreadCents)}
                  </td>
                  <td className="py-1 text-xs">{t.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.trades.length > 10 && (
        <button type="button" className="self-start text-sm underline" onClick={() => setAll(!all)}>
          {all ? "Show the latest 10" : `Show all ${view.trades.length}`}
        </button>
      )}
      <p className="text-xs">Fees: the broker&apos;s fee plus what the spread and slippage cost.</p>
      <div>
        <button
          type="button"
          className={SECONDARY}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await stopAgentAction();
              router.refresh();
            })
          }
        >
          {pending ? "Stopping…" : "Stop the agent"}
        </button>
      </div>
    </div>
  );
}

export function TradingAgent({
  view,
  choices,
  honest,
}: {
  view: AgentView | null;
  choices: AgentChoices;
  // The replay's honest result in plain words (src/planning/trading-agent/honest-line.ts).
  honest?: string;
}) {
  return (
    <section aria-labelledby="agent-heading" className={`flex flex-col gap-3 p-4 ${BOX}`}>
      <h2 id="agent-heading" className="text-lg font-semibold">
        24-hour agent
      </h2>
      {honest && <p className="text-sm font-semibold">{honest}</p>}
      {view ? <Running view={view} /> : <Picker choices={choices} />}
      <DemoAdviceLabel />
    </section>
  );
}
