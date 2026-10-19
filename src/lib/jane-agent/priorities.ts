import {
  FINDING_MINUTES,
  MINUTES,
  TASK_URGENCY,
  URGENCY_HORIZON_DAYS,
  URGENT_FINDING_URGENCY,
} from "@/config/priorities";
import { isRefund } from "@/lib/savings-text";
import { rankPriorities, type PriorityItem, type Ranked } from "@/planning/priorities";
import type { Snapshot } from "./snapshot";

// The next best thing to do (spec step 143), from what Jane's brain already looks at: the
// plan's findings, Jane's insurance picks and refinance offers, the steps only the person
// can do, and dated deadlines. Pure: the snapshot in, one ranked list out.

const DAY_MS = 86_400_000;
const within = (date: string, asOf: string) =>
  Date.parse(`${date}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`) <=
  URGENCY_HORIZON_DAYS * DAY_MS;
// Deadlines that are something to do (a renewal is only a date to know).
const DOING = new Set(["payment", "trial", "return", "fsa", "card_benefit", "warranty", "other"]);

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
      confidence: f.confidence ?? "medium",
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
  return items;
}

export function rankedFor(snapshot: Snapshot): Ranked[] {
  return rankPriorities(priorityItems(snapshot), snapshot.asOf);
}
