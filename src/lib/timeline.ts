import { SECTOR_LABELS, type Sector } from "@/config/autopilot-sectors";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";

// Everything Jane did (spec step 187): one honest record across sectors. Every action
// Jane takes by herself is written to autopilot_acts (recordAct, src/lib/sector-autopilot.ts)
// when she takes it, so each appears here with its reason; what the person tapped through
// the money-movement partner and yes-answers from standing rules are added. Transfers
// still pending can be undone from /transfers.

export type TimelineEntry = {
  id: string;
  at: Date;
  sector: string;
  sectorLabel: string;
  by: "jane" | "you";
  what: string;
  why: string;
  cents: number | null;
  // Where to undo it while it still can be, or null.
  undoHref: string | null;
};

const labelOf = (sector: string) => SECTOR_LABELS[sector as Sector] ?? "Other";

export async function loadTimeline(
  userId: string,
  { client = defaultClient, limit = 50 }: { client?: PrismaClient; limit?: number } = {},
): Promise<TimelineEntry[]> {
  const db = scopedFor(userId, client);
  const [acts, transfers, rules] = await Promise.all([
    db.autopilotActs.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      select: { id: true, sector: true, cents: true, what: true, createdAt: true },
    }),
    db.moneyTransfers.findMany({
      where: { by: "person" },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        sector: true,
        toName: true,
        amountCents: true,
        status: true,
        createdAt: true,
      },
    }),
    db.decisions.findMany({
      where: { source: "rule", choice: "yes" },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      select: { id: true, cardSnapshot: true, createdAt: true, ruleKey: true },
    }),
  ]);
  const entries: TimelineEntry[] = [
    ...acts.map((a): TimelineEntry => ({
      id: `act:${a.id}`,
      at: a.createdAt,
      sector: a.sector,
      sectorLabel: labelOf(a.sector),
      by: "jane",
      what: a.what,
      why: `${labelOf(a.sector)} is on your autopilot, and this was within the limits you set.`,
      cents: a.cents > 0 ? a.cents : null,
      undoHref: null,
    })),
    ...transfers.map((t): TimelineEntry => ({
      id: `transfer:${t.id}`,
      at: t.createdAt,
      sector: t.sector,
      sectorLabel: labelOf(t.sector),
      by: "you",
      what: `Moved ${formatCents(t.amountCents)} to ${t.toName}${
        t.status === "cancelled" ? " (undone)" : ""
      }`,
      why: "You said yes in the chat.",
      cents: t.amountCents,
      undoHref: t.status === "pending" ? "/transfers" : null,
    })),
    ...rules.map((d): TimelineEntry => {
      const title = (d.cardSnapshot as { title?: unknown } | null)?.title;
      return {
        id: `rule:${d.id}`,
        at: d.createdAt,
        sector: "bills",
        sectorLabel: labelOf("bills"),
        by: "jane",
        what: typeof title === "string" ? title : "Said yes for you",
        why: "A standing rule you set said yes to this.",
        cents: null,
        undoHref: null,
      };
    }),
  ];
  return entries
    .sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id))
    .slice(0, limit);
}
