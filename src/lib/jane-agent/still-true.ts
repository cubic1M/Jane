import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { alertDayOf } from "@/detection/alerts";
import { parseKey } from "@/detection/unusual";
import { daysBetween } from "@/detection/units";
import type { Deadline } from "@/insights/deadlines";
import type { BudgetProposal, GoalProposal } from "@/planning/proposals";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { openGaps } from "@/lib/insurance/gaps";
import { picksSince } from "@/lib/picks-since";
import { savingsLine } from "@/lib/savings-text";
import { chatToday, todayOf } from "@/lib/today";
import { deadlineHeadsUp } from "./sources/heads-ups";
import { sentence } from "./sources/source";
import { planWords } from "./sources/plan";
import { setupBody } from "./sources/setup";
import { suggestionCard } from "./sources/suggestions";
import type { Snapshot } from "./snapshot";
import { MESSAGE_SELECT, toChatMessage, type ChatMessage } from "./types";
import { loadChanges } from "@/lib/changes";
import { dayLabel } from "@/lib/day-label";
import { loadTightMoney, type TightMoney } from "@/lib/tight-money";
import { loadComingUp } from "@/lib/coming-up";
import { conciergeMode } from "@/lib/concierge-mode";
import { loadInsurance } from "@/lib/insurance/profile";
import { findingFingerprint } from "./fingerprint";
import { firstUnsent, tightPlanBody } from "./tight-money-replies";
import { cashCard, cashToBringUp } from "./investments/cash-copy";
import { loadCash } from "@/lib/investments/cash";
import { findingSureFacts } from "@/lib/finding-sures";
import { findingSure } from "@/lib/report-state";

// Jane's cards say what was true when they were posted, and stay open for days. Before one
// shows again (the dock, Home, the chat's cards) it is checked against the person's data now
// (card-chat mismatch: after the demo bank was disconnected, the dock still said "Coming up in
// 3 days: Return window for Apple Store ($1,349.00)" while the chat found no such purchase):
// - a deadline heads-up whose deadline is gone (its purchase was in a bank since removed, or
//   was refunded) or has passed is put away; one that still holds is said as of today;
// - an alert about a charge that's no longer in the accounts is put away, and so is a deadline
//   reminder whose deadline is gone and a low balance ahead that no longer is;
// - a coverage gap that has closed (the policy was added, or found in the payments) is put away;
// - a finding's card whose finding changed (a later file showed a card charging interest, so the
//   idle cash no longer "could earn" anything) is said as the finding is now, and its stored words
//   and fingerprint follow, or its Yes would say "This one changed since I posted it";
// - a change Jane noticed ("By now you'd usually have spent about $37.08") is said as Jane
//   sees it today, and put away once it no longer shows (src/lib/changes.ts);
// - the cash plan is said with today's figures, one card at a time (debug 3, 11-22), and put away
//   once there's no plan worth bringing up;
// - the week's plan is said as the plan is now (debugger 11-13: a new student's card said "22
//   things, worth up to $3,560.81 a year" from the first scan's early run, while Home and /plan
//   said 23 and $3,720.81 once the slower work had added an item), and put away once it's empty.
// The deadlines come from loadComingUp, the one loader Today, Ahead, the snapshot behind the
// heads-ups and the chat's coming_up all read, so the dock can't say what they don't.

type Options = { client?: PrismaClient; now?: Date };

type SuggestionRow = {
  key: string;
  headline: string;
  short: string;
  why: string;
  confidencePercent: number;
  confidenceReason: string;
};

