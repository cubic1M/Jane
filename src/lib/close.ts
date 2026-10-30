import { CLOSE_CHANGE_DAYS } from "@/config/close";
import { SUGGESTION_CONFIDENCE_FROM } from "@/config/priorities";
import { loadDetectionInput } from "@/detection/engine";
import { buildStreams } from "@/detection/streams";
import type { DetectionInput } from "@/detection/types";
import type { Confidence, FindingType, PrismaClient } from "@/generated/prisma/client";
import { detectChanges, type SureChange } from "@/insights/changes";
import { loadCheckup } from "@/lib/checkup";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { withEvidence } from "@/lib/evidence/gate";
import { evidenceRefs } from "@/lib/finding-accounts";
import { savingsLedger, type LedgerEntry } from "@/lib/ledger";
import { todayOf } from "@/lib/today";
import { closeOf, type CloseChange, type MonthClose } from "@/planning/close";

// The monthly close for one person and month (src/planning/close.ts): the savings ledger, the
// month's changes (src/insights/changes.ts, as the weekly email reads them), price rises and
// trials that turned paid (the findings Jane made that month), and the checkup
// (src/lib/checkup.ts) for a month with nothing wrong. Read-only; no Claude call.

type Options = { client?: PrismaClient; now?: Date };

// The findings that are changes themselves, by type.
const FINDING_CHANGES: Partial<Record<FindingType, CloseChange["kind"]>> = {
  price_increase: "price_rise",
  trial_conversion: "trial_paid",
};

// A finding stores a level, the band its percentage fell in.
export function bandOf(level: Confidence): string {
  const { high, medium } = SUGGESTION_CONFIDENCE_FROM;
  if (level === "high") return `${high}%+`;
  if (level === "medium") return `${medium}%+`;
  return `under ${medium}%`;
}

const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

// The month's changes: changes.ts looks back from a day, so it is read as of a few days of the
// month and put together, each once.
export function monthChanges(input: DetectionInput, month: string): SureChange[] {
  const end = lastDay(month) < input.asOf ? lastDay(month) : input.asOf;
  const days = [
    ...CLOSE_CHANGE_DAYS.map((d) => `${month}-${String(d).padStart(2, "0")}`),
    end,
  ].filter((d) => d <= end);
  const seen = new Map<string, SureChange>();
  for (const asOf of days) {
    const at = { ...input, asOf, transactions: input.transactions.filter((t) => t.date <= asOf) };
    for (const c of detectChanges(at, buildStreams(at))) {
      if (c.date.slice(0, 7) === month && !seen.has(c.key)) seen.set(c.key, c);
    }
  }
  return [...seen.values()];
}

function closeChange(c: SureChange): CloseChange | null {
  const kind =
    c.kind === "bill_changed" && c.up
      ? "bill_jump"
      : c.kind === "new_fee"
        ? "new_fee"
        : c.kind === "premium_renewed"
          ? "renewal"
          : null;
  if (!kind) return null;
  return {
    key: c.key,
    kind,
    date: c.date,
    title: c.title,
    amountCents: c.amountCents,
    usualCents: c.usualCents,
    sure: `${c.confidence.percent}%`,
  };
}

export async function loadMonthClose(
  userId: string,
  month: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<MonthClose<LedgerEntry>> {
  const today = await todayOf(userId, { client, now });
  const end = lastDay(month) < today ? lastDay(month) : today;
  const db = scopedFor(userId, client);
  const [ledger, input, acks, found, open] = await Promise.all([
    savingsLedger(userId, { client, now }),
    loadDetectionInput(userId, { client, now: new Date(`${end}T12:00:00Z`) }),
    db.changeAcks.findMany({ select: { key: true } }),
    db.findings.findMany({
      where: {
        type: { in: Object.keys(FINDING_CHANGES) as FindingType[] },
        createdAt: {
          gte: new Date(`${month}-01T00:00:00Z`),
          lte: new Date(`${end}T23:59:59Z`),
        },
        status: { notIn: ["declined"] },
      },
      select: {
        id: true,
        type: true,
        key: true,
        title: true,
        amountCents: true,
        confidence: true,
        createdAt: true,
        evidence: true,
      },
    }),
    db.findings.findMany({
      where: { status: { in: ["new", "shown"] } },
      select: { type: true },
    }),
  ]);
  const expected = new Set(acks.map((a) => a.key));
  // Only findings still standing on the person's data (the evidence gate): never a removed bank's.
  const findings = await withEvidence(userId, found, (f) => evidenceRefs(f.evidence), { client });
  const fromFindings: CloseChange[] = findings.map((f) => {
    const before = (f.evidence as { priorAverageCents?: unknown } | null)?.priorAverageCents;
    return {
      key: `finding:${f.id}`,
      kind: FINDING_CHANGES[f.type]!,
      date: f.createdAt.toISOString().slice(0, 10),
      title: f.title,
      amountCents: f.amountCents ?? 0,
      usualCents: typeof before === "number" ? before : null,
      sure: bandOf(f.confidence),
    };
  });
  // A bill that went up and its price-rise finding are one change.
  const rises = new Set(findings.filter((f) => f.type === "price_increase").map((f) => f.key));
  const changes = [
    ...fromFindings,
    ...monthChanges(input, month)
      .filter((c) => !expected.has(c.key) && !(c.streamKey && rises.has(c.streamKey)))
      .flatMap((c) => closeChange(c) ?? []),
  ];
  const checkup = await loadCheckup(
    userId,
    open.map((f) => f.type),
    { client, now },
  );
  return closeOf({ month, today, entries: ledger.entries, changes, checkup });
}
