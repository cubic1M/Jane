"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setEventsAction } from "@/app/investments/events-actions";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import type { EventsView } from "@/lib/events/view";

// The Events box on the investments page (founder, 2026-10-26), its own box apart from the
// suggestion dock, in the page's monochrome ASCII style: what's happening now, what the overlay
// would do (off) or did (on), how sure it is, its track record and an on/off switch. The overlay
// sits on top of the paper account's strategy, never in place of it, and trades simulated money
// only. Updates about its trades come up in the trade pop-up.

const BOX = "border border-zinc-400 bg-white dark:border-zinc-600 dark:bg-zinc-950";
const BUTTON =
  "inline-flex min-h-10 items-center justify-center border-2 border-zinc-950 px-3 text-xs font-semibold tracking-wide uppercase disabled:opacity-60 dark:border-zinc-50";
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const KIND_WORDS: Record<string, string> = {
  enter: "[+] IN",
  exit: "[-] OUT",
  stop: "[!] STOP",
  skip: "[ ] SKIP",
};

export function EventsBox({ view }: { view: EventsView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const flip = () =>
    start(async () => {
      setNote(null);
      const r = await setEventsAction(!view.on);
      if (!r.ok) return setNote(r.error);
      setNote(
        r.on
          ? r.trades > 0
            ? `On. It placed ${r.trades} paper trade${r.trades === 1 ? "" : "s"} for the events now.`
            : "On. It acts at each close from now on."
          : "Off. Open slices stay until their exit; no new ones.",
      );
      window.dispatchEvent(new Event("paper:signals"));
      router.refresh();
    });

  return (
    <section
      id="events"
      aria-labelledby="events-heading"
      className={`flex flex-col gap-3 p-3 ${BOX}`}
      data-events-box={view.on ? "on" : "off"}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="events-heading" className="text-xs font-semibold tracking-wider">
          EVENTS
        </h2>
        <button
          type="button"
          role="switch"
          aria-checked={view.on}
          aria-label="Events overlay"
          className={`${BUTTON} ${view.on ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950" : ""}`}
          disabled={pending || !view.hasAccount}
          onClick={flip}
        >
          {pending ? "…" : view.on ? "[■] ON" : "[ ] OFF"}
        </button>
      </div>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        On top of your paper account&apos;s strategy: when the news moves a theme, Jane tilts a
        small slice for a few weeks, then undoes it. Simulated money only.
        {!view.hasAccount && " Start a paper account first."}
      </p>
      {note && (
        <p role="status" className="text-xs font-semibold" data-events-note="">
          {note}
        </p>
      )}

      <div>
        <h3 className="text-[11px] font-semibold tracking-wider text-zinc-500">HAPPENING NOW</h3>
        {view.now.length === 0 ? (
          <p className="text-sm" data-events-now="none">
            No events in the last few days.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm" data-events-now="">
            {view.now.map((e) => (
              <li
                key={e.key}
                className="border-t border-zinc-200 pt-2 first:border-0 first:pt-0 dark:border-zinc-800"
              >
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {e.acting ? "▲" : "·"} {e.label}
                  </span>
                  <span className="text-xs tabular-nums" data-events-confidence="">
                    {e.confidence}% sure
                  </span>
                </p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  {e.date} · {e.source.toUpperCase()} · {e.title}
                </p>
                <p className="text-xs" data-events-plan="">
                  → {e.plan}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {view.open.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold tracking-wider text-zinc-500">OPEN SLICES</h3>
          <ul className="flex flex-col gap-1 text-xs tabular-nums" data-events-open="">
            {view.open.map((s) => (
              <li key={`${s.ticker}-${s.enteredOn}`}>
                {s.side === "buy" ? "+" : "−"}
                {pct(s.tilt)} {s.ticker} since {s.enteredOn}
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.recent.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">Log ({view.recent.length})</summary>
          <ul className="mt-1 flex flex-col gap-1.5 text-xs" data-events-log="">
            {view.recent.map((l) => (
              <li key={l.id}>
                <span className="font-semibold tabular-nums">
                  {l.date} {KIND_WORDS[l.kind] ?? l.kind} {l.ticker ?? ""}
                </span>
                <br />
                <span className="text-zinc-600 dark:text-zinc-400">{l.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">Track record</summary>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full text-xs tabular-nums" data-events-record="">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="font-normal">Event</th>
                <th className="text-right font-normal">Times</th>
                <th className="text-right font-normal">Helped</th>
                <th className="text-right font-normal">Sure</th>
              </tr>
            </thead>
            <tbody>
              {view.record.map((r) => (
                <tr key={r.type}>
                  <td>{r.label}</td>
                  <td className="text-right">{r.events}</td>
                  <td className="text-right">{r.hits}</td>
                  <td className="text-right">{r.confidence}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {view.backtest.from && (
          <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
            Replay of {view.backtest.from} to {view.backtest.to} on real closes (level{" "}
            {view.backtest.level}): {pct(view.backtest.alone.yearly)} a year alone,{" "}
            {pct(view.backtest.withEvents.yearly)} with events; worst drop{" "}
            {pct(view.backtest.alone.maxDrawdown)} vs {pct(view.backtest.withEvents.maxDrawdown)}. A
            replay of the past, not a forecast.
          </p>
        )}
      </details>
      <DemoAdviceLabel />
    </section>
  );
}
