import type { PrismaClient } from "@/generated/prisma/client";
import { detect } from "@/detection/detect";
import { loadDetectionInput } from "@/detection/input";
import { withAreaStatus } from "@/lib/hub/area-status";
import { loadAreaTrees } from "@/lib/hub/area-trees";
import { loadHubAreas, loadHubTop } from "@/lib/hub/load";
import { netWorthHistory } from "@/lib/hub/net-worth-history";
import { cashFlowView, heroView, tilesView } from "@/lib/hub/view";
import { answerByRules } from "@/lib/jane-agent/answer";
import { parseIntent } from "@/lib/jane-agent/intents";
import { detectFor } from "@/lib/suggestions";
import { chatToday } from "@/lib/today";
import { flatten, type Flat } from "./diff";

// What one person sees at one moment, for the calendar sweep (gate C, mvp-ready.md): the findings
// detection would make, the suggestions and the profile behind them, Home's top and tiles as the
// page shows them, the area trees, the net worth chart and the chat's answers from rules. Reads
// only: nothing here writes, so two moments read the same data. The caller sets the clock (some
// loaders read it themselves) and passes the same moment as `now`. No Claude: the chat questions
// go to the rules, as with no key.

// Questions a student asks about their own money, answered without Claude.
export const SWEEP_QUESTIONS = [
  "what's safe to spend",
  "how much did I spend this month",
  "what bills are coming up",
  "when do I get paid",
  "how much is my paycheck",
  "what subscriptions do I pay for",
  "what's my net worth",
  "what did you find",
  "what should I do first",
  "which bills have I paid this month",
] as const;

export async function snapshotAt(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Flat> {
  const asOf = await chatToday(userId, { client, now });
  const detected = detect(await loadDetectionInput(userId, { client, now }));
  const found = await detectFor(userId, { client, now });
  const top = await loadHubTop(userId, { client, now });
  const areas = top
    ? await loadHubAreas(
        userId,
        {
          budgetsOver: top.home.budgetsOver.length,
          safeShort: (top.home.safeToSpend?.safeCents ?? 0) < 0,
        },
        { client, now },
      )
    : null;
  const worth = top?.hero.netWorth?.todayCents ?? null;
  const chat: Record<string, unknown> = {};
  for (const question of SWEEP_QUESTIONS) {
    const reply = await answerByRules(userId, parseIntent(question, asOf), { client, now }).catch(
      (error: unknown) => ({ failed: error instanceof Error ? error.message : String(error) }),
    );
    chat[question] = reply;
  }
  const trees = await loadAreaTrees(userId);
  return flatten({
    asOf,
    detected: Object.fromEntries(detected.map((c) => [`${c.type}:${c.key}`, c])),
    suggestions: Object.fromEntries(found.suggestions.map((s) => [s.id, s])),
    profile: found.profile,
    home: top
      ? { summary: top.home, hero: heroView(top.hero), cashFlow: cashFlowView(top.cashFlow) }
      : null,
    // As Home shows them: each tile's status is its area's tree's (src/lib/hub/area-status.ts).
    tiles: areas ? withAreaStatus(tilesView(areas), trees) : null,
    trees,
    netWorth: worth === null ? null : await netWorthHistory(userId, worth, { client, now }),
    chat,
  });
}