type Facts = {
  asOf: string;
  deadlines: Map<string, Deadline>;
  // Alerts, by id: whether each still holds.
  alerts: Map<string, boolean>;
  // The changes Jane sees today, by key: each one's title.
  changes: Map<string, string> | null;
  // The suggestions behind suggestion cards, by key, as the last scan left them.
  suggestions: Map<string, SuggestionRow>;
  // The open budget and goal proposals behind set-up cards, by key, as the last refresh left them.
  proposals: Map<string, BudgetProposal | GoalProposal> | null;
  // The coverage gaps still open, by key; null when no card here is about one.
  gaps: Set<string> | null;
  // The open findings behind finding cards, by id, as they are now.
  findings: Map<
    string,
    {
      type: string;
      title: string;
      savings: string;
      fingerprint: string;
      // How sure, as the finding's card says it now (findingSure, as the snapshot works it out).
      sure: { percent: number; reason: string };
    }
  > | null;
  // The topics of the suggestions the last scans offered (answered or not), when a card here is
  // about a finding: a suggestion on a finding's type already brings that finding up.
  suggestionTopics: Set<string> | null;
  // The tight month's plan as it is today, when a card here is one (./sources/tight-money.ts).
  tight: TightMoney | null;
  // The cash plan worth bringing up today (or none), when a card here is one.
  cash: { plan: ReturnType<typeof cashToBringUp> } | null;
  // The plan as /plan has it now, for the week's plan card; null when no card here is one.
  plan: { now: Snapshot["plan"]; concierge: boolean } | null;
};

type AlertRow = { id: string; type: string; key: string };

const needsDeadlines = (m: ChatMessage, deadlineAlerts: ReadonlySet<string>) =>
  m.refs.deadlineKey !== undefined ||
  (m.refs.alertId !== undefined && deadlineAlerts.has(m.refs.alertId));

const comingUp = (userId: string, client: PrismaClient, now: Date) =>
  loadComingUp(userId, { client, now, days: 0 });

// Whether each alert still holds: one about a charge (src/detection/unusual.ts keyOf names its
// transaction) while the charge is in the accounts, a deadline reminder while its deadline is,
// and a dated one (a bill due, a renewal) through its day, the person's today.
async function holding(
  userId: string,
  alerts: readonly AlertRow[],
  deadlines: ReadonlyMap<string, Deadline>,
  client: PrismaClient,
  now: Date,
): Promise<Map<string, boolean>> {
  const today = alerts.some((a) => alertDayOf(a) !== null)
    ? await todayOf(userId, { client, now })
    : "";
  const charged = alerts.flatMap((a) => {
    const parsed = a.type === "unusual_activity" ? parseKey(a.key) : null;
    return parsed ? [parsed.transactionId] : [];
  });
  const present = new Set(
    charged.length
      ? (
          await scopedFor(userId, client).transactions.findMany({
            where: { id: { in: charged } },
            select: { id: true },
          })
        ).map((t) => t.id)
      : [],
  );
  // A low balance ahead (key "account:<id>:<month>") holds while its account's forecast still
  // dips: the low-balance finding goes once it doesn't (debug 2, 11-17: the first sync's 30 days
  // had no paycheck pattern, so "could drop to -$427.25", which four months later Money said was
  // "$658.94 on Dec 9" while the dock kept the alert).
  const lowKeys = alerts.flatMap((a) =>
    a.type === "low_balance" ? [a.key.slice(0, a.key.lastIndexOf(":"))] : [],
  );
  const dipping = new Set(
    lowKeys.length
      ? (
          await scopedFor(userId, client).findings.findMany({
            where: { type: "low_balance_risk", key: { in: lowKeys } },
            select: { key: true },
          })
        ).map((f) => f.key)
      : [],
  );
  return new Map(
    alerts.map((a) => {
      if (a.type === "deadline_soon") return [a.id, deadlines.has(a.key)];
      if (a.type === "low_balance")
        return [a.id, dipping.has(a.key.slice(0, a.key.lastIndexOf(":")))];
      const day = alertDayOf(a);
      if (day !== null) return [a.id, day >= today];
      const parsed = a.type === "unusual_activity" ? parseKey(a.key) : null;
      return [a.id, !parsed || present.has(parsed.transactionId)];
    }),
  );
}

