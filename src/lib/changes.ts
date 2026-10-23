import { BILL_CHANGE_FINDINGS, NEW_SUBSCRIPTION_FINDINGS } from "@/config/changes";
import type { FindingStatus, FindingType, PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/engine";
import { buildStreams } from "@/detection/streams";
import type { DetectionInput } from "@/detection/types";
import { detectChanges, type Change, type ChangeKind } from "@/insights/changes";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// Jane notices changes (spec step 97): the changes in src/insights/changes.ts for one
// person, minus the ones they said were expected, each with the finding that acts on it.
//
// Automation: a price rise on a bill or subscription is a price-rise finding (or a reshop or
// bill negotiation for insurance and bills) on the same stream; a new fee adds to the
// account's bank-fee finding; a new subscription is its subscription card, so the chat asks
// once (docs/feature-audit.md, cluster 10). Detection runs the standing rules right after it
// finds them (src/lib/standing-rules.ts), so at "Handle the safe stuff" and above Jane has already
// asked for the old price (small rises) or the fee back by herself: `handled` says so. At
// "Ask me first", or for a reshop or a call (never by rule), "Look into it" is the one tap
// (src/lib/jane-agent/actions/changes.ts).

type Options = { client?: PrismaClient; now?: Date };
// The detection input, when the caller already loaded it (Jane's snapshot shares one).
type LoadOptions = Options & { input?: DetectionInput };

export type ChangeFinding = {
  id: string;
  type: FindingType;
  status: FindingStatus;
  // Who said yes, when someone did: a standing rule (autopilot) or the person.
  handledBy: "rule" | "person" | null;
};

export type ChangeView = Change & {
  finding: ChangeFinding | null;
  // A late paycheck the lean-plan question (spec step 204) already asks about.
  askedByLean?: boolean;
};

// The finding that acts on a change, by the key it shares with it.
function findingKey(change: Change): { types: readonly FindingType[]; key: string } | null {
  if (change.kind === "bill_changed" && change.up && change.streamKey) {
    return { types: BILL_CHANGE_FINDINGS, key: change.streamKey };
  }
  if (change.kind === "new_fee" && change.accountId) {
    return { types: ["bank_fees"], key: `account:${change.accountId}` };
  }
  if (change.kind === "new_subscription" && change.streamKey) {
    return { types: NEW_SUBSCRIPTION_FINDINGS, key: change.streamKey };
  }
  return null;
}

export async function loadChanges(
  userId: string,
  { client = defaultClient, now = new Date(), input: given }: LoadOptions = {},
): Promise<ChangeView[]> {
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  const changes = detectChanges(input, buildStreams(input));
  if (changes.length === 0) return [];
  const db = scopedFor(userId, client);
  const wanted = changes.flatMap((c) => findingKey(c) ?? []);
  const late = changes.filter((c) => c.kind === "paycheck_late").map((c) => c.key);
  const [acks, findings, leans] = await Promise.all([
    db.changeAcks.findMany({
      where: { key: { in: changes.map((c) => c.key) } },
      select: { key: true },
    }),
    wanted.length === 0
      ? []
      : db.findings.findMany({
          where: { key: { in: wanted.map((w) => w.key) } },
          select: {
            id: true,
            type: true,
            key: true,
            status: true,
            decisions: {
              where: { choice: "yes", undoneAt: null },
              select: { source: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        }),
    late.length === 0
      ? []
      : db.leanPlans.findMany({ where: { changeKey: { in: late } }, select: { changeKey: true } }),
  ]);
  const expected = new Set(acks.map((a) => a.key));
  const askedByLean = new Set(leans.map((l) => l.changeKey));
  return changes
    .filter((c) => !expected.has(c.key))
    .map((change) => {
      const want = findingKey(change);
      const row = want
        ? findings.find((f) => f.key === want.key && want.types.includes(f.type))
        : undefined;
      const decision = row?.decisions[0];
      return {
        ...change,
        ...(askedByLean.has(change.key) ? { askedByLean: true } : {}),
        finding: row
          ? {
              id: row.id,
              type: row.type,
              status: row.status,
              handledBy: decision ? (decision.source === "rule" ? "rule" : "person") : null,
            }
          : null,
      };
    });
}

export class ChangeError extends Error {}

const CHANGE_KEY = /^(bill|new|late|smaller|employer|pace|fee):.{1,300}$/;

// "That's expected": this change is never brought up again.
export async function markChangeExpected(
  userId: string,
  key: string,
  kind: ChangeKind,
  { client = defaultClient }: Options = {},
): Promise<void> {
  if (!CHANGE_KEY.test(key)) throw new ChangeError("That change isn't there anymore.");
  await scopedFor(userId, client).changeAcks.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, kind },
    update: {},
  });
  await track(userId, "change_marked_expected", { kind });
}
