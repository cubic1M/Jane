"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CATEGORY_LABELS, UNCATEGORIZED } from "@/insights/labels";
import type {
  CategoryChange,
  CategoryTotal,
  MerchantTotal,
  MonthTotals,
  SpendingLine,
} from "@/insights/spending";
import { dayLabel, monthLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { axisDollars, axisTicks } from "./axis";

// Where your money goes, to explore: the month chart picks the month, and every row opens to
// the transactions behind it. Everything ships with the page, so nothing waits on a click.

const SHOWN_LINES = 10;
const MUTED = "text-zinc-600 dark:text-zinc-400";
const LINK = "font-medium underline underline-offset-2 hover:no-underline";
// Black, white and grey only (docs/design/area-pages.md): income is the dark bar.
const INCOME = "bg-zinc-900 dark:bg-zinc-100";
const SPENDING = "bg-zinc-400 dark:bg-zinc-500";

const PRIMARY_OF = Object.fromEntries(
  Object.entries(CATEGORY_LABELS).map(([primary, label]) => [label, primary]),
);

function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function categoryHref(category: string, month: string): string {
  const key = category === UNCATEGORIZED ? "none" : (PRIMARY_OF[category] ?? category);
  return `/transactions?${new URLSearchParams({ category: key, from: `${month}-01`, to: lastDay(month) })}`;
}

const percent = (share: number) =>
  share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`;

const signed = (cents: number) => `${cents < 0 ? "−" : "+"}${formatCents(Math.abs(cents))}`;

function MonthChart({
  months,
  selected,
  onSelect,
}: {
  months: MonthTotals[];
  selected: string;
  onSelect: (month: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const ticks = axisTicks(Math.max(...months.flatMap((m) => [m.spendingCents, m.incomeCents])));
  const top = Math.max(1, ticks.at(-1)!);
  const shown = months.find((m) => m.month === (hovered ?? selected)) ?? months.at(-1)!;
  const net = shown.incomeCents - shown.spendingCents;

  const onKey = (e: KeyboardEvent, i: number) => {
    const next =
      e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : -2;
    const to = e.key === "End" ? months.length - 1 : next;
    if (to < 0 || to >= months.length) return;
    e.preventDefault();
    buttons.current[to]?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <p data-month-readout="" aria-live="polite" className="flex flex-wrap gap-x-4 text-sm">
        <span className="font-semibold">{monthLabel(shown.month, { long: true })}</span>
        {/* Only what there is: a card-only person has no "In $0.00" (empty-states e2e). */}
        {shown.incomeCents === 0 && shown.spendingCents === 0 && (
          <span className={MUTED}>Nothing in or out</span>
        )}
        {shown.incomeCents > 0 && (
          <span>
            <span className={MUTED}>In </span>
            <span className="font-medium tabular-nums">{formatCents(shown.incomeCents)}</span>
          </span>
        )}
        {shown.spendingCents > 0 && (
          <span>
            <span className={MUTED}>Out </span>
            <span className="font-medium tabular-nums">{formatCents(shown.spendingCents)}</span>
          </span>
        )}
        {shown.incomeCents > 0 && shown.spendingCents > 0 && net !== 0 && (
          <span>
            <span className={MUTED}>Net </span>
            <span className="font-medium tabular-nums">{signed(net)}</span>
          </span>
        )}
      </p>
      <div className="flex gap-2">
        <div
          className="relative h-44 w-10 shrink-0 text-right text-[10px] text-zinc-500"
          aria-hidden
        >
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 translate-y-1/2 tabular-nums"
              style={{ bottom: `${(t / top) * 100}%` }}
            >
              {axisDollars(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-44" aria-hidden>
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute inset-x-0 border-t border-zinc-200 dark:border-zinc-800"
                style={{ bottom: `${(t / top) * 100}%` }}
              />
            ))}
          </div>
          <div
            role="group"
            aria-label="Income and spending by month"
            className="relative flex gap-0.5 sm:gap-1"
            onMouseLeave={() => setHovered(null)}
          >
            {months.map((m, i) => {
              const isSelected = m.month === selected;
              return (
                <button
                  key={m.month}
                  ref={(el) => {
                    buttons.current[i] = el;
                  }}
                  type="button"
                  data-month={m.month}
                  aria-pressed={isSelected}
                  // Starts with the visible "Nov", so the spoken name matches what shows.
                  aria-label={`${monthLabel(m.month)}: in ${formatCents(m.incomeCents)}, out ${formatCents(m.spendingCents)}`}
                  onClick={() => onSelect(m.month)}
                  onMouseEnter={() => setHovered(m.month)}
                  onFocus={() => setHovered(m.month)}
                  onBlur={() => setHovered(null)}
                  onKeyDown={(e) => onKey(e, i)}
                  className={`flex min-w-0 flex-1 cursor-pointer flex-col items-stretch gap-1 rounded outline-offset-2 focus-visible:outline-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100 ${isSelected ? "bg-zinc-100 dark:bg-zinc-800/70" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`}
                >
                  <span className="flex h-44 items-end gap-px px-px" aria-hidden>
                    <span
                      className={`flex-1 rounded-t ${INCOME}`}
                      style={{ height: `${(m.incomeCents / top) * 100}%` }}
                    />
                    <span
                      className={`flex-1 rounded-t ${SPENDING}`}
                      style={{ height: `${(m.spendingCents / top) * 100}%` }}
                    />
                  </span>
                  <span
                    className={`text-center text-[10px] ${isSelected ? "font-semibold text-zinc-900 dark:text-zinc-100" : "text-zinc-500"}`}
                    aria-hidden
                  >
                    {monthLabel(m.month, { year: false }).slice(0, 3)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className={`flex gap-4 text-xs ${MUTED}`} aria-hidden>
        <span>
          <span className={`mr-1 inline-block h-2 w-2 rounded-sm ${INCOME}`} />
          Income
        </span>
        <span>
          <span className={`mr-1 inline-block h-2 w-2 rounded-sm ${SPENDING}`} />
          Spending
        </span>
        <span className="ml-auto">Tap a month</span>
      </p>
    </div>
  );
}

function Lines({ lines, href, title }: { lines: SpendingLine[]; href?: string; title?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, SHOWN_LINES);
  return (
    <div className="flex flex-col gap-1">
      {title && <p className={`text-xs font-semibold ${MUTED}`}>{title}</p>}
      {lines.length === 0 ? (
        <p className={`text-sm ${MUTED}`}>Nothing that month.</p>
      ) : (
        <ul
          data-lines=""
          className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800"
        >
          {shown.map((l, i) => (
            <li
              key={i}
              className="grid grid-cols-[3.5rem_1fr_auto] items-baseline gap-2 px-3 py-1.5 [overflow-wrap:anywhere]"
            >
              <time dateTime={l.date} className={`text-xs ${MUTED}`}>
                {dayLabel(l.date)}
              </time>
              <span className="flex min-w-0 flex-col">
                <span>{l.merchant}</span>
                {l.account && <span className="text-xs text-zinc-500">{l.account}</span>}
              </span>
              <span className="tabular-nums">
                {l.cents < 0 ? `−${formatCents(-l.cents)}` : formatCents(l.cents)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="flex flex-wrap justify-between gap-2 text-sm">
        {lines.length > SHOWN_LINES ? (
          <button type="button" onClick={() => setAll(!all)} className={LINK}>
            {all ? "Show fewer" : `Show all ${lines.length}`}
          </button>
        ) : (
          <span />
        )}
        {href && (
          <Link href={href} prefetch={false} className={LINK}>
            In Transactions
          </Link>
        )}
      </p>
    </div>
  );
}

type Row = {
  key: string;
  label: string;
  cents: number;
  // Share of the month (or of the range, for merchants), 0 to 1.
  share?: number;
  value?: ReactNode;
  bar?: boolean;
  open: () => ReactNode;
};

function Rows({ rows, label }: { rows: Row[]; label: string }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.cents)));
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <ul aria-label={label} className="flex flex-col gap-1">
      {rows.map((r) => {
        const isOpen = open.has(r.key);
        return (
          <li key={r.key} className="flex flex-col gap-2">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(r.key)}
              className="-mx-2 flex flex-col gap-1 rounded px-2 py-1 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <span className="flex w-full justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-baseline gap-1.5 [overflow-wrap:anywhere]">
                  <span
                    aria-hidden
                    className={`inline-block text-zinc-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  >
                    ›
                  </span>
                  {r.label}
                </span>
                <span className="shrink-0 tabular-nums">
                  {r.value ?? <span className="font-medium">{formatCents(r.cents)}</span>}
                  {r.share !== undefined && (
                    <span className={`ml-1.5 inline-block w-9 text-right text-xs ${MUTED}`}>
                      {percent(r.share)}
                    </span>
                  )}
                </span>
              </span>
              {r.bar !== false && (
                <span className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden>
                  <span
                    className="block h-2 rounded-full bg-zinc-700 dark:bg-zinc-300"
                    style={{ width: `${(Math.abs(r.cents) / max) * 100}%` }}
                  />
                </span>
              )}
            </button>
            {isOpen && <div className="mb-2 pl-4">{r.open()}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export function SpendingExplorer({
  months,
  categoriesByMonth,
  initialMonth,
  changes,
  topMerchants,
  lines,
  incomeNote,
}: {
  months: MonthTotals[];
  categoriesByMonth: Record<string, CategoryTotal[]>;
  initialMonth: string;
  changes: CategoryChange[];
  topMerchants: MerchantTotal[];
  lines: SpendingLine[];
  // Said under the chart: cash deposits counted as income, and how sure (./cash-income.tsx).
  incomeNote?: ReactNode;
}) {
  const [month, setMonth] = useState(initialMonth);
  // The lines grouped once, so opening a row only looks one up.
  const groups = useMemo(() => {
    const byKey = new Map<string, SpendingLine[]>();
    const add = (key: string, l: SpendingLine) => {
      const list = byKey.get(key);
      if (list) list.push(l);
      else byKey.set(key, [l]);
    };
    for (const l of lines) {
      add(`c|${l.date.slice(0, 7)}|${l.category}`, l);
      add(`m|${l.merchant}`, l);
    }
    return byKey;
  }, [lines]);
  const forCategory = (m: string, category: string) => groups.get(`c|${m}|${category}`) ?? [];

  const first = months[0].month;
  const last = months.at(-1)!.month;
  const [before, after] = months.length >= 2 ? months.slice(-2).map((m) => m.month) : [];
  const categories = categoriesByMonth[month] ?? [];
  const monthTotal = months.find((m) => m.month === month)?.spendingCents ?? 0;
  const rangeTotal = months.reduce((s, m) => s + m.spendingCents, 0);

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Income and spending by month</h2>
        <MonthChart months={months} selected={month} onSelect={setMonth} />
        {incomeNote}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold" data-breakdown-month={month}>
          {monthLabel(month, { long: true })} by category
        </h2>
        {categories.length === 0 ? (
          <p className={MUTED}>No spending that month.</p>
        ) : (
          <Rows
            key={month}
            label="Categories"
            rows={categories.map((c) => ({
              key: c.category,
              label: c.category,
              cents: c.cents,
              share: monthTotal > 0 ? c.cents / monthTotal : undefined,
              open: () => (
                <Lines
                  lines={forCategory(month, c.category)}
                  href={categoryHref(c.category, month)}
                />
              ),
            }))}
          />
        )}
      </section>

      {changes.length > 0 && before && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Biggest changes from last month</h2>
          <Rows
            label="Changes"
            rows={changes.map((c) => ({
              key: c.category,
              label: c.category,
              cents: c.changeCents,
              bar: false,
              value: (
                <span className="font-medium">
                  <span aria-hidden className="text-[0.7em]">
                    {c.changeCents > 0 ? "▲" : "▼"}
                  </span>{" "}
                  {c.changeCents > 0 ? "up" : "down"} {formatCents(Math.abs(c.changeCents))}
                </span>
              ),
              open: () => (
                <div className="flex flex-col gap-3">
                  <Lines
                    title={`${monthLabel(after, { year: false })} · ${formatCents(c.afterCents)}`}
                    lines={forCategory(after, c.category)}
                    href={categoryHref(c.category, after)}
                  />
                  <Lines
                    title={`${monthLabel(before, { year: false })} · ${formatCents(c.beforeCents)}`}
                    lines={forCategory(before, c.category)}
                    href={categoryHref(c.category, before)}
                  />
                </div>
              ),
            }))}
          />
        </section>
      )}

      {topMerchants.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Where you spend the most</h2>
          <Rows
            label="Merchants"
            rows={topMerchants.map((m) => ({
              key: m.merchant,
              label: m.merchant,
              cents: m.cents,
              share: rangeTotal > 0 ? m.cents / rangeTotal : undefined,
              open: () => (
                <Lines
                  lines={groups.get(`m|${m.merchant}`) ?? []}
                  href={`/transactions?${new URLSearchParams({ q: m.merchant, from: `${first}-01`, to: lastDay(last) })}`}
                />
              ),
            }))}
          />
        </section>
      )}
    </>
  );
}
