"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  paperRevertAction,
  paperSkipAction,
  paperTakeAction,
} from "@/app/investments/paper-actions";
import { eventRevertAction, eventSeenAction } from "@/app/investments/events-actions";
import { sideChatStore } from "@/components/side-chat/store";
import type { EventUpdate } from "@/lib/events/updates";
import { panelShowsOn } from "@/lib/side-chat";
import type { SignalForPopup } from "@/lib/paper/signals";
import { formatCents } from "@/lib/money";
import type { TakeResult } from "@/lib/paper/account";

// The trade pop-up (founder: "jane should be recommending trades when opportunities arise, and not
// blend it in the suggestion boxes, but a separate pop up"): the paper account's waiting trades,
// one at a time, in its own box at the bottom left of the page (above the bottom bar on a phone),
// never in the suggestion dock above the chat. Ticker, buy or sell, size, one line why, how sure,
// and Paper trade it (instant, with Revert), Skip and More details. The events overlay's trades,
// placed by itself on the paper account, come first as updates: what it did and why, with OK and
// Revert. Simulated only.

const useSignedIn = () =>
  useSyncExternalStore(
    sideChatStore.subscribe,
    () => sideChatStore.get().userId,
    () => null,
  );

const POLL_MS = 60_000;
const BUTTON =
  "inline-flex min-h-10 items-center justify-center border px-3 text-xs font-semibold tracking-wide uppercase";
const dollars = (cents: number) => formatCents(cents).replace(/\.00$/, "");

type Done = { signal: SignalForPopup; sent: Promise<TakeResult> };

