import {
  CARD_HABIT_DAYS,
  DATA_FACT_KEYS,
  PAYDAY_MIN_DEPOSITS,
  PAYDAY_SHARE,
  PAYDAY_SLACK_DAYS,
  PAYDAY_WINDOW_DAYS,
  RENT_PAYEE_MIN,
  type FactSource,
} from "@/config/memory";
import { addDays } from "@/lib/dates";
import type { Profile, ProfileInput } from "@/profile/build";
import type { FactDraft } from "./facts";

// What an upload or the nightly scan teaches Jane about the person (source "upload" for
// statements they uploaded, "detector" for a linked bank). Pure: the profile (src/profile/
// build.ts) already read the data; this picks what's steady enough to remember, with the
// profile's own confidence, and adds what memory keeps beyond it: payday, where the rent goes,
// the main bank and how the cards are used. Only what was seen: what the person told Jane is
// already remembered from where they said it.

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

// Paydays: the days of the month most paychecks land on (one or two), when they're regular.
export function paydayFrom(input: ProfileInput): { days: number[]; matches: number } | null {
  const since = addDays(input.today, -PAYDAY_WINDOW_DAYS);
  const pay = input.transactions.filter(
    (t) => t.amountCents < 0 && t.pfc === "INCOME_SALARY" && t.date > since,
  );
  if (pay.length < PAYDAY_MIN_DEPOSITS) return null;
  const days = pay.map((t) => Number(t.date.slice(8, 10)));
  const near = (a: number, b: number) => Math.abs(a - b) <= PAYDAY_SLACK_DAYS;
  // The day with the most paychecks near it (the most on the day itself breaks a tie), then the
  // next one not near that.
  const best = (pool: number[]) =>
    [...new Set(pool)]
      .map((d) => ({
        d,
        n: pool.filter((x) => near(x, d)).length,
        exact: pool.filter((x) => x === d).length,
      }))
      .sort((a, b) => b.n - a.n || b.exact - a.exact || a.d - b.d)[0];
  const first = best(days);
  const rest = days.filter((d) => !near(d, first.d));
  const second = rest.length > 0 ? best(rest) : null;
  const picked = second && second.n >= 2 ? [first, second] : [first];
  const matches = picked.reduce((s, p) => s + p.n, 0);
  if (matches / days.length < PAYDAY_SHARE) return null;
  return { days: picked.map((p) => p.d).sort((a, b) => a - b), matches };
}

// Where the rent goes: the name on most rent payments.
export function rentPayeeFrom(input: ProfileInput): { name: string; matches: number } | null {
  const counts = new Map<string, number>();
  for (const t of input.transactions) {
    if (t.amountCents <= 0 || t.pfc !== "RENT_AND_UTILITIES_RENT") continue;
    const name = t.description.replace(/\s+/g, " ").trim().slice(0, 40);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= RENT_PAYEE_MIN ? { name: top[0], matches: top[1] } : null;
}

// How the cards are used: interest charged lately means a balance is carried.
export function cardHabitFrom(input: ProfileInput): { carries: boolean; matches: number } | null {
  if (!input.accounts.some((a) => a.type === "credit")) return null;
  const since = addDays(input.today, -CARD_HABIT_DAYS);
  const interest = input.transactions.filter(
    (t) => t.date > since && t.pfc === "BANK_FEES_INTEREST_CHARGE" && t.amountCents > 0,
  ).length;
  return { carries: interest > 0, matches: interest };
}

// Confidence from how much the data shows, like the profile's own (more months, more sure).
const fromMatches = (matches: number) => Math.min(90, 55 + matches * 5);

export function factsFromData(
  profile: Profile,
  input: ProfileInput,
  {
    source,
    mainBank,
  }: { source: Extract<FactSource, "upload" | "detector">; mainBank?: string | null },
): FactDraft[] {
  const drafts: FactDraft[] = [];
  const ref = "scan";
  for (const key of DATA_FACT_KEYS) {
    const fact = profile.facts[key];
    if (!fact || fact.source !== "seen" || fact.value === null || fact.confidence <= 0) continue;
    drafts.push({
      key,
      value: fact.value,
      label:
        typeof fact.value === "boolean"
          ? fact.value
            ? fact.label
            : `${fact.label}: no`
          : `${fact.label}: ${String(fact.value).replace(/_/g, " ")}`,
      source,
      sourceRef: ref,
      confidence: fact.confidence,
    });
  }
  const payday = paydayFrom(input);
  if (payday) {
    drafts.push({
      key: "payday",
      value: payday.days.join(","),
      label: `Paid around the ${payday.days.map(ordinal).join(" and the ")}`,
      source,
      sourceRef: ref,
      confidence: fromMatches(payday.matches),
    });
  }
  const rent = rentPayeeFrom(input);
  if (rent) {
    drafts.push({
      key: "rent_payee",
      value: rent.name,
      label: `Your rent goes to ${rent.name}`,
      source,
      sourceRef: ref,
      confidence: fromMatches(rent.matches),
    });
  }
  const card = cardHabitFrom(input);
  if (card) {
    drafts.push({
      key: "card_habit",
      value: card.carries ? "carries_balance" : "pays_in_full",
      label: card.carries
        ? "You carry a balance on a card"
        : "You pay your cards off without interest",
      source,
      sourceRef: ref,
      confidence: card.carries ? fromMatches(card.matches) : 60,
    });
  }
  if (mainBank) {
    drafts.push({
      key: "main_bank",
      value: mainBank,
      label: `Your main bank is ${mainBank}`,
      source,
      sourceRef: ref,
      confidence: 75,
    });
  }
  return drafts;
}
