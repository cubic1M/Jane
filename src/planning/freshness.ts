import {
  STATEMENT_ASK_GRACE_DAYS,
  STATEMENT_ASK_MAX_CYCLES,
  STATEMENT_CYCLE_DAYS,
} from "@/config/import";
import { DAY_MS } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";

// How current a person's uploaded statements are. Pure: each uploaded account and the last day its
// statements reach in; which have a new statement ready out. A bank link keeps itself current, so
// only accounts with no link count. For the ask when a cycle ends, and for the nightly run saying
// plainly when it only has old data.

export type UploadedAccount = { id: string; name: string; coveredThrough: string | null };

export type Freshness = {
  // Accounts with uploaded data.
  uploaded: { id: string; name: string; coveredThrough: string }[];
  // No bank link at all: everything Jane knows came from files.
  uploadOnly: boolean;
  // Those with a new statement ready, oldest first.
  due: { id: string; name: string; coveredThrough: string }[];
  // The newest day any uploaded statement reaches, or null with none.
  newest: string | null;
};

const daysBetween = (from: string, to: string) =>
  Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

const isDue = (coveredThrough: string, asOf: string) =>
  daysBetween(coveredThrough, asOf) >= STATEMENT_CYCLE_DAYS + STATEMENT_ASK_GRACE_DAYS;

export function freshnessOf(
  accounts: readonly UploadedAccount[],
  { hasBank, asOf }: { hasBank: boolean; asOf: string },
): Freshness {
  const uploaded = accounts.flatMap((a) =>
    a.coveredThrough ? [{ id: a.id, name: a.name, coveredThrough: a.coveredThrough }] : [],
  );
  const due = uploaded
    .filter((a) => isDue(a.coveredThrough, asOf))
    .sort((a, b) => a.coveredThrough.localeCompare(b.coveredThrough) || a.id.localeCompare(b.id));
  const newest = uploaded.reduce<string | null>(
    (best, a) => (best === null || a.coveredThrough > best ? a.coveredThrough : best),
    null,
  );
  return { uploaded, uploadOnly: !hasBank && uploaded.length > 0, due, newest };
}

export type StatementAsk = { key: string; title: string; body: string; dueDays: string[] };

// The ask, once a cycle while the statements are behind, by the newest day a due account reaches.
// Null when nothing is due, or after STATEMENT_ASK_MAX_CYCLES (someone who stopped uploading isn't
// asked forever; the nightly run still says the data is old).
export function statementAsk(freshness: Freshness, asOf: string): StatementAsk | null {
  if (freshness.due.length === 0) return null;
  const newestDue = freshness.due.at(-1)!.coveredThrough;
  const late = daysBetween(newestDue, asOf) - STATEMENT_ASK_GRACE_DAYS;
  const cycle = Math.floor(late / STATEMENT_CYCLE_DAYS);
  if (cycle > STATEMENT_ASK_MAX_CYCLES) return null;
  const names = freshness.due.map((a) => a.name);
  const those =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const day = dayLabel(newestDue);
  return {
    key: `statement:${newestDue}:${cycle}`,
    title:
      names.length === 1
        ? `A new statement for ${those} should be ready`
        : `New statements for ${those} should be ready`,
    body: `What I have ends ${day}, so I can't check anything after it. Upload the new one and I'll pick up from there.`,
    dueDays: freshness.due.map((a) => a.coveredThrough),
  };
}

// The newest day a due statement reaches, from an ask's key.
export const askDay = (key: string): string | null =>
  /^statement:(\d{4}-\d{2}-\d{2}):/.exec(key)?.[1] ?? null;

// What the nightly run says when it only had old data, or null when the data is current.
export function oldDataLine(freshness: Freshness): string | null {
  if (freshness.due.length === 0) return null;
  const allOld = freshness.uploadOnly && freshness.due.length === freshness.uploaded.length;
  if (allOld) {
    return `I only had old data to check: your newest statement ends ${dayLabel(freshness.newest!)}. Upload a newer one and I'll check it.`;
  }
  const oldest = freshness.due[0];
  return freshness.due.length === 1
    ? `${oldest.name} only reaches ${dayLabel(oldest.coveredThrough)}, so I couldn't check it past then.`
    : `${freshness.due.length} accounts only reach as far as their last statements (the oldest ends ${dayLabel(oldest.coveredThrough)}).`;
}

// "as far as your statements reach (Oct 28)", on a line that would otherwise sound complete.
export function reachWords(freshness: Freshness): string | null {
  return freshness.uploadOnly && freshness.newest
    ? `as far as your statements reach (${dayLabel(freshness.newest)})`
    : null;
}
