import { OUTCOME_ACTION_TYPES, OUTCOME_MIN_CASES } from "@/config/merchant-outcomes";
import {
  findInDirectory,
  normalizeAlias,
  type DirectoryMerchant,
} from "@/data-sources/merchant-directory";
import type { ActionType, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";

// How actions at each merchant tend to go: finished cases, how many succeeded, and the
// median minutes the team spent. Aggregated by the daily job from finished actions into
// merchant_outcomes, which holds counts only. Shown once a merchant has
// OUTCOME_MIN_CASES cases of a kind.

export type FinishedAction = {
  merchantName: string | null;
  actionType: ActionType;
  status: "done" | "failed";
  minutesSpent: number | null;
};

export type Outcome = {
  merchantKey: string;
  actionType: ActionType;
  cases: number;
  succeeded: number;
  medianMinutes: number | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// The merchant a case counts toward: the directory's key when it knows the merchant (so
// "Spotify USA" and "Spotify" count together), else the normalized name.
function merchantKeyOf(name: string | null, directory: readonly DirectoryMerchant[]) {
  const key = name ? normalizeAlias(name) : null;
  if (!key) return null;
  return findInDirectory(key, directory)?.key ?? key;
}

// Pure: finished actions in, one row per merchant and action type out.
export function computeOutcomes(
  actions: FinishedAction[],
  directory: readonly DirectoryMerchant[],
): Outcome[] {
  const groups = new Map<string, { key: string; type: ActionType; rows: FinishedAction[] }>();
  for (const a of actions) {
    if (!OUTCOME_ACTION_TYPES.includes(a.actionType)) continue;
    const key = merchantKeyOf(a.merchantName, directory);
    if (!key) continue;
    const id = `${key}\u0000${a.actionType}`;
    const group = groups.get(id) ?? { key, type: a.actionType, rows: [] };
    group.rows.push(a);
    groups.set(id, group);
  }
  return [...groups.values()]
    .map(({ key, type, rows }) => ({
      merchantKey: key,
      actionType: type,
      cases: rows.length,
      succeeded: rows.filter((r) => r.status === "done").length,
      medianMinutes: median(
        rows
          .filter((r) => r.status === "done" && r.minutesSpent !== null)
          .map((r) => r.minutesSpent as number),
      ),
    }))
    .sort(
      (a, b) =>
        a.merchantKey.localeCompare(b.merchantKey) || a.actionType.localeCompare(b.actionType),
    );
}

// The daily refresh. A system job: it reads finished actions across everyone, but only
// counts leave this function.
export async function refreshMerchantOutcomes({
  client = defaultClient,
}: { client?: PrismaClient } = {}): Promise<{ merchants: number }> {
  const [finished, directory] = await Promise.all([
    client.action.findMany({
      where: { status: { in: ["done", "failed"] }, type: { in: [...OUTCOME_ACTION_TYPES] } },
      select: {
        type: true,
        status: true,
        minutesSpent: true,
        decision: { select: { finding: { select: { evidence: true } } } },
      },
    }),
    client.merchant.findMany({ select: { key: true, name: true, aliases: true, category: true } }),
  ]);
  const outcomes = computeOutcomes(
    finished.map((a) => {
      const merchant = (a.decision.finding.evidence as { merchant?: unknown } | null)?.merchant;
      return {
        merchantName: typeof merchant === "string" ? merchant : null,
        actionType: a.type,
        status: a.status as "done" | "failed",
        minutesSpent: a.minutesSpent,
      };
    }),
    directory,
  );
  await client.$transaction([
    client.merchantOutcome.deleteMany({}),
    client.merchantOutcome.createMany({ data: outcomes }),
  ]);
  return { merchants: new Set(outcomes.map((o) => o.merchantKey)).size };
}

// What to show for a merchant (its directory key, or the normalized name for one the directory
// doesn't know) and action, or null below the minimum number of cases. Looked up through
// companyFacts (src/lib/merchants.ts), which matches the name once.
export async function outcomeAt(
  merchantKey: string,
  actionType: ActionType,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<Outcome | null> {
  const row = await client.merchantOutcome.findUnique({
    where: { merchantKey_actionType: { merchantKey, actionType } },
    select: {
      merchantKey: true,
      actionType: true,
      cases: true,
      succeeded: true,
      medianMinutes: true,
    },
  });
  return row && row.cases >= OUTCOME_MIN_CASES ? row : null;
}

// "Cancellations here usually take about 10 minutes; 7 of 8 worked."
export function describeOutcome(o: Outcome): string {
  const time = o.medianMinutes === null ? "" : `usually about ${o.medianMinutes} minutes; `;
  return `${time}${o.succeeded} of ${o.cases} worked`;
}
