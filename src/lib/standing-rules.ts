import {
  NEVER_BY_RULE,
  RULE_DEFAULT_MONTHLY_LIMIT,
  RULE_MONTHLY_LIMITS,
  RULE_UNDO_HOURS,
  STANDING_RULES,
  type RuleDefinition,
} from "@/config/rules";
import type { FindingType, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { ACTION_FOR_FINDING, CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { DecisionError, recordDecision } from "@/lib/decisions";
import { sendPush } from "@/lib/push";
import { partnerForUser } from "@/lib/referrals";
import { autopilotFor, recordAct } from "@/lib/sector-autopilot";

type Options = { client?: PrismaClient; now?: Date };

export type SavedRule = {
  key: string;
  enabled: boolean;
  monthlyLimit: number;
  maxAnnualCents: number | null;
};

export type RuleView = RuleDefinition & SavedRule;

// Every rule, with the person's settings (off until they turn it on).
export async function rulesFor(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<RuleView[]> {
  const saved = await scopedFor(userId, client).standingRules.findMany({
    select: { key: true, enabled: true, monthlyLimit: true, maxAnnualCents: true },
  });
  const byKey = new Map(saved.map((r) => [r.key, r]));
  return STANDING_RULES.map((definition) => ({
    ...definition,
    key: definition.key,
    enabled: byKey.get(definition.key)?.enabled ?? false,
    monthlyLimit: byKey.get(definition.key)?.monthlyLimit ?? RULE_DEFAULT_MONTHLY_LIMIT,
    maxAnnualCents:
      byKey.get(definition.key)?.maxAnnualCents ?? definition.maxAmount?.defaultCents ?? null,
  }));
}

export class RuleError extends Error {}

export async function saveRules(
  userId: string,
  rules: SavedRule[],
  { client = defaultClient }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  for (const rule of rules) {
    const definition = STANDING_RULES.find((d) => d.key === rule.key);
    if (!definition) throw new RuleError("That rule doesn't exist.");
    if (!(RULE_MONTHLY_LIMITS as readonly number[]).includes(rule.monthlyLimit)) {
      throw new RuleError("Pick one of the monthly limits.");
    }
    const maxAnnualCents = definition.maxAmount ? rule.maxAnnualCents : null;
    if (definition.maxAmount && (maxAnnualCents === null || maxAnnualCents <= 0)) {
      throw new RuleError(`Enter an amount for "${definition.label}".`);
    }
    const data = { enabled: rule.enabled, monthlyLimit: rule.monthlyLimit, maxAnnualCents };
    // Upsert by hand: scoped tables match on userId as well as the unique key.
    const existing = await db.standingRules.findFirst({
      where: { key: rule.key },
      select: { id: true },
    });
    if (existing) {
      await db.standingRules.updateMany({ where: { id: existing.id }, data });
    } else {
      await db.standingRules.create({ data: { userId, key: rule.key, ...data } });
    }
  }
  await logAudit(
    { type: "user", id: userId },
    "standing_rules_saved",
    { type: "user", id: userId },
    {
      enabled: rules
        .filter((r) => r.enabled)
        .map((r) => r.key)
        .join(","),
    },
  );
}

// The enabled rule that approves this finding, if any. Never one for an action that
// always needs a yes on the item itself.
export function matchingRule(
  finding: { type: FindingType; annualSavingsCents: number | null },
  rules: SavedRule[],
): SavedRule | null {
  if (NEVER_BY_RULE.includes(ACTION_FOR_FINDING[finding.type])) return null;
  for (const rule of rules) {
    const definition = STANDING_RULES.find((d) => d.key === rule.key);
    if (!rule.enabled || !definition?.findingTypes.includes(finding.type)) continue;
    if (definition.maxAmount) {
      if (finding.annualSavingsCents === null || rule.maxAnnualCents === null) continue;
      if (finding.annualSavingsCents > rule.maxAnnualCents) continue;
    }
    return rule;
  }
  return null;
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export type RuleApproval = { findingId: string; decisionId: string; ruleKey: string };

// Approves open findings that match the person's enabled rules, within each rule's monthly
// limit. A finding the person took back from a rule is never approved by a rule again.
export async function applyStandingRules(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<RuleApproval[]> {
  const db = scopedFor(userId, client);
  const rules = (await rulesFor(userId, { client })).filter((r) => r.enabled);
  if (rules.length === 0) return [];
  // Spec step 141: the rules are Subscriptions and bills' fine-tuning. They ask for money
  // back and move none, so only the person setting that area to "Always ask" stops them
  // ("Ask me first" already turns every rule off).
  const bills = await autopilotFor(userId, "bills", { client, now });
  if (bills.source === "set" && bills.level === "ask") return [];

  const [findings, takenBack, usedThisMonth] = await Promise.all([
    db.findings.findMany({
      where: { status: { in: ["new", "shown"] } },
      select: CARD_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.decisions.findMany({
      where: { source: "rule", undoneAt: { not: null } },
      select: { findingId: true },
    }),
    db.decisions.groupBy({
      by: ["ruleKey"],
      where: { source: "rule", undoneAt: null, createdAt: { gte: monthStart(now) } },
      _count: true,
    }),
  ]);
  const skip = new Set(takenBack.map((d) => d.findingId));
  const used = new Map(usedThisMonth.map((g) => [g.ruleKey, g._count]));

  const approvals: RuleApproval[] = [];
  for (const finding of findings) {
    if (skip.has(finding.id)) continue;
    const rule = matchingRule(finding, rules);
    if (!rule || (used.get(rule.key) ?? 0) >= rule.monthlyLimit) continue;
    const card = buildCard(
      finding,
      await partnerForUser(userId, ACTION_FOR_FINDING[finding.type], { client }),
    );
    try {
      const { decisionId } = await recordDecision(
        userId,
        {
          findingId: finding.id,
          choice: "yes",
          cardHash: cardHash(card),
          source: "rule",
          ruleKey: rule.key,
        },
        { client },
      );
      used.set(rule.key, (used.get(rule.key) ?? 0) + 1);
      await recordAct(userId, "bills", 0, `Said yes under a rule: ${finding.title}`, {
        client,
        now,
      });
      approvals.push({ findingId: finding.id, decisionId, ruleKey: rule.key });
    } catch (error) {
      // Answered by the person in the meantime: nothing to do.
      if (!(error instanceof DecisionError)) throw error;
    }
  }

  if (approvals.length > 0) {
    const n = approvals.length;
    await sendPush(
      userId,
      {
        title: "Jane used your rules",
        body: `Approved ${n} ${n === 1 ? "thing" : "things"} for you. You can take ${n === 1 ? "it" : "them"} back for a day.`,
        url: "/plan",
      },
      { client },
    ).catch((error) => console.error("Rule push failed", { userId, error: String(error) }));
  }
  return approvals;
}

export type RecentRuleApproval = {
  decisionId: string;
  title: string;
  ruleLabel: string;
  createdAt: Date;
  canUndo: boolean;
};

// Approvals made by rules in the last day, for /plan.
export async function recentRuleApprovals(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<RecentRuleApproval[]> {
  const since = new Date(now.getTime() - RULE_UNDO_HOURS * 60 * 60 * 1000);
  const decisions = await scopedFor(userId, client).decisions.findMany({
    where: { source: "rule", undoneAt: null, createdAt: { gte: since } },
    select: {
      id: true,
      ruleKey: true,
      createdAt: true,
      cardSnapshot: true,
      action: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return decisions.map((d) => ({
    decisionId: d.id,
    title: String((d.cardSnapshot as { title?: unknown } | null)?.title ?? "Approved by a rule"),
    ruleLabel: STANDING_RULES.find((r) => r.key === d.ruleKey)?.label ?? "A standing rule",
    createdAt: d.createdAt,
    canUndo: d.action?.status === "queued",
  }));
}

// Takes back a rule's approval within a day, if the work hasn't started. The finding goes
// back on the plan, and rules leave it alone from then on.
export async function undoRuleApproval(
  userId: string,
  decisionId: string,
  options: Options = {},
): Promise<void> {
  return undoApproval(userId, decisionId, "rule", RULE_UNDO_HOURS, options);
}

// Takes back an approval made by a rule or a one-tap link, within its window and before
// the work starts.
export async function undoApproval(
  userId: string,
  decisionId: string,
  source: "rule" | "link",
  windowHours: number,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const decision = await db.decisions.findFirst({
    where: { id: decisionId, source, undoneAt: null },
    select: {
      id: true,
      findingId: true,
      createdAt: true,
      action: { select: { id: true, status: true } },
    },
  });
  const ageHours = decision ? (now.getTime() - decision.createdAt.getTime()) / 3_600_000 : Infinity;
  if (!decision || ageHours > windowHours || decision.action?.status !== "queued") {
    throw new DecisionError(
      "cannot_undo",
      "This can't be taken back anymore: the work has started.",
    );
  }
  const actionId = decision.action.id;
  await db.transaction(async (tx) => {
    // Only while still queued, so the team can't be mid-way through it.
    const removed = await tx.actions.deleteMany({ where: { id: actionId, status: "queued" } });
    if (removed.count === 0) {
      throw new DecisionError(
        "cannot_undo",
        "This can't be taken back anymore: the work has started.",
      );
    }
    await tx.decisions.updateMany({ where: { id: decision.id }, data: { undoneAt: now } });
    await tx.findings.updateMany({
      where: { id: decision.findingId, status: "approved" },
      data: { status: "shown" },
    });
  });
  await logAudit(
    { type: "user", id: userId },
    "decision_undone",
    { type: "finding", id: decision.findingId },
    { decision_id: decision.id, source },
  );
  await track(userId, "rule_approval_undone", {});
}