// The alerts that still hold, for the chat's alerts lookup: it says what the dock does.
export async function alertsThatHold<T extends AlertRow>(
  userId: string,
  alerts: readonly T[],
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<T[]> {
  const deadlines = alerts.some((a) => a.type === "deadline_soon")
    ? new Map((await comingUp(userId, client, now)).deadlines.map((d) => [d.key, d]))
    : new Map<string, Deadline>();
  const held = await holding(userId, alerts, deadlines, client, now);
  return alerts.filter((a) => held.get(a.id) !== false);
}

async function factsFor(
  userId: string,
  messages: readonly ChatMessage[],
  client: PrismaClient,
  now: Date,
): Promise<Facts | null> {
  const alertIds = messages.flatMap((m) => (m.refs.alertId ? [m.refs.alertId] : []));
  const alerts = alertIds.length
    ? await scopedFor(userId, client).alerts.findMany({
        where: { id: { in: alertIds } },
        select: { id: true, type: true, key: true },
      })
    : [];
  const deadlineAlerts = new Set(alerts.filter((a) => a.type === "deadline_soon").map((a) => a.id));
  const withDeadlines = messages.some((m) => needsDeadlines(m, deadlineAlerts));
  const withChanges = messages.some((m) => m.refs.change !== undefined);
  const suggestionKeys = messages.flatMap((m) => (m.refs.suggestion ? [m.refs.suggestion] : []));
  const proposalKeys = messages.flatMap((m) => (m.refs.proposalKey ? [m.refs.proposalKey] : []));
  const withGaps = messages.some((m) => m.refs.insuranceGap !== undefined);
  const findingIds = messages.flatMap((m) =>
    m.refs.findingId && m.refs.fingerprint ? [m.refs.findingId] : [],
  );
  const withPlan = messages.some((m) => m.refs.weekStart !== undefined);
  const withTight = messages.some((m) => m.refs.tightItem !== undefined);
  const withCash = messages.some(openCash);
  if (
    !withPlan &&
    !withTight &&
    !withCash &&
    !withDeadlines &&
    !withChanges &&
    !withGaps &&
    findingIds.length === 0 &&
    alerts.length === 0 &&
    suggestionKeys.length === 0 &&
    proposalKeys.length === 0
  ) {
    return null;
  }
  const [coming, changes, suggestions, proposals, insurance, findings, plan, offered, tight, cash] =
    await Promise.all([
      withDeadlines ? comingUp(userId, client, now) : null,
      withChanges ? loadChanges(userId, { client, now }) : null,
      suggestionKeys.length > 0
        ? scopedFor(userId, client).suggestions.findMany({
            where: { key: { in: suggestionKeys } },
            select: {
              key: true,
              headline: true,
              short: true,
              why: true,
              confidencePercent: true,
              confidenceReason: true,
            },
          })
        : [],
      proposalKeys.length > 0
        ? scopedFor(userId, client).planProposals.findMany({
            where: { key: { in: proposalKeys }, status: "open" },
            select: { key: true, payload: true },
          })
        : null,
      withGaps ? loadInsurance(userId, { client, now }) : null,
      // Every open finding, for how many of each kind there are (findingSure reads it), with what
      // its "% sure" is worked out from.
      findingIds.length > 0
        ? Promise.all([
            scopedFor(userId, client).findings.findMany({
              where: { status: { in: ["new", "shown"] } },
              select: {
                id: true,
                type: true,
                title: true,
                annualSavingsCents: true,
                evidence: true,
                confidence: true,
              },
            }),
            findingSureFacts(scopedFor(userId, client), now, { client }),
          ])
        : null,
      withPlan ? planNow(userId, client) : null,
      findingIds.length > 0 || proposalKeys.some((k) => k.startsWith("goal:"))
        ? offeredTopics(userId, { client, now })
        : null,
      withTight ? loadTightMoney(userId, { client, now }) : null,
      withCash
        ? loadCash(userId, { client, now }).then((view) => ({ plan: cashToBringUp(view) }))
        : null,
    ]);
  const deadlines = new Map((coming?.deadlines ?? []).map((d) => [d.key, d]));
  return {
    asOf: coming?.asOf ?? (await chatToday(userId, { client, now })),
    deadlines,
    alerts: await holding(userId, alerts, deadlines, client, now),
    changes: changes && new Map(changes.map((c) => [c.key, c.title])),
    suggestions: new Map(suggestions.map((r) => [r.key, r])),
    proposals:
      proposals &&
      new Map(
        proposals.flatMap((p) => {
          const payload = p.payload as unknown as BudgetProposal | GoalProposal;
          return payload.kind === "budget" || payload.kind === "goal" ? [[p.key, payload]] : [];
        }),
      ),
    gaps: insurance && new Set(openGaps(insurance.gaps, insurance.policies).map((g) => g.key)),
    findings:
      findings &&
      new Map(
        findings[0]
          .filter((f) => findingIds.includes(f.id))
          .map((f) => [
            f.id,
            {
              type: f.type,
              title: f.title,
              savings: savingsLine(f.type, f.annualSavingsCents),
              fingerprint: findingFingerprint(f),
              sure: findingSure(
                f,
                findings[1].sures,
                findings[1].months,
                findings[0].filter((o) => o.type === f.type).length,
              ),
            },
          ]),
      ),
    suggestionTopics: offered,
    plan,
    tight,
    cash,
  };
}

// The plan's figures as /plan works them out (src/lib/plan.ts), and whether Jane acts for this
// person: what the plan card says.
async function planNow(
  userId: string,
  client: PrismaClient,
): Promise<{ now: Snapshot["plan"]; concierge: boolean }> {
  // Loaded late: the plan reaches this file again.
  const [{ planFor, planTotalCents, planOnceCents }, { isNoRisk }] = await Promise.all([
    import("@/lib/plan"),
    import("@/lib/plan-links"),
  ]);
  const [items, concierge] = await Promise.all([
    planFor(userId, { client }),
    conciergeMode(userId, { client }),
  ]);
  return {
    now: {
      items: items.length,
      annualSavingsCents: planTotalCents(items),
      onceCents: planOnceCents(items),
      safeItems: items.filter(isNoRisk).length,
    },
    concierge,
  };
}

// The topics of the suggestions the scan offered lately, answered or not: a finding or set-up goal
// card about one of them isn't asked beside it.
export async function offeredTopics(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Set<string>> {
  const rows = await scopedFor(userId, client).suggestions.findMany({
    where: {
      status: { in: ["selected", "yes", "no"] },
      selectedOn: { gte: picksSince(await todayOf(userId, { client, now })) },
    },
    select: { topic: true },
  });
  return new Set(rows.map((r) => r.topic));
}

// A set-up goal a suggestion already brings up: its card isn't shown, and "Use all" leaves it.
export const coveredGoal = (key: string, topics: ReadonlySet<string> | null) =>
  key.startsWith("goal:") && !!topics?.has(key.slice(5));

// A cash card still asking (one answered keeps what was chosen).
const openCash = (m: ChatMessage) => m.refs.cashPlan !== undefined && m.status === "open";

// The card as it should show now, or null when it no longer holds.
function asNow(m: ChatMessage, facts: Facts): ChatMessage | null {
  const { deadlineKey, deadlineEntryId, alertId, change, suggestion, proposalKey, insuranceGap } =
    m.refs;
  if (m.refs.weekStart !== undefined && facts.plan) {
    const { now, concierge } = facts.plan;
    return now.items === 0 ? null : { ...m, body: planWords(now, concierge) };
  }
  // The cash plan is said with today's figures (debug 3, 11-22: a retiree's dock held nine cash
  // cards, one posted most days, each with that day's figures), its buttons and key too, so a move
  // tapped is the one shown.
  if (openCash(m) && facts.cash) {
    if (!facts.cash.plan) return null;
    const card = cashCard(facts.cash.plan);
    return { ...m, ...card, refs: { ...m.refs, ...card.refs } };
  }
  // The tight month's plan is said from today's forecast (debug 3, 11-21: a linked month's dock said
  // "forecast to be down to $56.46 on Dec 12" until Dec 20). It goes once there's no shortfall, its
  // request isn't the next to send, or the shortfall is in another month, whose card is its own. A
  // card from before it kept its day stays only while it names today's shortfall day.
  if (m.refs.tightItem && facts.tight) {
    const { shortfall } = facts.tight;
    const next = firstUnsent(facts.tight);
    const was = m.refs.tightItem.shortfallOn;
    if (!shortfall || !next || next.id !== m.refs.tightItem.id) return null;
    if (
      was
        ? was.slice(0, 7) !== shortfall.date.slice(0, 7)
        : !m.body.includes(dayLabel(shortfall.date))
    )
      return null;
    return {
      ...m,
      body: tightPlanBody(facts.tight, next),
      refs: { ...m.refs, tightItem: { id: next.id, shortfallOn: shortfall.date } },
    };
  }
  if (insuranceGap && facts.gaps && !facts.gaps.has(insuranceGap)) return null;
  const finding = m.refs.findingId ? facts.findings?.get(m.refs.findingId) : undefined;
  // A finding one of the person's suggestions already brings up (the scan's topic is the finding's
  // type: bank_fees, idle_cash and the like) isn't asked about beside it, or again once it's
  // answered (debugger 11-14: a student's dock had "Stop paying bank and card fees, save $144/yr"
  // and, ten cards on, "$36.00 in fees on Chase checking", the same $12 a month; idle cash twice
  // too).
  if (finding && facts.suggestionTopics?.has(finding.type)) return null;
  const said = m.refs.confidence as { percent: number; reason: string } | undefined;
  const sureNow = finding?.sure;
  const sureMoved =
    said !== undefined &&
    sureNow !== undefined &&
    (said.percent !== sureNow.percent || said.reason !== sureNow.reason);
  // A change's card about a finding (./sources/changes.ts: "Audible is a new regular charge. Did you
  // mean to sign up?") says the change, not the finding: only its fingerprint follows, so its Yes
  // doesn't say the finding changed, and it's checked as a change's card below, going or said as of
  // today with its change (debug 3, 11-21: it was said as "Review your Audible subscription.", its
  // question dropped, a second card of the finding's own).
  if (finding && change && m.refs.fingerprint && finding.fingerprint !== m.refs.fingerprint)
    return asNow({ ...m, refs: { ...m.refs, fingerprint: finding.fingerprint } }, facts);
  if (
    finding &&
    !change &&
    m.refs.fingerprint &&
    (finding.fingerprint !== m.refs.fingerprint || sureMoved)
  ) {
    // Its pick and its question stay as they were; how sure is said as it is now (debug 2, 11-16:
    // after a bank's older history came in, "50% sure: 1 charge in 1 month of data" stayed on a
    // Netflix card with three charges in three months).
    const rest = /(?:My pick: .*)?Want [^?]*\?$/.exec(m.body)?.[0];
    const sure =
      said !== undefined ? `${finding.sure.percent}% sure: ${finding.sure.reason}.` : null;
    return {
      ...m,
      body: [sentence(finding.title), sentence(finding.savings), sure, rest]
        .filter(Boolean)
        .join(" "),
      refs: {
        ...m.refs,
        fingerprint: finding.fingerprint,
        ...(said !== undefined ? { confidence: finding.sure } : {}),
      },
    };
  }
  // Nor a set-up goal one of them already brings up (debugger 11-15: "Build an emergency cushion,
  // protect $1,674" and, three cards on, "I could start an 'Emergency fund' goal: $5,700.00").
  if (proposalKey && coveredGoal(proposalKey, facts.suggestionTopics)) return null;
  // A set-up card is said from its proposal as it is now (night debugger, 10-30: after a second
  // file the dock kept the first file's "$1,180 budget for Food and drink"); one no longer open
  // goes.
  if (proposalKey && facts.proposals) {
    const proposal = facts.proposals.get(proposalKey);
    if (!proposal) return null;
    // "Use all" counts the set-up cards shown, not one put away above (debugger 11-15: "Use all 3
    // suggestions" under two cards, and the third, the emergency fund, set up unseen).
    const shown = [...facts.proposals.keys()].filter(
      (k) => !coveredGoal(k, facts.suggestionTopics),
    ).length;
    const actions = m.actions.flatMap((a) =>
      a.id !== "setup.all"
        ? [a]
        : shown > 1
          ? [{ ...a, label: `Use all ${shown} suggestions` }]
          : [],
    );
    return { ...m, body: setupBody(proposal), actions };
  }
  // A suggestion card is said as the last scan left its suggestion: after a bank was
  // disconnected, "You keep $47,597.63 in cash" stayed while the scan said $19,447.51 (night
  // debugger, 10-30). One with no row (a news theme's alert) is checked elsewhere.
  const row = suggestion ? facts.suggestions.get(suggestion) : undefined;
  if (row) {
    const [, , , ...rest] = m.body.split("\n");
    return {
      ...m,
      body: [...suggestionCard(row), ...rest].join("\n"),
      refs: { ...m.refs, suggestionWhy: row.why },
    };
  }
  // An alert that no longer holds, or is gone altogether (removed with the data it was about:
  // src/lib/evidence/orphans.ts), takes its heads-up with it.
  if (alertId !== undefined && facts.alerts.get(alertId) !== true) return null;
  if (change && facts.changes) {
    const title = facts.changes.get(change.key);
    if (title === undefined) return null;
    if (m.body.includes(title)) return m;
    // Said as of today; a card from before titles were kept can't be, so it goes.
    return change.title && m.body.includes(change.title)
      ? { ...m, body: m.body.replace(change.title, title) }
      : null;
  }
  if (deadlineKey === undefined) return m;
  const deadline = facts.deadlines.get(deadlineKey);
  // One the person typed in is settled by its own row (./settled.ts); the list may leave out a
  // passed one.
  if (!deadline) return deadlineEntryId ? m : null;
  if (daysBetween(facts.asOf, deadline.date) < 0 && !deadlineEntryId) return null;
  return { ...m, body: deadlineHeadsUp(deadline, facts.asOf) };
}

// Puts away the ones that no longer hold (their links stay, like a card answered elsewhere).
async function putAway(
  userId: string,
  gone: readonly ChatMessage[],
  client: PrismaClient,
  now: Date,
) {
  let count = 0;
  for (const m of gone) {
    const result = await scopedFor(userId, client).janeMessages.updateMany({
      where: { id: m.id, status: "open" },
      data: {
        status: "answered",
        answeredAt: now,
        actions: m.actions.filter((a) => a.kind === "link") as Prisma.InputJsonArray,
        // A tight month's plan put away because its shortfall went can come back, once, when one
        // returns that month for the same request: the brain and postMessages let a key through
        // once its snooze is over (debug 3, 11-21: its dedupeKey, tight:<month>:<item>, kept a
        // returning shortfall from ever being said).
        ...(m.refs.tightItem ? { snoozedUntil: now } : {}),
      },
    });
    count += result.count;
  }
  return count;
}

// The cards that still hold, each said as of today; the rest are put away.
export async function stillTrue(
  userId: string,
  messages: readonly ChatMessage[],
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ChatMessage[]> {
  const facts = await factsFor(userId, messages, client, now);
  if (!facts) return [...messages];
  const kept: ChatMessage[] = [];
  const gone: ChatMessage[] = [];
  // One cash card at a time: the newest says it; older ones, from before its key left out the
  // figures, are put away.
  const newestCash = messages
    .filter(openCash)
    .reduce<ChatMessage | null>(
      (best, m) => (!best || m.createdAt.getTime() > best.createdAt.getTime() ? m : best),
      null,
    );
  for (const m of messages) {
    const shown = openCash(m) && m !== newestCash ? null : asNow(m, facts);
    if (shown) kept.push(shown);
    else gone.push(m);
  }
  if (gone.length > 0) await putAway(userId, gone, client, now);
  // What the Yes reads is the stored message, so a re-said finding card is stored as shown, and
  // a cash card with its buttons (a move checks the plan's key: src/lib/investments/cash.ts).
  const before = new Map(messages.map((m) => [m.id, m]));
  for (const m of kept) {
    const was = before.get(m.id);
    if (m.refs.findingId && m.refs.fingerprint !== was?.refs.fingerprint) {
      await scopedFor(userId, client).janeMessages.updateMany({
        where: { id: m.id, status: "open" },
        data: { body: m.body, refs: m.refs as Prisma.InputJsonObject },
      });
    }
    if (openCash(m) && (m.body !== was?.body || m.refs.cashPlan !== was?.refs.cashPlan)) {
      await scopedFor(userId, client).janeMessages.updateMany({
        where: { id: m.id, status: "open" },
        data: {
          kind: m.kind,
          body: m.body,
          refs: m.refs as Prisma.InputJsonObject,
          actions: m.actions as Prisma.InputJsonArray,
        },
      });
    }
  }
  return kept;
}

// Every open heads-up that no longer holds, put away: when the chat opens and Jane's daily run
// (closeSettled), so the chat's own list agrees with the dock. How many.
export async function putAwayUntrue(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const open = (
    await scopedFor(userId, client).janeMessages.findMany({
      where: { status: "open", kind: "heads_up" },
      select: MESSAGE_SELECT,
    })
  ).map(toChatMessage);
  const facts = await factsFor(userId, open, client, now);
  if (!facts) return 0;
  return putAway(
    userId,
    open.filter((m) => !asNow(m, facts)),
    client,
    now,
  );
}
