import type { AnswerBlock } from "./blocks";
import type { Topic } from "./context";
import type { FlowState } from "./flows/engine";
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
  // Spec step 150: benefits through work.
  "benefits.confirm_all",
  "benefits.life_1x",
  "benefits.life_2x",
  "benefits.life_none",
  "benefits.disability_yes",
  "benefits.disability_none",
  "benefits.unsure",
  // Spec step 151: a policy read from a document, to confirm.
  "reading.confirm",
  "reading.dismiss",
  // Spec step 153: life insurance, sized and applied for.
  "lifecover.dependants_0",
  "lifecover.dependants_1",
  "lifecover.dependants_2",
  "lifecover.dependants_3",
  "lifecover.apply",
  "lifecover.yes",
  "lifecover.no",
  "lifecover.submit",
  "lifecover.buy",
  "lifecover.dismiss",
  // Spec step 154: cover changes after a life event.
  "cover.apply",
  "cover.dismiss",
  // Spec step 155: renewal negotiation and claims, done by Jane.
  "renewal.call",
  "renewal.no",
  "claim.file",
  // Spec step 196: paying less for the same cover.
  "saving.apply_all",
  "saving.apply",
  "saving.no",
  // Spec step 197: risks seen in how they live, and sample prices for the gap a yes opens.
  "risk.yes",
  "risk.no",
  "insurance.gap_quotes",
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
  // Spec step 185: a plan of several steps, confirmed once; undo its transfers.
  "multi.confirm",
  "multi.cancel",
  "multi.undo",
  // Spec step 95: a guided flow's answers, Back and Cancel (refs.flow).
  "flow.pick.1",
  "flow.pick.2",
  "flow.pick.3",
  "flow.pick.4",
  "flow.pick.5",
  "flow.back",
  "flow.cancel",
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
  // Spec step 165: a move (spotted, or typed), an out-of-state employer, and the city
  // income tax question (its places by position).
  "tax.move_yes",
  "tax.move_no",
  "tax.move_set",
  "tax.work_set",
  "tax.local_1",
  "tax.local_2",
  "tax.local_no",
  // Spec step 166: a collected form that doesn't match (use it, or ask the payer), a form
  // still missing, and ticking off the collected ones.
  "tax.doc_right",
  "tax.doc_ask",
  "tax.doc_chase",
  "tax.docs_tick",
  // Spec step 167: a tax move's reminder on the deadlines, or not for me.
  "tax.plan_add",
  "tax.plan_no",
  // Spec step 168: a gift's receipt, a donor-advised fund, and not this year.
  "tax.receipt_got",
  "tax.fund_open",
  "tax.giving_no",
  // Spec step 171: a reminder before a year's records can be thrown away.
  "tax.records_remind",
  // Spec step 172: confirm a return Jane read, say it isn't one, prepare an amended return.
  "tax.prior_confirm",
  "tax.prior_no",
  "tax.amend_prepare",
  // Spec step 173: hobby or business.
  "tax.side_business",
  "tax.side_hobby",
  // Spec step 217: a tax notice read from an upload, its response drafted and handed over.
  "tax.notice_confirm",
  "tax.notice_no",
  "tax.notice_agree",
  "tax.notice_pay",
  "tax.notice_dispute",
  "tax.notice_team",
  "tax.notice_mine",
  // Spec step 218: the IP PIN, and the steps after a sign of tax identity theft.
  "tax.ippin_remind",
  "tax.ippin_have",
  "tax.identity_open",
  "tax.identity_not",
  "tax.identity_step",
  // Spec step 219: a goal for the tax crypto and equity pay will bring.
  "tax.equity_aside",
  // Spec step 220: put a multi-year tax move on the person's deadlines.
  "tax.years_plan",
  // Spec step 221: property tax: draft an appeal, say who files it, an exemption.
  "tax.property_draft",
  "tax.property_remind",
  "tax.property_team",
  "tax.property_self",
  "tax.property_drop",
  "tax.exemption_remind",
  "tax.exemption_claimed",
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
  // Spec step 158: start saving for college.
  "college.start",
  // Spec step 159: the HSA.
  "hsa.link",
  "hsa.invest",
  // Spec step 160: company stock, sold down in parts.
  "company.link",
  "company.sell",
  // Spec step 161: connect a demo exchange, read-only (crypto is never traded).
  "crypto.link",
  // Spec step 162: cash moved where it earns more, one move a tap.
  "cash.to_savings",
  "cash.to_money_market",
  // Spec step 210: raise the contribution for the match, or put money in an IRA.
  "retire.match",
  "retire.ira",
  // Spec step 211: the question about a past employer's 401(k), and the rollover.
  "oldplan.yes",
  "oldplan.no",
  "oldplan.rollover",
  // Spec step 213: a gift link for a child's college fund, and money into their Roth IRA.
  "family.gift_link",
  "family.child_roth",
  // Spec step 215: whether a premium found in the payments is whole life.
  "costly.yes",
  "costly.no",
  // Spec step 216: harvest the losses the yearly review showed.
  "review.harvest",
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
  // Money that moves itself (spec step 144).
  "paycheck.move",
  "paycheck.skip",
  "paycheck.undo",
  "bill.pay",
  "bill.skip",
  "attention.resume",
  "whatif.adopt",
  "lean.start",
  "lean.not_now",
  "unusual.me",
  "unusual.not_me",
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
  // Spec step 113: the 0% offer a transfer was made to, and the transfer Jane tracks.
  transfer?: { debtKey: string; offerId: string };
  transferId?: string;
  // Spec step 174: the card "Apply" applies for.
  creditCard?: { productId: string };
  // Spec step 175: the statement "Pay it before the statement" pays toward, and the
  // credit-builder stand-in to open.
  creditStatement?: { accountId: string; closesOn: string };
  creditBuilder?: { productId: string };
  // Spec step 176: the buy now, pay later plan "Pay it off" pays.
  bnplPlan?: { key: string };
  // Spec step 177: the request "Send" sends when money is tight.
  tightItem?: { id: string };
  // Spec step 179: the home price the down payment goal is sized for.
  homeGoal?: { priceCents: number };
  // Spec step 180: the request "Send" sends about a medical bill.
  medicalItem?: { id: string };
  // Spec step 181: the letter "Send" sends about a collection or a credit report error.
  creditFix?: { id: string };
  // Spec step 224: the card whose lower rate "Ask" asks for.
  cardRate?: { id: string };
  // Spec step 226: the payment-app transfer asked about ("tx:<id>").
  familyLoan?: { id: string };
  // Spec step 227: the plan "Start" saves, and the goal "I've done this month's list" ticks.
  creditGoalDraft?: { kind: string; targetScore: number; targetDate: string };
  creditGoalId?: string;
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
  // Spec step 150: the guided question a benefits message asks.
  benefitQuestion?: string;
  // Spec step 151: the policy reading a message asks the person to confirm.
  readingId?: string;
  // Spec step 153: the life application a message moves along.
  lifeApplicationId?: string;
  // Spec step 154: the life event ("event|key") whose cover changes a message asks about.
  coverEvent?: string;
  // Spec step 155: the renewal negotiation a message asks about.
  negotiationId?: string;
  // Spec step 196: "same" for the savings that keep the cover, or one saving's id.
  savingGroup?: string;
  savingId?: string;
  // Spec step 197: the risk a question asks about.
  riskId?: string;
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
  // Spec step 92: the messages a bundle stands for, by dedupeKey, in button order. Spec
  // step 184: the morning agenda's too, each with the button its Yes stands for (a finding's
  // Yes when left out).
  items?: { dedupeKey: string; label: string; action?: ActionId }[];
  // Spec step 185: a plan's steps, and once confirmed what happened to each.
  multi?: { steps: MultiStep[]; results?: MultiResult[] };
  // Spec step 94: a chart, table, timeline or progress bars shown with the answer.
  block?: AnswerBlock;
  // Spec step 95: where a guided flow is.
  flow?: FlowState;
  // Spec step 96: pinned to the top of the chat.
  pinned?: true;
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
  // Spec step 165: the move "Yes" saves, the employer's state "Yes" saves (with taxState
  // for the home state), and the city income taxes (LOCAL_TAXES keys) in button order.
  taxMove?: { date: string; from: string; to: string };
  taxWorkState?: string;
  taxLocals?: string[];
  // Spec step 167: the tax plan move ("<year>:<key>") a message is about.
  taxPlanMove?: string;
  // Spec step 168: the gift (its transaction id) a receipt message is about.
  taxGift?: string;
  // Spec step 172: the return read from a document (its id) a message is about.
  priorReturn?: string;
  // Spec step 217: the tax notice (its id) a message is about.
  taxNotice?: string;
  // Spec step 220: the multi-year tax move (its key) a message is about.
  yearsMove?: string;
  // Spec step 221: the property tax exemption (its key) a message is about.
  propertyExemption?: string;
  // Spec step 218: the sign of identity theft (and where Jane learned of it), and the step a
  // message is about.
  identitySign?: string;
  identitySource?: string;
  identityStep?: string;
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
  // Spec step 158: the college plan "Start saving for college" sets up.
  college?: { childName: string; childAge: number; type: "public" | "private" };
  // Spec step 160: the company stock plan "Sell this part" sells from, by its key.
  companyPlan?: string;
  // Spec step 162: the cash plan its move buttons belong to, by its key.
  cashPlan?: string;
  // Spec step 163: the pause before a sell has been shown; the next tap sells.
  paused?: true;
  // Spec step 210: the IRA amount (cents) the button puts in.
  iraCents?: number;
  // Spec step 211: the old plan a question or rollover button is about.
  oldPlanId?: string;
  // Spec step 213: the child (and amount, cents) a button is about.
  familyChild?: string;
  familyPlan?: string;
  // Spec step 215: the product a question is about.
  productId?: string;
  // Spec step 216: the harvesting list the yearly review showed, by its key.
  harvestKey?: string;
  // Spec step 97: a change Jane noticed (src/insights/changes.ts), by its key; for a
  // category's pace, the budget "Set a budget" would set (cents a month).
  change?: { key: string; kind: string; category?: string; budgetCents?: number };
  // Spec step 100: the life event (moving, new_job, new_baby) Yes would start.
  lifeKind?: string;
  // Spec step 101: a budget tune-up's month (YYYY-MM), and a transfer to count toward a goal.
  tuneUpMonth?: string;
  transactionId?: string;
  // Spec step 144: a paycheck's plan.
  paycheckPlanId?: string;
  // Spec step 145: a bill to pay, by its plan key (bill:<accountId>:<due date>).
  billKey?: string;
  // Spec step 147: a kind of message Jane stopped bringing up, by its source.
  attentionSource?: string;
  // Spec step 203: the what-if a message offers to adopt.
  // Spec step 204: the lean-plan question.
  leanId?: string;
  whatIf?: { scenario: string; months: number; extraMonthlyCents: number };
  // Spec step 141: a sector's autopilot change typed in the chat, set on "Set it".
  sectorChange?: {
    sector: string;
    level: string;
    actionCapCents?: number;
    monthlyCapCents?: number;
  };
};

// A message the brain wants to post.
// Spec step 185: one step of a plan. "chat" is what a feature's own answer offered (its
// Yes, run on its own message); "transfer" is money into a goal through the partner.
export type MultiStep =
  | {
      kind: "chat";
      label: string;
      action: ActionId;
      actionLabel: string;
      body: string;
      refs: MessageRefs;
      actions: MessageAction[];
    }
  | {
      kind: "transfer";
      label: string;
      goalId: string;
      goalName: string;
      fromAccountId: string;
      toAccountId: string | null;
      amountCents: number;
    };
// What happened to each step once confirmed, in order.
export type MultiResult = {
  status: "done" | "failed" | "not_done";
  note: string;
  transferId?: string;
};

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
