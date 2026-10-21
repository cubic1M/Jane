import {
  STRATEGIST_BODY_MAX,
  STRATEGIST_CAPABILITY,
  STRATEGIST_MAX_PARTS,
  STRATEGIST_MIN_PARTS,
  STRATEGIST_TITLE_MAX,
  STRATEGIST_TOPIC,
} from "@/config/strategist";
import { URGENCY_WEIGHT, rankValue } from "@/config/suggestions";
import type { Suggestion } from "@/detectors/contract";
import { ideaShortForms } from "@/detectors/helpers";
import { checkGuardrails, type GuardrailProfile } from "@/lib/guardrails";

// Vetting what Claude proposes as strategist (spec step 256). Pure. An idea is a title, an
// explanation and the suggestions (by id) it combines. It joins the ranking only if it rests
// on at least two real suggestions, every dollar figure in its words came from a tool
// result, its words pass the guardrails, and it ends in the buttons of the suggestions it
// rests on (registered pages and actions, nothing Claude made up). Its confidence is never
// Claude's: it is the weakest of the suggestions it combines.

export type RawIdea = { title?: unknown; body?: unknown; based_on?: unknown };
export type Vetted = { ok: true; idea: Suggestion } | { ok: false; reason: string };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function ideaId(parts: readonly string[]): string {
  return `${STRATEGIST_CAPABILITY}:${[...parts].sort().join("+")}`;
}

export function vetIdea(
  raw: RawIdea,
  {
    current,
    allowedCents,
    profile,
  }: {
    // Every suggestion the detectors have for this person tonight, by id.
    current: ReadonlyMap<string, Suggestion>;
    // Every dollar figure a tool gave Claude in this run.
    allowedCents: readonly number[];
    profile: GuardrailProfile;
  },
): Vetted {
  const title = str(raw.title);
  const body = str(raw.body);
  if (!title || !body) return { ok: false, reason: "An idea needs a title and an explanation." };
  if (title.length > STRATEGIST_TITLE_MAX || body.length > STRATEGIST_BODY_MAX) {
    return { ok: false, reason: "That is too long; keep the title and explanation short." };
  }
  const ids = Array.isArray(raw.based_on) ? raw.based_on.map(str).filter(Boolean) : [];
  const parts = [...new Set(ids)];
  if (parts.length < STRATEGIST_MIN_PARTS || parts.length > STRATEGIST_MAX_PARTS) {
    return {
      ok: false,
      reason: `An idea combines ${STRATEGIST_MIN_PARTS} to ${STRATEGIST_MAX_PARTS} suggestions from suggestions_now.`,
    };
  }
  const found = parts.map((id) => current.get(id));
  if (found.some((p) => !p)) {
    return { ok: false, reason: "based_on must be keys exactly as suggestions_now gave them." };
  }
  const have = found as Suggestion[];
  const check = checkGuardrails(`${title} ${body}`, allowedCents, undefined, profile);
  if (!check.ok) {
    return {
      ok: false,
      reason: `That can't be shown: ${check.issues.join(", ")}. Use only dollar figures from tool results, and promise nothing.`,
    };
  }
  // Worth: what the pieces add up to. Risk avoided is counted only when nothing else is.
  const money = have.filter((p) => p.worthKind !== "risk");
  const counted = money.length > 0 ? money : have;
  const weakest = have.reduce((a, b) => (b.confidence.percent < a.confidence.percent ? b : a));
  const urgent = have.reduce((a, b) =>
    URGENCY_WEIGHT[b.urgency] > URGENCY_WEIGHT[a.urgency] ? b : a,
  );
  const worthKind =
    money.length > 0 ? (money.every((p) => p.worthKind === "earns") ? "earns" : "saves") : "risk";
  const buttons = have.map((p) => p.action);
  return {
    ok: true,
    idea: {
      id: ideaId(parts),
      capability: STRATEGIST_CAPABILITY,
      topic: STRATEGIST_TOPIC,
      title,
      ...ideaShortForms(title, body),
      worthCents: counted.reduce((s, p) => s + p.worthCents, 0),
      worthKind,
      confidence: {
        percent: weakest.confidence.percent,
        reason: `the weakest part of this idea: ${weakest.confidence.reason}`,
      },
      urgency: urgent.urgency,
      why: body,
      action: buttons[0],
      more: buttons.slice(1),
      parts,
      rankCents: have.reduce((s, p) => s + rankValue(p.topic, p.worthKind, p.worthCents), 0),
    },
  };
}
