"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { startPaperAction } from "@/app/investments/paper-actions";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { PAPER_DEFAULT_START_CENTS } from "@/config/paper";
import type { PaperView } from "@/lib/paper/account";
import { formatCents } from "@/lib/money";

// The paper account on the investments page, Home's way: one big number, a graph of the account
// against just holding the level's mix (dashed) with a dot for every trade, and the positions and
// the trade log a tap away. Before it starts: the starting balance and Start. Simulated only.

const dollars = (cents: number) => formatCents(cents).replace(/\.\d\d$/, "");
const signed = (cents: number) => `${cents >= 0 ? "+" : "−"}${dollars(Math.abs(cents))}`;
const share = (n: number) => `${n >= 0 ? "+" : "−"}${(Math.abs(n) * 100).toFixed(1)}%`;
const BOX = "border border-zinc-400 bg-white dark:border-zinc-600 dark:bg-zinc-950";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center border-2 border-zinc-950 bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-60 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950";

const SOURCE_WORDS: Record<string, string> = {
  alpaca: "Real daily closes (Alpaca)",
  yahoo: "Real daily closes (Yahoo Finance)",
  sample: "Sample prices: development only, not real",
  // The 24-hour agent's bars (src/lib/trading-agent/bar-store.ts).
  live: "Real prices, bar by bar (Alpaca, or Yahoo Finance for funds)",
};

function Start({ strategy }: { strategy: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(PAPER_DEFAULT_START_CENTS / 100));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await startPaperAction(amount);
          if (!r.ok) return setError(r.error);
          window.dispatchEvent(new Event("paper:signals"));
          router.refresh();
        });
      }}
    >
      <p className="text-sm">
        Run <span className="font-semibold">{strategy}</span> on simulated money at real prices.
        Jane brings each trade it wants in a pop-up.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Starting balance
          <span className={`flex items-center px-2 ${BOX}`}>
            <span aria-hidden="true">$</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="min-h-11 w-32 bg-transparent px-1 text-base tabular-nums outline-none"
              aria-label="Starting balance in dollars"
            />
          </span>
        </label>
        <button type="submit" className={PRIMARY} disabled={pending}>
          {pending ? "Starting…" : "Start paper account"}
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

function Graph({ view }: { view: PaperView }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    if (box.current) setWidth(box.current.clientWidth);
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const H = 170;
  const pad = { left: 6, right: 6, top: 10, bottom: 10 };
  const pts = view.values.length > 0 ? view.values : [];
  if (pts.length < 2)
    return (
      <p className="text-xs text-zinc-600 dark:text-zinc-400" data-paper-graph="waiting">
        The graph fills in after each market close.
      </p>
    );
  const all = pts.flatMap((p) => [p.valueCents, p.holdCents]);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = Math.max(1, hi - lo);
  const x = (i: number) => pad.left + (i / (pts.length - 1)) * (width - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - (v - lo) / span) * (H - pad.top - pad.bottom);
  const line = (k: "valueCents" | "holdCents") =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[k]).toFixed(1)}`).join("");
  // A dot for every trade (but the start's), on its day or the next close after it.
  const dots = view.trades
    .filter((t) => t.source !== "start" && !t.reverted)
    .flatMap((t) => {
      const i = pts.findIndex((p) => p.date >= t.date);
      return i < 0 ? [] : [{ id: t.id, i, t }];
    });
  return (
    <div ref={box} className="w-full">
      <svg
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={`Your paper account, ${dollars(view.valueCents)}, against just holding, ${dollars(view.holdCents)}`}
        className="block"
        data-paper-graph=""
      >
        <path
          d={line("holdCents")}
          fill="none"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          className="stroke-zinc-500"
        />
        <path
          d={line("valueCents")}
          pathLength={1}
          fill="none"
          strokeWidth={2.5}
          className="nw-line stroke-zinc-950 dark:stroke-zinc-50"
        />
        {dots.map((d) => (
          <circle
            key={d.id}
            cx={x(d.i)}
            cy={y(pts[d.i].valueCents)}
            r={4}
            className="fill-white stroke-zinc-950 dark:fill-zinc-950 dark:stroke-zinc-50"
            strokeWidth={2}
            data-trade-dot={d.t.side}
          >
            <title>{`${d.t.side === "buy" ? "Bought" : "Sold"} ${dollars(d.t.amountCents)} of ${d.t.ticker} on ${d.t.date}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

export function PaperAccount({ view, strategy }: { view: PaperView | null; strategy: string }) {
  const router = useRouter();
  useEffect(() => {
    const onChange = () => router.refresh();
    window.addEventListener("paper:changed", onChange);
    return () => window.removeEventListener("paper:changed", onChange);
  }, [router]);
  return (
    <section
      id="paper"
      aria-labelledby="paper-heading"
      className={`flex flex-col gap-2 p-3 ${BOX}`}
      data-paper-account={view ? "running" : "none"}
    >
      <h2 id="paper-heading" className="text-xs font-semibold tracking-wider">
        PAPER ACCOUNT
      </h2>
      {!view ? (
        <Start strategy={strategy} />
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-3xl font-semibold tabular-nums" data-paper-value="">
              {dollars(view.valueCents)}
            </span>
            <span className="text-sm tabular-nums">
              {signed(view.valueCents - view.startingCents)} (
              {share(view.valueCents / view.startingCents - 1)})
            </span>
          </p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Runs <span className="font-semibold">{view.strategy}</span> · just holding your mix:{" "}
            {dollars(view.holdCents)}
          </p>
          <Graph view={view} />
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            <span aria-hidden="true">━ </span>your paper account <span aria-hidden="true">╌ </span>
            just holding <span aria-hidden="true">○ </span>a trade
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">
              Positions ({view.positions.length}) · cash {dollars(view.cashCents)}
            </summary>
            <ul className="mt-1 flex flex-col gap-1 text-xs tabular-nums" data-paper-positions="">
              {view.positions.map((p) => (
                <li key={p.ticker} className="flex justify-between gap-2">
                  <span className="font-semibold">{p.ticker}</span>
                  <span>
                    {dollars(p.valueCents)} ·{" "}
                    {Math.round((p.valueCents / Math.max(1, view.valueCents)) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </details>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">
              Trade log ({view.trades.length})
            </summary>
            <ul className="mt-1 flex flex-col gap-1.5 text-xs" data-paper-trades="">
              {view.trades.map((t) => (
                <li key={t.id} className={t.reverted ? "line-through opacity-60" : ""}>
                  <span className="font-semibold tabular-nums">
                    {t.date} {t.side === "buy" ? "Bought" : "Sold"} {dollars(t.amountCents)} of{" "}
                    {t.ticker}
                  </span>
                  {t.reverted && <span className="ml-1 no-underline">[REVERTED]</span>}
                  <br />
                  <span className="text-zinc-600 dark:text-zinc-400">{t.reason}</span>
                </li>
              ))}
            </ul>
          </details>
          <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
            {SOURCE_WORDS[view.priceSource] ?? view.priceSource}
            {view.pricesDate ? `, last close ${view.pricesDate}` : ""}. Simulated money: nothing
            real is bought or sold.
          </p>
        </>
      )}
      <DemoAdviceLabel />
    </section>
  );
}
