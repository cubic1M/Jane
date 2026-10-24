"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { pickCompared, type PickResult } from "@/lib/compare-actions";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { MOTION } from "@/config/motion";
import {
  PREFERENCES,
  WHAT_A_PICK_DOES,
  rank,
  type ComparedOption,
  type Comparison,
  type Preference,
} from "@/lib/comparison";

// Comparison cards (founder, 2026-10-24; pure model in src/lib/comparison.ts). Two to four
// options side by side on a wide screen; on a phone a stack to swipe through, with a Compare
// toggle that lines them up as a table. "Sort by" at the top re-ranks them here, with no trip
// to the server, and the cards glide to their new places (FLIP, at the motion spec's base
// duration and standard easing, src/config/motion.ts; still under reduced motion). One tap
// chooses: the card turns inverted at once and the pick is queued behind it. Black,
// white and grey only (docs/design/area-pages.md): tags and glyphs, never colour, say what's
// what. Rows the options differ on are bold; rows that are the same on every option are dimmed.

const reducedMotion = () =>
  typeof window === "undefined" ||
  typeof window.matchMedia !== "function" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const GRID: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

const BUTTON =
  "inline-flex min-h-11 items-center justify-center border px-3 text-sm font-semibold uppercase tracking-wide disabled:cursor-not-allowed";

export type PickHandler = (optionId: string) => Promise<PickResult>;

