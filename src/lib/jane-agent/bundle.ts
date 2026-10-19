import { createHash } from "node:crypto";
import { CHAT_BUNDLE_MAX, CHAT_BUNDLE_MIN } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "./types";

// Spec step 92: related suggestions become one message, with a list and a Yes each. Pure.
// Findings of the same kind (three subscriptions to review, two bills to lower) go
// together; each still gets its own row, hidden, so it's never posted again on its own, and
// each Yes works on that row through the finding's own button (./actions/bundle.ts).

type Bundlable = {
  kind: string;
  dedupeKey: string;
  priority: number;
  source: string;
  bundle?: { group: string; name: string; line: string; cents: number | null };
};

const TITLES: Record<string, (n: number) => string> = {
  subscription_review: (n) => `${n} subscriptions you could cancel`,
  duplicate_subscription: (n) => `${n} sets of services that overlap`,
  bill_negotiation: (n) => `${n} bills I could lower`,
  bank_fees: (n) => `${n} accounts with fees I could get back`,
  price_increase: (n) => `${n} prices that went up`,
};

export type Bundle = {
  kind: "decision";
  body: string;
  refs: { items: { dedupeKey: string; label: string }[] };
  actions: MessageAction[];
  dedupeKey: string;
  priority: number;
  source: string;
};

// The groups worth bundling, in candidate order; each at most CHAT_BUNDLE_MAX.
export function bundleGroups<T extends Bundlable>(candidates: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const c of candidates) {
    if (!c.bundle || c.kind !== "decision") continue;
    const key = `${c.source}:${c.bundle.group}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()]
    .filter((g) => g.length >= CHAT_BUNDLE_MIN)
    .map((g) => g.slice(0, CHAT_BUNDLE_MAX));
}

export function bundleOf(items: readonly Bundlable[]): Bundle {
  const [first] = items;
  const group = first.bundle!.group;
  const total = items.reduce((sum, i) => sum + (i.bundle!.cents ?? 0), 0);
  const title = (TITLES[group] ?? ((n: number) => `${n} ways to save`))(items.length);
  const labels = items.map((i) => `Yes: ${i.bundle!.name}`);
  const id = createHash("sha256")
    .update(items.map((i) => i.dedupeKey).join("+"))
    .digest("hex")
    .slice(0, 16);
  return {
    kind: "decision",
    body: [
      `I found ${title}${total > 0 ? `, about ${formatCents(total)} a year in all` : ""}.`,
      ...items.map((i) => `- ${i.bundle!.line}`),
      "Want me to handle any of them?",
    ].join("\n"),
    refs: { items: items.map((i, n) => ({ dedupeKey: i.dedupeKey, label: labels[n] })) },
    actions: [
      ...labels.map((label, n): MessageAction => ({
        id: `bundle.${n + 1}` as MessageAction["id"] & `bundle.${number}`,
        label,
        kind: "primary",
      })),
      { id: "open", label: "Review the plan", kind: "link", href: "/plan" },
    ],
    dedupeKey: `${first.source}:bundle:${id}`,
    priority: Math.max(...items.map((i) => i.priority)),
    source: first.source,
  };
}
