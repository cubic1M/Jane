import type { PersonId } from "@/config/people";
import { DEMO_PRACTICE_REPLAY_DAYS, PRACTICE_STOCKS, PRACTICE_UNIVERSE } from "@/config/portfolios";
import { MAX_DROP_FROM_REACTION } from "@/config/practice-opportunities";
import { SCAN_HISTORY_DAYS } from "@/config/practice-scan";
import { STRATEGY_TRADE_COST_BPS } from "@/config/strategies";
import { DEMO_PRACTICE } from "@/data-sources/demo/people-extras/practice";
import { DEMO_VALUES_EXCLUDES } from "@/data-sources/demo/people-extras/investing";
import { paySchedules } from "@/detection/paydays";
import { sampleBars, sampleNews } from "@/lib/market/sample";
import { mainPaydayDay } from "@/planning/practice-opportunities";
import { ideasFrom } from "@/planning/practice-ideas-from";
import { DEFAULT_PREFERENCES, type PracticePreferences } from "@/planning/practice-preferences";
import { replayRules } from "@/planning/rule-replay";
import type { PracticeIdea, ProfileInput } from "./build";

// A sample person's practice ideas for the detector harness (Phase AW, Stage A): their practice
// portfolio as the first scan starts it (src/lib/practice/demo-start.ts), DEMO_PRACTICE_REPLAY_DAYS
// back with their practice settings (people-extras/practice.ts) and each change on its day,
// replayed on the sample market through the live scan's own rules (replayRules with "live"), and
// the ideas left waiting as the practice page reads them. Pure.

const DAY_MS = 86_400_000;
const daysBefore = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

// The day each change takes effect, `daysAgo` before `today`.
export function demoPracticeChangeDay(today: string, daysAgo: number): string {
  return daysBefore(today, daysAgo);
}

export function samplePracticeIdeas(person: PersonId, data: ProfileInput): PracticeIdea[] {
  const c = DEMO_PRACTICE[person];
  const today = data.today;
  const start = daysBefore(today, DEMO_PRACTICE_REPLAY_DAYS);
  const last = daysBefore(today, 1);
  const from = daysBefore(start, SCAN_HISTORY_DAYS + 7);
  const bars = Object.fromEntries(
    [...PRACTICE_UNIVERSE].map((t) => [t, sampleBars(t, from, last)]),
  );
  // As loadPreferences starts a person: their values list is what they never buy.
  const base: PracticePreferences = {
    ...DEFAULT_PREFERENCES,
    avoid: [...(DEMO_VALUES_EXCLUDES[person] ?? [])],
    ...c.start,
  };
  let current = base;
  const changes = [...c.changes]
    .sort((a, b) => b.daysAgo - a.daysAgo)
    .map((ch) => {
      current = { ...current, ...ch.set };
      return { from: demoPracticeChangeDay(today, ch.daysAgo), preferences: current };
    });
  const replay = replayRules({
    level: c.level,
    bars,
    from: start,
    headlines: sampleNews(PRACTICE_STOCKS, from, last),
    startCents: c.startCents,
    monthlyAddCents: base.monthlyAddCents,
    addDay: base.addDay,
    strategy: "rules",
    rules: "live",
    preferences: base,
    changes,
    // As the live scan finds it: the main payday from their pay.
    paydayDay: mainPaydayDay(
      paySchedules({
        asOf: today,
        accounts: data.accounts.map((a) => ({
          id: a.id,
          name: a.name ?? "",
          type: a.type,
          subtype: a.subtype,
          currentBalanceCents: a.balanceCents,
        })),
        // Pay is found from the category, the description and the merchant.
        transactions: data.transactions.map((t, i) => ({
          id: `sample-${i}`,
          accountId: t.accountId,
          plaidTransactionId: null,
          date: t.date,
          amountCents: t.amountCents,
          description: t.description,
          merchantName: null,
          pfcPrimary: null,
          pfcDetailed: t.pfc,
          categorySource: "plaid",
        })),
        recurringStreams: [],
      }),
    ),
    fallbackDropShare: MAX_DROP_FROM_REACTION[c.dropReaction] ?? null,
    tradeCostBps: STRATEGY_TRADE_COST_BPS,
  });
  return replay ? ideasFrom(replay.suggestions, today) : [];
}
