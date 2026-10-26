import {
  FINDING_MINUTES,
  MINUTES,
  SUGGESTION_CONFIDENCE_FROM,
  TASK_URGENCY,
  URGENCY_HORIZON_DAYS,
  URGENT_FINDING_URGENCY,
} from "@/config/priorities";
import { WORKED_MIN_SAMPLE } from "@/config/worked";
import { isRefund } from "@/lib/savings-text";
import { rankPriorities, type PriorityItem, type Ranked } from "@/planning/priorities";
import type { Snapshot } from "./snapshot";
import { DAY_MS } from "@/lib/dates";

// The next best thing to do (spec step 143), from what Jane's brain already looks at: the
// plan's findings, Jane's insurance picks and refinance offers, the steps only the person
// can do, and dated deadlines. Pure: the snapshot in, one ranked list out.
//
// It is the one ranked list (docs/feature-audit.md, cluster 8): the nightly scan's suggestions
// (spec steps 255 and 265) lead it, in the scan's order, then everything else as step 143 ranks
// it, without repeating a finding a suggestion already points to. The brief's "Start with",
// /jane, the monthly report, the chat and Claude's numbers all read it, so the person is told
// the same first thing everywhere.

const within = (date: string, asOf: string) =>
  Date.parse(`${date}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`) <=
  URGENCY_HORIZON_DAYS * DAY_MS;
// Deadlines that are something to do (a renewal is only a date to know).
const DOING = new Set(["payment", "trial", "return", "fsa", "card_benefit", "warranty", "other"]);

// Spec step 207: a kind of finding the person keeps saying no to, or whose finished actions
// never showed a saving, ranks as uncertain; one that has worked ranks as sure.
export function confidenceFor(
  type: string,
  base: "high" | "medium" | "low",
  worked: Snapshot["worked"],
): "high" | "medium" | "low" {
  const k = worked?.find((w) => w.type === type);
  if (!k) return base;
  if (k.worked > 0) return "high";
  if (k.done >= WORKED_MIN_SAMPLE && k.worked === 0) return "low";
  if (k.no >= WORKED_MIN_SAMPLE && k.yes === 0) return "low";
  return base;
}

export function priorityItems(snapshot: Snapshot): PriorityItem[] {
  const items: PriorityItem[] = [];
  for (const f of snapshot.findings) {
    items.push({
      key: `finding:${f.findingId}`,
      kind: "finding",
      title: f.title,
      valueCents: f.pick?.savingCents ?? f.annualSavingsCents,
      once: !f.pick && isRefund(f.type),
      minutes: FINDING_MINUTES[f.type] ?? MINUTES.tap,
      urgency: f.urgent ? URGENT_FINDING_URGENCY : 0,
      confidence: confidenceFor(f.type, f.confidence ?? "medium", snapshot.worked),
      href: `/report/${f.findingId}`,
      ref: f.findingId,
    });
  }
  const insurance = snapshot.insurance;
  for (const shop of insurance?.shops ?? []) {
    if (!shop.pick || shop.savingCents === null || shop.savingCents <= 0) continue;
    const policy = insurance?.policies.find((p) => p.id === shop.policyId);
    items.push({
      key: `shop:${shop.id}`,
      kind: "offer",
      title: `Switch ${policy ? `your ${policy.carrier} policy` : "your policy"} to ${shop.pick.carrier.name}`,
      valueCents: shop.savingCents,
      minutes: MINUTES.tap,
      dueOn: policy?.nextRenewal ?? null,
      confidence: "high",
      href: "/insurance",
      ref: shop.id,
    });
  }
  for (const c of snapshot.refinance?.comparisons ?? []) {
    if (!c.pick || c.pick.savingCents <= 0) continue;
    const years = Math.max(1, c.termMonths / 12);
    items.push({
      key: `refinance:${c.debtKey}`,
      kind: "offer",
      title: `Refinance ${c.debtName}`,
      valueCents: Math.round(c.pick.savingCents / years),
      minutes: MINUTES.application,
      confidence: "medium",
      href: "/loans",
    });
  }
  for (const step of snapshot.agentSteps) {
    items.push({
      key: `task:${step.actionId}`,
      kind: "task",
      title: step.todo ?? `One step on "${step.title}"`,
      valueCents: null,
      minutes: MINUTES.task,
      urgency: TASK_URGENCY,
      confidence: "high",
      href: "/actions",
    });
  }
  for (const d of snapshot.deadlines) {
    if (!DOING.has(d.kind) || d.date < snapshot.asOf || !within(d.date, snapshot.asOf)) continue;
    items.push({
      key: `deadline:${d.key}`,
      kind: "deadline",
      title: d.title,
      valueCents: null,
      minutes: MINUTES.deadline,
      dueOn: d.date,
      confidence: "high",
      href: d.href ?? "/deadlines",
    });
  }
  // Spec step 203: the changes of a what-if plan the person adopted.
  for (const plan of snapshot.whatIf ?? []) {
    for (const change of plan.changes) {
      items.push({
        key: `plan:${plan.id}:${change.key}`,
        kind: "plan",
        title: change.title,
        valueCents: null,
        minutes: MINUTES.task,
        urgency: TASK_URGENCY,
        confidence: "medium",
        href: `/what-if?s=${plan.scenario}`,
      });
    }
  }
  return items;
}

const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

// The scan's suggestions as the head of the ranked list, in its order.
function suggestionItems(snapshot: Snapshot): Ranked[] {
  return (snapshot.suggestions ?? []).map((s) => ({
    key: `suggestion:${s.key}`,
    kind: "suggestion",
    title: s.title,
    valueCents: s.worthCents,
    risk: s.worthKind === "risk",
    minutes: MINUTES.tap,
    confidence:
      s.confidencePercent >= SUGGESTION_CONFIDENCE_FROM.high
        ? "high"
        : s.confidencePercent >= SUGGESTION_CONFIDENCE_FROM.medium
          ? "medium"
          : "low",
    sure: { percent: s.confidencePercent, reason: s.confidenceReason },
    href: s.actionHref,
    ref: s.key,
    score: 0,
    urgencyScore: 0,
    // Why this person, and how sure Jane is with the reason, as the suggestion's card says it.
    why: `${sentence(s.short)} ${s.confidencePercent}% sure: ${s.confidenceReason}.`,
  }));
}

// The reason in a list of several (the whole picture, the top three): for a suggestion, how sure
// Jane is and why, so a short answer stays short; its card and "Why?" have the rest.
export const listWhy = (r: Ranked) =>
  r.kind === "suggestion" && r.sure ? `${r.sure.percent}% sure: ${r.sure.reason}.` : r.why;

export function rankedFor(snapshot: Snapshot): Ranked[] {
  const scan = suggestionItems(snapshot);
  // A finding a suggestion already opens isn't listed twice.
  const opened = new Set(scan.map((s) => s.href).filter((href) => href.startsWith("/report/")));
  const rest = rankPriorities(
    priorityItems(snapshot).filter((item) => !opened.has(item.href)),
    snapshot.asOf,
  );
  if (scan.length > 0 && rest.length > 0) {
    rest[0] = { ...rest[0], why: rest[0].why.replace(/^First because/, "Because") };
  }
  return [...scan, ...rest];
}
