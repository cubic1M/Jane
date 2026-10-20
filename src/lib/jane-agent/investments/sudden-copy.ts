import { SUDDEN_KINDS, type SuddenKind } from "@/config/sudden-money";
import type { SuddenView } from "@/lib/investments/sudden-money";
import { formatCents } from "@/lib/money";
import type { ActionId, MessageAction } from "../types";

// Sudden money in the chat (spec step 235): the one question, then the plan a stage at a
// time in the same message. Every stage is a tap.

export const SUDDEN_LINK: MessageAction = {
  id: "open",
  label: "See the whole plan",
  kind: "link",
  href: "/investments/sudden-money",
};

export const KIND_ACTIONS: Record<SuddenKind | "transfer", ActionId> = {
  bonus: "sudden.bonus",
  inheritance: "sudden.inheritance",
  home_sale: "sudden.home_sale",
  other_sale: "sudden.other_sale",
  gift: "sudden.gift",
  transfer: "sudden.transfer",
};
export const ACTION_KIND = Object.fromEntries(
  Object.entries(KIND_ACTIONS).map(([k, v]) => [v, k]),
) as Record<string, SuddenKind | "transfer">;

export const suddenQuestionLine = (i: Pick<SuddenView, "amountCents" | "depositedOn">) =>
  `${formatCents(i.amountCents)} came into your account on ${i.depositedOn}, and it doesn't look like pay. What was it? I'll work out the tax to set aside first and a plan for the rest.`;

export const suddenQuestionButtons = (): MessageAction[] => [
  ...(Object.keys(SUDDEN_KINDS) as SuddenKind[]).map((k, n): MessageAction => ({
    id: KIND_ACTIONS[k],
    label: SUDDEN_KINDS[k].replace(/ \(.*\)$/, ""),
    kind: n === 0 ? "primary" : "secondary",
  })),
  { id: KIND_ACTIONS.transfer, label: "Just a transfer", kind: "quick" },
];

export function planBody(i: SuddenView): string {
  const done = i.stages.filter((s) => s.done);
  const rest = i.stages.filter((s) => !s.done);
  const lines = i.stages.map(
    (s, n) => `${n + 1}. ${s.title}: ${formatCents(s.cents)}${s.done ? " (done)" : ""}`,
  );
  return `For your ${formatCents(i.amountCents)} ${i.kind ? SUDDEN_KINDS[i.kind].toLowerCase() : ""}, here's an order that works: tax first. ${i.tax ? `${i.tax.note} ` : ""}\n${lines.join("\n")}\n${rest.length === 0 ? "All done." : `Next: ${rest[0].title.toLowerCase()}. Nothing moves until you tap.`}${done.length > 0 ? "" : ""}`;
}

export function stageButton(i: SuddenView): MessageAction | null {
  const next = i.stages.find((s) => !s.done);
  return next
    ? { id: "sudden.stage", label: `${next.title}: ${formatCents(next.cents)}`, kind: "primary" }
    : null;
}