export function TradePopup() {
  const userId = useSignedIn();
  const pathname = usePathname();
  const shows = !!userId && panelShowsOn(pathname);
  const [signals, setSignals] = useState<SignalForPopup[]>([]);
  const [updates, setUpdates] = useState<EventUpdate[]>([]);
  // Taken just now: shown as done, with Revert, until the person moves on.
  const [done, setDone] = useState<Done | null>(null);
  const [more, setMore] = useState(false);
  const [folded, setFolded] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const gone = useRef(new Set<string>());

  const load = useCallback(() => {
    fetch("/api/paper/signals", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { signals: [], updates: [] }))
      .then((d: { signals: SignalForPopup[]; updates?: EventUpdate[] }) => {
        setSignals(d.signals.filter((s) => !gone.current.has(s.id)));
        setUpdates((d.updates ?? []).filter((u) => !gone.current.has(u.id)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!shows) return;
    load();
    const timer = window.setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("paper:signals", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("paper:signals", onFocus);
    };
  }, [shows, pathname, load]);

  if (!shows) return null;
  const update = done ? null : updates[0];
  if (update)
    return (
      <EventUpdateCard
        update={update}
        waiting={updates.length - 1 + signals.length}
        onDone={(note) => {
          gone.current.add(update.id);
          setUpdates((all) => all.filter((u) => u.id !== update.id));
          setNote(note);
        }}
      />
    );
  const signal = done?.signal ?? signals[0];
  if (!signal) return null;
  const waiting = signals.length - (done ? 0 : 1);

  const leave = (id: string) => {
    gone.current.add(id);
    setSignals((all) => all.filter((s) => s.id !== id));
    setMore(false);
    setNote(null);
  };

  const take = () => {
    const sent = paperTakeAction(signal.id).catch((): TakeResult => ({
      ok: false,
      error: "That didn't go through. Try again.",
    }));
    setDone({ signal, sent });
    leave(signal.id);
    void sent.then((r) => {
      if (r.ok) window.dispatchEvent(new Event("paper:changed"));
      else {
        gone.current.delete(signal.id);
        setDone(null);
        setSignals((all) => [signal, ...all]);
        setNote(r.error);
      }
    });
  };

  const revert = () => {
    if (!done) return;
    const was = done;
    setDone(null);
    gone.current.delete(was.signal.id);
    setSignals((all) => [was.signal, ...all]);
    setNote("Reverted.");
    void was.sent
      .then((r) => (r.ok ? paperRevertAction(r.tradeId) : { ok: true as const }))
      .then((r) => {
        if (r.ok) window.dispatchEvent(new Event("paper:changed"));
        else setNote(r.error);
      })
      .catch(() => setNote("That didn't go through. Try again."));
  };

  const skip = () => {
    leave(signal.id);
    void paperSkipAction(signal.id);
  };

  const sideWord = signal.side === "sell" ? "SELL" : "BUY";
  return (
    <aside
      aria-label="Trade alert"
      data-trade-popup=""
      className="nw-box-in fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] left-3 z-[65] flex max-h-[60vh] flex-col overflow-y-auto border-2 border-zinc-950 bg-white text-sm text-zinc-950 shadow-2xl sm:right-auto sm:bottom-4 sm:left-4 sm:w-[22rem] dark:border-zinc-50 dark:bg-zinc-950 dark:text-zinc-50"
    >
      <div className="invert-scope flex items-center justify-between gap-2 bg-zinc-950 px-3 py-1.5 text-[11px] font-semibold tracking-wider text-white dark:bg-zinc-50 dark:text-zinc-950">
        <span>
          [TRADE] {signal.source === "news" ? "NEWS IDEA" : "STRATEGY RULE"}
          {waiting > 0 && ` · +${waiting} waiting`}
        </span>
        <button
          type="button"
          onClick={() => setFolded((f) => !f)}
          aria-expanded={!folded}
          aria-label={folded ? "Open the trade alert" : "Fold the trade alert"}
          className="min-h-8 px-1"
        >
          [{folded ? "+" : "−"}]
        </button>
      </div>
      {!folded && (
        <div className="flex flex-col gap-2 p-3">
          {done ? (
            <p className="font-semibold" role="status" data-trade-done="">
              [✓ PAPER TRADED] {done.signal.card.headline}
            </p>
          ) : (
            <>
              <p className="flex items-baseline justify-between gap-2">
                <span className="text-base font-semibold" data-trade-headline="">
                  {signal.card.headline}
                </span>
                <span className="shrink-0 text-[11px] font-semibold tracking-wide">
                  {sideWord} {signal.ticker}
                </span>
              </p>
              <p className="text-zinc-700 dark:text-zinc-300">{signal.card.reason}</p>
              {signal.card.confidence !== null && (
                <p className="text-xs font-semibold tabular-nums">{signal.card.confidence}% sure</p>
              )}
            </>
          )}
          {note && (
            <p className="text-xs font-semibold" role="status">
              {note}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {done ? (
              <>
                <button type="button" onClick={revert} className={`${BUTTON} border-zinc-500`}>
                  Revert
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDone(null);
                    setNote(null);
                  }}
                  className={`${BUTTON} border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950`}
                >
                  OK
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={take}
                  className={`${BUTTON} border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950`}
                >
                  Paper trade it
                </button>
                <button type="button" onClick={skip} className={`${BUTTON} border-zinc-500`}>
                  Skip
                </button>
                <button
                  type="button"
                  aria-expanded={more}
                  onClick={() => setMore((m) => !m)}
                  className={`${BUTTON} border-dashed border-zinc-500`}
                >
                  More details
                </button>
              </>
            )}
          </div>
          {more && !done && (
            <div
              className="flex flex-col gap-1 text-xs text-zinc-700 dark:text-zinc-300"
              data-trade-more=""
            >
              <p>
                {sideWord} {dollars(signal.amountCents)} of {signal.ticker} at the last close,{" "}
                {dollars(signal.priceCents)} a share, on{" "}
                {new Date(signal.createdAt).toLocaleDateString("en-US")}.
              </p>
              <p>
                {signal.source === "news"
                  ? "From a news idea Jane found."
                  : "Your chosen strategy's own rule, at its month-end decision."}{" "}
                Simulated money only: nothing real is bought or sold.
              </p>
              <Link href="/investments" className="font-semibold underline underline-offset-2">
                See your paper account
              </Link>
            </div>
          )}
          <p className="text-[11px] font-semibold" data-demo-advice="">
            {signal.card.label}
          </p>
        </div>
      )}
    </aside>
  );
}

// One of the events overlay's own trades, shown once: what it did and why, how sure, OK and Revert.
function EventUpdateCard({
  update,
  waiting,
  onDone,
}: {
  update: EventUpdate;
  waiting: number;
  onDone: (note: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const ok = () => {
    onDone(null);
    void eventSeenAction(update.id);
  };
  const revert = () => {
    setBusy(true);
    void eventRevertAction(update.id)
      .then((r) => {
        if (!r.ok) return setError(r.error);
        window.dispatchEvent(new Event("paper:changed"));
        onDone("Reverted.");
      })
      .catch(() => setError("That didn't go through. Try again."))
      .finally(() => setBusy(false));
  };
  return (
    <aside
      aria-label="Trade alert"
      data-trade-popup=""
      data-event-update={update.kind}
      className="nw-box-in fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] left-3 z-[65] flex max-h-[60vh] flex-col overflow-y-auto border-2 border-zinc-950 bg-white text-sm text-zinc-950 shadow-2xl sm:right-auto sm:bottom-4 sm:left-4 sm:w-[22rem] dark:border-zinc-50 dark:bg-zinc-950 dark:text-zinc-50"
    >
      <div className="invert-scope flex items-center justify-between gap-2 bg-zinc-950 px-3 py-1.5 text-[11px] font-semibold tracking-wider text-white dark:bg-zinc-50 dark:text-zinc-950">
        <span>
          [TRADE] EVENTS · DONE FOR YOU
          {waiting > 0 && ` · +${waiting} waiting`}
        </span>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <p className="text-base font-semibold" data-trade-headline="">
          [✓] {update.headline}
        </p>
        <p className="text-zinc-700 dark:text-zinc-300">{update.reason}</p>
        <p className="text-xs font-semibold tabular-nums">{update.confidence}% sure</p>
        {error && (
          <p className="text-xs font-semibold" role="status">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={ok}
            className={`${BUTTON} border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950`}
          >
            OK
          </button>
          <button
            type="button"
            onClick={revert}
            disabled={busy}
            className={`${BUTTON} border-zinc-500`}
          >
            {busy ? "Reverting…" : "Revert"}
          </button>
          <button
            type="button"
            aria-expanded={more}
            onClick={() => setMore((m) => !m)}
            className={`${BUTTON} border-dashed border-zinc-500`}
          >
            More details
          </button>
        </div>
        {more && (
          <div
            className="flex flex-col gap-1 text-xs text-zinc-700 dark:text-zinc-300"
            data-trade-more=""
          >
            <p>
              The events overlay placed {update.trades} paper trade{update.trades === 1 ? "" : "s"}{" "}
              on your paper account, on top of its strategy. Simulated money only: nothing real is
              bought or sold.
            </p>
            <Link href="/investments" className="font-semibold underline underline-offset-2">
              See the Events box
            </Link>
          </div>
        )}
        <p className="text-[11px] font-semibold" data-demo-advice="">
          {update.label}
        </p>
      </div>
    </aside>
  );
}
