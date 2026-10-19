import type { Topic } from "./context";
import type { Intent } from "./intents";
import type { PreferenceDraft } from "./preferences";

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
  // Insurance (spec Phase X).
  "insurance.gap_no",
  "insurance.quotes",
  "insurance.shop_yes",
  "insurance.shop_no",
  "insurance.checkup_seen",
  "insurance.claim_start",
  "insurance.claim_step",
  "insurance.claim_close",
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
  // Spec step 88: a clarifying question's answers, one per meaning (refs.choices).
  "clarify.1",
  "clarify.2",
  "clarify.3",
  // Spec step 90: a budget the answer named, and the quick replies on a finding.
  "budget.set",
  "finding.why",
  "finding.options",
  // Spec step 91: saving what the person told Jane, and a suggestion never to make again.
  "pref.save",
  "suggest.never",
  // Spec step 92: a Yes each on a message bundling findings of one kind (refs.items).
  "bundle.1",
  "bundle.2",
  "bundle.3",
  "bundle.4",
  "bundle.5",
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
  // Spec step 119: tax tags and forms.
  "tax.tag_yes",
  "tax.tag_no",
  "tax.tag_set",
  "tax.form_got",
  // Spec step 121: a new W-4, walked through in the chat.
  "tax.w4_start",
  "tax.w4_next",
  "tax.w4_sent",
  "tax.w4_stop",
  "tax.w4_keep",
  // Spec step 122: a way to pay less, as a reminder to set or not for me.
  "tax.save_task",
  "tax.save_no",
  // Spec step 123: freelancers.
  "tax.quarter_paid",
  "tax.miles_add",
  // Spec step 125: a tax refund's plan.
  "tax.refund_apply",
  "tax.refund_no",
  // Spec step 126: start the return with the filing partner (signing is on the page).
  "tax.file_start",
  // Investments (spec step 129 on): the answer buttons on an investor-profile question,
  // by position (src/config/investing.ts PROFILE_QUESTIONS).
  "invest.answer.1",
  "invest.answer.2",
  "invest.answer.3",
  "invest.answer.4",
  "invest.answer.5",
  // Spec step 133: move to the recommended mix, through the brokerage partner.
  "invest.rebalance",
  // Spec step 134: automatic investing.
  "invest.auto_start",
  "invest.auto_leftover",
  "invest.auto_pause",
  "invest.auto_resume",
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
  // Insurance found from payments (spec step 99).
  "policy.confirm",
  "policy.not_insurance",
  // What Jane saved you (spec step 139).
  "saved.share",
  // Help inside the chat (spec step 140).
  "welcome.tour",
  // One autopilot, every sector (spec step 141).
  "autopilot.sector_set",
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export type MessageAction =
  // quick (spec step 90): a quick reply under an answer ("Why?", "Show options"), which
  // answers in the chat and leaves the message's own buttons as they are.
  | { id: ActionId; label: string; kind: "primary" | "secondary" | "quick" }
  | { id: "open"; label: string; kind: "link"; href: string };

// What a message is about. Every field is optional; each source and action uses its own.
export type MessageRefs = {
  findingId?: string;
  // Spec step 110: the extra a month the payoff plan's buttons start it with, in cents.
  debtPlanExtraCents?: number;
  // Spec step 112: the refinance offer "Apply" prepares, and the application it made.
  refinance?: { debtKey: string; lender: string };
  applicationId?: string;
  // Insurance (spec Phase X): a coverage gap by its key (GAP_KEYS), and the policy a
  // message is about.
  insuranceGap?: string;
  policyId?: string;
  // Spec step 104: a reshop of a policy (src/lib/insurance/shop.ts), by id.
  insuranceShopId?: string;
  // Spec step 106: a coverage checkup, by id.
  insuranceCheckupId?: string;
  // Spec step 107: a claim to start (what happened, on which policy) and one being tracked,
  // with the step its Done button marks.
  claim?: { kind: string; event: string; policyId: string | null };
  claimId?: string;
  claimStep?: string;
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
  // Spec step 88: what a reply was about, for a follow-up ("and Hulu?", "cancel it").
  topic?: Topic;
  // Spec step 88: a clarifying question's meanings, in button order (clarify.1, clarify.2…).
  choices?: { label: string; intent: Intent }[];
  // Spec step 90: the budget "Set a budget" would set (cents a month).
  budget?: { category: string; amountCents: number };
  // Spec step 91: what "Remember this" would save.
  preference?: PreferenceDraft;
  // Spec step 92: the messages a bundle stands for, by dedupeKey, in button order.
  items?: { dedupeKey: string; label: string }[];
  // Taxes (spec step 118): the tax profile question a message is asking, and the kind of
  // income "Add it" would add.
  taxField?: string;
  incomeKind?: string;
  // The state "Yes, set it" would put on the tax profile (two letters).
  taxState?: string;
  // Spec step 119: a merchant's tax tag to keep or set (a TAX_TAGS key, or "none"), and a tax
  // form to tick off.
  merchantKey?: string;
  taxTag?: string;
  taxForm?: string;
  taxYear?: number;
  // Spec step 121: the W-4 change a message walks through (step "4b" or "4c", the amount
  // in cents, what to put from January) and which of its three steps it's on.
  w4Step?: string;
  w4AmountCents?: number;
  w4JanuaryCents?: number;
  w4Flow?: number;
  // Spec step 122: the way to pay less a message is about, and the reminder it would set.
  taxSaving?: string;
  taxTask?: { title: string; dueOn: string; note: string };
  // Spec step 123: the estimated payment "I've paid it" records, and miles to add.
  taxQuarter?: { date: string; cents: number; stateCents: number };
  taxMiles?: number;
  // Spec step 125: the refund (its transaction id) a message is about.
  taxRefund?: string;
  // Spec step 98: demo advice (src/lib/advice-mode.ts). The chat shows DEMO_ADVICE_LABEL
  // under it. Set it on every message that recommends investments, taxes, insurance or loans.
  advice?: true;
  // Spec step 129: the investor-profile question the answer buttons answer, and whether
  // Jane is going through all four again (the yearly check).
  investQuestion?: string;
  investAgain?: true;
  // Spec step 133: the rebalancing plan the button places, by its key.
  rebalanceKey?: string;
  // Spec step 134: what "Start" sets up: an amount (cents) every payday, into an account.
  autoInvest?: { amountCents: number; accountId: string };
  // Spec step 97: a change Jane noticed (src/insights/changes.ts), by its key; for a
  // category's pace, the budget "Set a budget" would set (cents a month).
  change?: { key: string; kind: string; category?: string; budgetCents?: number };
  // Spec step 100: the life event (moving, new_job, new_baby) Yes would start.
  lifeKind?: string;
  // Spec step 101: a budget tune-up's month (YYYY-MM), and a transfer to count toward a goal.
  tuneUpMonth?: string;
  transactionId?: string;
  // Spec step 141: a sector's autopilot change typed in the chat, set on "Set it".
  sectorChange?: {
    sector: string;
    level: string;
    actionCapCents?: number;
    monthlyCapCents?: number;
  };
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
  // Spec step 92: how it goes into one message with others like it (findings of a kind).
  bundle?: { group: string; name: string; line: string; cents: number | null };
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
      (a.kind === "primary" || a.kind === "secondary" || a.kind === "quick") &&
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
