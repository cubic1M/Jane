import type { DecisionIntent } from "./decision-intents";
import { PRONOUNS, type ActVerb, type Intent } from "./intents";

// What the conversation is about (spec step 88): the last finding, merchant, category or
// month Jane answered about, kept on her reply (refs.topic). A follow-up ("and Hulu?",
// "what about last month?", "cancel it") is read against it. Only the last reply counts,
// only within CHAT_CONTEXT_MINUTES and on the same day (src/lib/jane-agent/typing.ts), so
// "it" never points at something from another day. Pure.

export type Topic = {
  // The intent the reply answered.
  kind: string;
  verb?: ActVerb;
  // A merchant or what the person called it ("Netflix", "phone").
  target?: string;
  findingId?: string;
  month?: string;
  category?: string;
};

export const isPronoun = (target: string) => PRONOUNS.includes(target.trim());

// The intent with the conversation filled in; "which" when it points back at something
// there's nothing to point back to.
export function withTopic(
  intent: Intent,
  topic: Topic | null,
  asOf: string,
): Intent | { kind: "which" } {
  // "Should I buy?" on its own is about the decision just discussed, never an old button.
  if (intent.kind === "decision" && intent.item === null && topic?.kind === "decision") {
    return {
      ...intent,
      item: (topic.category as DecisionIntent["item"]) ?? null,
      label: topic.target ?? null,
    };
  }
  if (intent.kind === "follow_up") {
    if (!topic)
      return intent.target ? { kind: "about", target: intent.target } : { kind: "unknown" };
    if (intent.month) {
      const subject = topic.category ?? topic.target ?? null;
      return ["spending", "cost", "about"].includes(topic.kind)
        ? { kind: "spending", category: subject, month: intent.month }
        : { kind: "unknown" };
    }
    const target = intent.target ?? "";
    // "Why?" after a decision is that decision again, with the reasoning.
    if ((!target || isPronoun(target)) && topic.kind === "decision") {
      return {
        kind: "decision",
        item: (topic.category as DecisionIntent["item"]) ?? null,
        label: topic.target ?? null,
      };
    }
    if (!target || isPronoun(target))
      return withTopic({ kind: "about", target: "it" }, topic, asOf);
    switch (topic.kind) {
      case "act":
        return { kind: "act", verb: topic.verb ?? "cancel", target };
      case "cost":
        return { kind: "cost", target, year: false };
      case "spending":
        return {
          kind: "spending",
          category: target,
          month: topic.month ?? asOf.slice(0, 7),
        };
      default:
        return { kind: "about", target };
    }
  }
  if (
    (intent.kind === "act" || intent.kind === "cost" || intent.kind === "about") &&
    isPronoun(intent.target)
  ) {
    if (!topic || (!topic.target && !topic.findingId)) return { kind: "which" };
    const target = topic.target ?? "";
    const findingId = topic.findingId;
    if (intent.kind === "act") return { ...intent, target, ...(findingId ? { findingId } : {}) };
    if (intent.kind === "cost") return { ...intent, target };
    return { kind: "about", target, ...(findingId ? { findingId } : {}) };
  }
  return intent;
}

// What a reply to this intent is about, for the next message.
export function topicOf(intent: Intent): Topic | null {
  switch (intent.kind) {
    case "act":
      return {
        kind: "act",
        verb: intent.verb,
        target: intent.target,
        ...(intent.findingId ? { findingId: intent.findingId } : {}),
      };
    case "cost":
    case "about":
      return { kind: intent.kind, target: intent.target };
    case "spending":
      return {
        kind: "spending",
        month: intent.month,
        ...(intent.category ? { category: intent.category } : {}),
      };
    default:
      return null;
  }
}
