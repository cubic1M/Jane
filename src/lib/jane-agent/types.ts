// Jane's chat messages (spec step 81): what a message is, what it's about and its buttons.
// Stored in jane_messages; posted by Jane's brain (spec step 82) and, from step 84, typed
// by the person.

import { DEBT_ACTION_IDS } from "./debt-action-ids";

export const MESSAGE_KINDS = ["brief", "decision", "done", "heads_up", "reply", "user"] as const;
// brief: the morning brief. decision: something to say yes or no to. done: something Jane
// did. heads_up: something coming or gone wrong. reply: Jane's answer to what the person
// typed (step 84). user: what the person typed (step 84).
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MESSAGE_STATUSES = ["open", "answered", "dismissed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

// Every button that does something, by id. Each is one handler in
// src/lib/jane-agent/actions (the registry there); "open" is a plain link.
export const ACTION_IDS = [
  "finding.yes",
  // Loans and debt (spec Phase Y, ./debt-action-ids.ts).
  ...DEBT_ACTION_IDS,
  "finding.no",
  "finding.pick",
  "plan.approve_safe",
  "undo.rule",
  "undo.no",
  // Spec step 83: the rest of Jane from the chat.
  "autopilot.safe",
  "autopilot.all",
  "autopilot.ask",
  "setup.yes",
  "setup.no",
  "setup.all",
  "offer.accept",
  "offer.decline",
  "cancel.done",
  "deadline.done",
  "alert.got_it",
  "snooze",
  // Typing to Jane (spec step 84).
  "goal.start",
  "autopilot.pause",
  // Taxes (spec step 118): the tax profile, one question at a time.
  "tax.found_yes",
  "tax.filing_single",
  "tax.filing_joint",
  "tax.filing_separate",
  "tax.filing_head",
  "tax.kids_0",
  "tax.kids_1",
  "tax.kids_2",
  "tax.kids_3",
  "tax.income_add",
  "tax.income_no",
  "tax.state_set",
  // Investments (spec step 129 on): the answer buttons on an investor-profile question,
  // by position (src/config/investing.ts PROFILE_QUESTIONS).
  "invest.answer.1",
  "invest.answer.2",
  "invest.answer.3",
  "invest.answer.4",
  "invest.answer.5",
  // Jane notices changes (spec step 97).
  "change.look",
  "change.budget",
  "change.expected",
  // Life events spotted (spec step 100).
  "life.yes",
  "life.no",
  "life.never",
  // Plans that keep up (spec step 101).
  "tuneup.accept",
  "tuneup.keep",
  "tuneup.undo",
  "transfer.count",
  "transfer.skip",
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export type MessageAction =
  | { id: ActionId; label: string; kind: "primary" | "secondary" }
  | { id: "open"; label: string; kind: "link"; href: string };

// What a message is about. Every field is optional; each source and action uses its own.
export type MessageRefs = {
  findingId?: string;
  // Spec step 110: the extra a month the payoff plan's buttons start it with, in cents.
  debtPlanExtraCents?: number;
  // The finding as Jane described it (src/lib/jane-agent/fingerprint.ts): a button only
  // acts while the finding is still what the message said.
  fingerprint?: string;
  // Jane's pick, for the "Switch to …" button (spec step 76).
  pickOptionId?: string;
  actionId?: string;
  decisionId?: string;
  alertId?: string;
  deadlineKey?: string;
  goalId?: string;
  weekStart?: string;
  // Until when "Undo" works (ISO time); the button is hidden after it.
  undoUntil?: string;
  // The buttons to bring back when an answer is undone.
  previousActions?: MessageAction[];
  // A line under the answer: what happened when the button was tapped.
  note?: string;
  // Spec step 83: a set-up suggestion (src/lib/proposals.ts), by its key.
  proposalKey?: string;
  // Spec step 83: the step only the person can do on an action (./agent-steps.ts).
  step?: string;
  // Spec step 83: a deadline the person typed in (src/lib/deadlines.ts), to mark done.
  deadlineEntryId?: string;
  // The goal "Start a goal for it" would add (spec step 84): money in cents, date
  // YYYY-MM-DD.
  goal?: { name: string; targetCents: number; targetDate: string };
  // Taxes (spec step 118): the tax profile question a message is asking, and the kind of
  // income "Add it" would add.
  taxField?: string;
  incomeKind?: string;
  // The state "Yes, set it" would put on the tax profile (two letters).
  taxState?: string;
  // Spec step 98: demo advice (src/lib/advice-mode.ts). The chat shows DEMO_ADVICE_LABEL
  // under it. Set it on every message that recommends investments, taxes, insurance or loans.
  advice?: true;
  // Spec step 129: the investor-profile question the answer buttons answer, and whether
  // Jane is going through all four again (the yearly check).
  investQuestion?: string;
  investAgain?: true;
  // Spec step 97: a change Jane noticed (src/insights/changes.ts), by its key; for a
  // category's pace, the budget "Set a budget" would set (cents a month).
  change?: { key: string; kind: string; category?: string; budgetCents?: number };
  // Spec step 100: the life event (moving, new_job, new_baby) Yes would start.
  lifeKind?: string;
  // Spec step 101: a budget tune-up's month (YYYY-MM), and a transfer to count toward a goal.
  tuneUpMonth?: string;
  transactionId?: string;
};

// A message the brain wants to post.
export type Candidate = {
  kind: MessageKind;
  body: string;
  refs: MessageRefs;
  actions: MessageAction[];
  // Never posted twice for the same person (jane_messages has a unique index on it).
  dedupeKey: string;
  priority: number;
};

// A stored message, as the chat and the button actions read it.
export type ChatMessage = {
  id: string;
  kind: MessageKind;
  body: string;
  refs: MessageRefs;
  actions: MessageAction[];
  status: MessageStatus;
  answeredWith: string | null;
  answeredAt: Date | null;
  createdAt: Date;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Reads the JSON columns back, dropping anything malformed.
export function parseRefs(value: unknown): MessageRefs {
  return isObject(value) ? (value as MessageRefs) : {};
}

export function parseActions(value: unknown): MessageAction[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is MessageAction => {
    if (!isObject(a) || typeof a.label !== "string") return false;
    if (a.kind === "link") return a.id === "open" && typeof a.href === "string";
    return (
      (a.kind === "primary" || a.kind === "secondary") &&
      (ACTION_IDS as readonly unknown[]).includes(a.id)
    );
  });
}

export function toChatMessage(row: {
  id: string;
  kind: string;
  body: string;
  refs: unknown;
  actions: unknown;
  status: string;
  answeredWith: string | null;
  answeredAt: Date | null;
  createdAt: Date;
}): ChatMessage {
  return {
    id: row.id,
    kind: (MESSAGE_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as MessageKind)
      : "heads_up",
    body: row.body,
    refs: parseRefs(row.refs),
    actions: parseActions(row.actions),
    status: (MESSAGE_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as MessageStatus)
      : "dismissed",
    answeredWith: row.answeredWith,
    answeredAt: row.answeredAt,
    createdAt: row.createdAt,
  };
}

export const MESSAGE_SELECT = {
  id: true,
  kind: true,
  body: true,
  refs: true,
  actions: true,
  status: true,
  answeredWith: true,
  answeredAt: true,
  createdAt: true,
} as const;