export function ComparisonCards({
  comparison,
  onPick,
  onLater,
}: {
  comparison: Comparison;
  // Defaults to the area pages' server action; the chat sends its own (option.pick).
  onPick?: PickHandler;
  onLater?: () => void;
}) {
  const [preference, setPreference] = useState<Preference>(comparison.initial);
  const [chosen, setChosen] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [table, setTable] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const before = useRef<Map<string, DOMRect> | null>(null);
  const ordered = rank(comparison.options, preference);
  const name = `sort-${comparison.topic}`;

  // FLIP: each card starts where it was and glides to its new place.
  useLayoutEffect(() => {
    const first = before.current;
    before.current = null;
    if (!first || reducedMotion()) return;
    for (const [id, el] of cards.current) {
      const was = first.get(id);
      if (!was || typeof el.animate !== "function") continue;
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (dx === 0 && dy === 0) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
        duration: MOTION.baseMs,
        easing: MOTION.standard,
      });
    }
  }, [preference]);

  function sortBy(p: Preference) {
    if (p === preference) return;
    before.current = new Map(
      [...cards.current].map(([id, el]) => [id, el.getBoundingClientRect()] as const),
    );
    setPreference(p);
  }

  function choose(option: ComparedOption) {
    if (chosen) return;
    setChosen(option.id);
    setStatus({ ok: true, text: `Chosen: ${option.name}. Queued for Jane's team.` });
    const pick: PickHandler =
      onPick ??
      ((id) =>
        pickCompared(
          { kind: comparison.kind, topic: comparison.topic, policyId: comparison.policyId },
          id,
        ));
    // Not in a transition: the answer shows as soon as it's back, whatever the page does.
    void pick(option.id)
      .catch((): PickResult => ({ ok: false, error: "That didn't go through. Try again." }))
      .then((result) => {
        if (result.ok) setStatus({ ok: true, text: `Chosen: ${option.name}. ${result.note}` });
        else {
          setChosen(null);
          setStatus({ ok: false, text: result.error });
        }
      });
  }

  return (
    <section
      aria-label={comparison.title}
      data-testid="comparison"
      data-topic={comparison.topic}
      data-policy={comparison.policyId ?? ""}
      className="flex flex-col gap-3 font-mono text-sm [overflow-wrap:anywhere]"
    >
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">{comparison.title}</h3>
        {comparison.preferences.length > 1 && (
          <fieldset className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <legend className="float-left mr-1 text-xs uppercase text-zinc-600 dark:text-zinc-400">
              Sort by
            </legend>
            {comparison.preferences.map((p) => (
              <label
                key={p}
                className="inline-flex min-h-11 cursor-pointer items-center border border-zinc-400 px-2 text-xs has-[:checked]:border-zinc-950 has-[:checked]:bg-zinc-950 has-[:checked]:text-white has-[:focus-visible]:outline-2 dark:border-zinc-600 dark:has-[:checked]:border-white dark:has-[:checked]:bg-white dark:has-[:checked]:text-zinc-950"
              >
                <input
                  type="radio"
                  name={name}
                  value={p}
                  checked={preference === p}
                  onChange={() => sortBy(p)}
                  className="sr-only"
                />
                {preference === p ? "● " : "○ "}
                {PREFERENCES[p]}
              </label>
            ))}
          </fieldset>
        )}
        <button
          type="button"
          aria-pressed={table}
          onClick={() => setTable((t) => !t)}
          className={`${BUTTON} self-start border-zinc-400 sm:hidden dark:border-zinc-600`}
        >
          {table ? "▤ Cards" : "▥ Compare"}
        </button>
      </div>

      {table && (
        <CompareTable comparison={comparison} ordered={ordered} chosen={chosen} onChoose={choose} />
      )}

      <ol
        aria-label={`${comparison.title}, by ${PREFERENCES[preference].toLowerCase()}`}
        className={`${table ? "hidden sm:grid" : "flex"} -mx-1 snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 sm:grid sm:overflow-visible ${GRID[ordered.length] ?? GRID[4]}`}
      >
        {ordered.map((o, i) => {
          const isChosen = chosen === o.id;
          return (
            <li
              key={o.id}
              ref={(el) => {
                if (el) cards.current.set(o.id, el);
                else cards.current.delete(o.id);
              }}
              data-option-id={o.id}
              data-chosen={isChosen ? "" : undefined}
              aria-label={`${i + 1}. ${o.name}`}
              className={`flex w-[85%] shrink-0 snap-center flex-col gap-2 border p-3 sm:w-auto ${
                isChosen
                  ? "border-zinc-950 bg-zinc-950 text-white dark:border-white dark:bg-white dark:text-zinc-950"
                  : "border-zinc-400 bg-white dark:border-zinc-600 dark:bg-zinc-950"
              }`}
            >
              <p className="flex min-h-5 flex-wrap gap-1 text-[11px] font-semibold">
                {o.isPick && <span className="border border-current px-1">JANE&apos;S PICK</span>}
                {o.tags.map((t) => (
                  <span key={t} data-tag={t} className="border border-current px-1">
                    {t}
                  </span>
                ))}
              </p>
              <h4 className="font-semibold">{o.name}</h4>
              <p>
                <span className="text-2xl font-bold tabular-nums">{o.monthly}</span>
                <span className="opacity-70">/mo</span>
              </p>
              <dl className="flex flex-col gap-1">
                {comparison.rows.map((r, at) => (
                  <div
                    key={r.key}
                    data-row={r.key}
                    data-differs={r.differs ? "" : undefined}
                    className={`flex justify-between gap-2 border-t border-dashed border-current pt-1 ${r.differs ? "font-semibold" : "opacity-50"}`}
                  >
                    <dt>
                      <span aria-hidden="true">{r.differs ? "▸ " : "· "}</span>
                      {r.label}
                    </dt>
                    <dd className="text-right tabular-nums">
                      {o.rows[at].value}
                      {!r.differs && <span className="sr-only"> (same on every option)</span>}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs">» {o.bestFor}</p>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => choose(o)}
                  disabled={chosen !== null}
                  aria-label={isChosen ? `Chosen: ${o.name}` : `Choose ${o.name}`}
                  className={`${BUTTON} ${
                    isChosen
                      ? "border-white dark:border-zinc-950"
                      : "border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-700 disabled:opacity-40 dark:border-white dark:bg-white dark:text-zinc-950"
                  }`}
                >
                  {isChosen ? "✓ Chosen" : "Choose"}
                </button>
                <button
                  type="button"
                  aria-expanded={open === o.id}
                  aria-controls={`why-${comparison.topic}-${o.id}`}
                  onClick={() => setOpen((x) => (x === o.id ? null : o.id))}
                  className="inline-flex min-h-11 items-center text-xs underline underline-offset-2"
                >
                  More details {open === o.id ? "▴" : "▾"}
                </button>
              </div>
              <div
                id={`why-${comparison.topic}-${o.id}`}
                hidden={open !== o.id}
                className="flex flex-col gap-1 border-t border-current pt-2 text-xs"
              >
                <p>{o.why}</p>
                {o.confidence && (
                  <p>
                    <span className="font-semibold">{o.confidence.percent}% sure:</span>{" "}
                    {o.confidence.reason}.
                  </p>
                )}
                <ul className="flex flex-col gap-0.5 opacity-80">
                  {o.details.map((d) => (
                    <li key={d}>- {d}</li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>

      <p
        role={status && !status.ok ? "alert" : "status"}
        className={status ? "border border-current p-2" : "sr-only"}
      >
        {status ? `${status.ok ? "✓" : "✗"} ${status.text}` : ""}
      </p>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        {WHAT_A_PICK_DOES[comparison.kind]}
      </p>
      {comparison.advice && <DemoAdviceLabel />}
      {onLater && !chosen && (
        <button
          type="button"
          onClick={onLater}
          className={`${BUTTON} self-start border-zinc-400 dark:border-zinc-600`}
        >
          Later
        </button>
      )}
    </section>
  );
}

// The phone's Compare view: the options as columns, their rows lined up.
function CompareTable({
  comparison,
  ordered,
  chosen,
  onChoose,
}: {
  comparison: Comparison;
  ordered: ComparedOption[];
  chosen: string | null;
  onChoose: (option: ComparedOption) => void;
}) {
  return (
    <div className="overflow-x-auto sm:hidden">
      <table
        className="w-full border-collapse text-xs [overflow-wrap:normal]"
        data-testid="compare-table"
      >
        <caption className="sr-only">{comparison.title}, side by side</caption>
        <thead>
          <tr>
            <th scope="col" className="sr-only">
              Row
            </th>
            {ordered.map((o) => (
              <th
                key={o.id}
                scope="col"
                className={`border border-zinc-400 p-1 text-left align-top dark:border-zinc-600 ${chosen === o.id ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950" : ""}`}
              >
                {o.name}
                {o.tags.length > 0 && (
                  <span className="block text-[10px] font-semibold">[{o.tags.join("] [")}]</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th
              scope="row"
              className="border border-zinc-400 p-1 text-left whitespace-nowrap dark:border-zinc-600"
            >
              A month
            </th>
            {ordered.map((o) => (
              <td
                key={o.id}
                className="border border-zinc-400 p-1 font-bold tabular-nums dark:border-zinc-600"
              >
                {o.monthly}
              </td>
            ))}
          </tr>
          {comparison.rows.map((r, at) => (
            <tr key={r.key} className={r.differs ? "font-semibold" : "opacity-50"}>
              <th
                scope="row"
                className="border border-zinc-400 p-1 text-left font-normal whitespace-nowrap dark:border-zinc-600"
              >
                {r.differs ? "▸ " : "· "}
                {r.label}
              </th>
              {ordered.map((o) => (
                <td
                  key={o.id}
                  className="border border-zinc-400 p-1 tabular-nums dark:border-zinc-600"
                >
                  {o.rows[at].value}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row" className="sr-only">
              Choose
            </th>
            {ordered.map((o) => (
              <td key={o.id} className="border border-zinc-400 p-1 dark:border-zinc-600">
                <button
                  type="button"
                  onClick={() => onChoose(o)}
                  disabled={chosen !== null}
                  aria-label={chosen === o.id ? `Chosen: ${o.name}` : `Choose ${o.name}`}
                  className="inline-flex min-h-11 w-full items-center justify-center border border-zinc-950 text-[11px] font-semibold uppercase disabled:opacity-40 dark:border-white"
                >
                  {chosen === o.id ? "✓" : "Choose"}
                </button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
