import type { RiskLevel } from "@/config/investing";
import { DEMO_PRACTICE_REPLAY_DAYS, PRACTICE_UNIVERSE } from "@/config/portfolios";
import { DEFAULT_LEVEL } from "@/config/practice-preferences";
import { SCAN_HISTORY_DAYS } from "@/config/practice-scan";
import { DEMO_PRACTICE } from "@/data-sources/demo/people-extras/practice";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { marketData, withMarketData } from "@/lib/market";
import { MemoMarketData } from "@/lib/market/memo";
import { demoPersonFor } from "@/lib/plaid/demo";
import type { PracticePreferences } from "@/planning/practice-preferences";
import { demoPracticeChangeDay } from "@/profile/sample-practice";
import { startPractice } from "./portfolio";
import { questionnaireLevel, savePreferences } from "./preferences";
import { runPracticeDay } from "./scan";

// A sample person's practice portfolio, started by Jane at their first scan (Phase AW, Stage A).
// For a Try Jane visitor the bot, its strategy and its ideas are there from the first screen,
// not behind a "start" button: the portfolio starts DEMO_PRACTICE_REPLAY_DAYS back at the level
// their investor profile gives (the middle level without one), and each trading day since is
// run through the same daily practice run as every portfolio (runPracticeDay: the monthly money,
// the scan and the autopilot, following the level's strategy), on the market data the app
// uses, asked once for the window. A sample person also gets their own practice settings
// (people-extras/practice.ts), each change saved on its day, so the ideas their settings bring
// are waiting, as the detector harness replays them (src/profile/sample-practice.ts). Demo advice
// mode only: a real person starts their own.
// Practice money only.

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
// The practice runs' time of day: after the US close, as the daily cron.
const closeOf = (day: string) => new Date(`${day}T21:30:00Z`);

// The weekdays from `from` to before `to`.
export function replayDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t < Date.parse(`${to}T00:00:00Z`); t += DAY_MS) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(iso(d));
  }
  return days;
}

export type DemoPracticeStart =
  | { started: false; why: "not_demo" | "exists" }
  | { started: true; level: number; days: number; trades: number };

// What the replay still has to do once the portfolio has started: its days, the settings
// changes still to save, and the market data for the window.
export type DemoPracticePlan = {
  level: number;
  days: string[];
  pending: { day: string; set: Partial<PracticePreferences> }[];
  feed: MemoMarketData;
};

const saveFor =
  (userId: string, client: PrismaClient) => (set: Partial<PracticePreferences>, on: Date) =>
    Object.keys(set).length > 0
      ? savePreferences(userId, set, "sample", { client, now: on })
      : Promise.resolve(null);

// The quick part, before the first scan's suggestions: the portfolio, started on the first day
// at the person's level with their settings, so nobody is asked to start one. Null when it
// isn't for them (a real account) or they have one.
export async function startDemoPractice(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<DemoPracticePlan | null> {
  if (!(await adviceMode(userId, { client }))) return null;
  const db = scopedFor(userId, client);
  if (await db.practicePortfolios.findFirst({ select: { id: true } })) return null;
  const today = iso(now);
  const days = replayDays(iso(new Date(now.getTime() - DEMO_PRACTICE_REPLAY_DAYS * DAY_MS)), today);
  if (days.length === 0) return null;
  // A sample person's own practice settings (people-extras/practice.ts): saved as they start,
  // and each change on its day.
  const person = await demoPersonFor(userId, { client });
  const sample = person ? DEMO_PRACTICE[person] : null;
  await saveFor(userId, client)(sample?.start ?? {}, closeOf(days[0]));
  const level =
    sample?.start.riskLevel ??
    (await questionnaireLevel(userId, { client, now })) ??
    sample?.level ??
    DEFAULT_LEVEL;
  const from = iso(new Date(Date.parse(days[0]) - (SCAN_HISTORY_DAYS + 7) * DAY_MS));
  const feed = new MemoMarketData(marketData(), from, days.at(-1)!);
  await withMarketData(feed, () =>
    startPractice(userId, level as RiskLevel, { client, now: closeOf(days[0]), auto: true }),
  );
  const pending = [...(sample?.changes ?? [])]
    .map((c) => ({ day: demoPracticeChangeDay(today, c.daysAgo), set: c.set }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  return { level, days, pending, feed };
}

// The slow part, beside the first scan's other work: every day since the start, through the
// same daily practice run as every portfolio, each settings change saved just before its day.
export async function replayDemoPractice(
  userId: string,
  plan: DemoPracticePlan,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<number> {
  const save = saveFor(userId, client);
  const pending = [...plan.pending];
  await plan.feed.warm([...PRACTICE_UNIVERSE]);
  let trades = 0;
  await withMarketData(plan.feed, async () => {
    for (const day of plan.days) {
      while (pending.length > 0 && pending[0].day <= day)
        await save(pending.shift()!.set, new Date(closeOf(day).getTime() - 60_000));
      const run = await runPracticeDay(userId, { client, now: closeOf(day) });
      if (run?.autopilot.ran) trades += run.autopilot.fills.length;
      if (run?.scan.scanned) trades += run.scan.flags.reduce((s, f) => s + f.trades, 0);
    }
  });
  return trades;
}

// Both, one after the other.
export async function ensureDemoPractice(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<DemoPracticeStart> {
  if (!(await adviceMode(userId, { client }))) return { started: false, why: "not_demo" };
  const plan = await startDemoPractice(userId, { client, now });
  if (!plan) return { started: false, why: "exists" };
  const trades = await replayDemoPractice(userId, plan, { client });
  return { started: true, level: plan.level, days: plan.days.length, trades };
}
