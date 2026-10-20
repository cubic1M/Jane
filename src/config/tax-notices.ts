// Letters from the IRS and the state (spec step 217). FOR REVIEW: the days are the usual
// ones printed on each notice; the notice itself always has the date that applies, and
// Jane uses that when she reads it.
//
// Sources: irs.gov/individuals/understanding-your-cp2000-notice, /understanding-your-cp14-
// notice, /understanding-your-cp501-notice, /understanding-your-cp503-notice,
// /understanding-your-cp504-notice; each state's tax agency (src/config/tax-states.ts).

export type NoticeKind =
  | "ID_VERIFY"
  | "CP2000"
  | "CP14"
  | "CP501"
  | "CP503"
  | "CP504"
  | "STATE_PROPOSED"
  | "STATE_BALANCE"
  | "OTHER";

export const NOTICE_KINDS: Readonly<
  Record<
    NoticeKind,
    {
      title: string;
      issuer: "irs" | "state";
      what: string;
      // Days from the notice date to respond or pay when the notice doesn't say.
      days: number;
      // What the amount on it is.
      amount: "proposed" | "owed" | "none";
      // The responses that make sense.
      responses: readonly ("agree" | "pay" | "dispute")[];
      source: string;
    }
  >
> = {
  CP2000: {
    title: "CP2000: proposed changes to your return",
    issuer: "irs",
    what: "The income a payer reported to the IRS doesn't match your return, and the IRS proposes more tax. It isn't a bill yet: you can agree or disagree.",
    days: 30,
    amount: "proposed",
    responses: ["agree", "dispute"],
    source: "https://www.irs.gov/individuals/understanding-your-cp2000-notice",
  },
  CP14: {
    title: "CP14: you owe money",
    issuer: "irs",
    what: "You have a balance due on a tax return. Paying by the date on it avoids more penalties and interest.",
    days: 21,
    amount: "owed",
    responses: ["pay", "dispute"],
    source: "https://www.irs.gov/individuals/understanding-your-cp14-notice",
  },
  CP501: {
    title: "CP501: reminder, you still owe",
    issuer: "irs",
    what: "A reminder that a balance is still unpaid. Penalties and interest keep adding up until it is.",
    days: 21,
    amount: "owed",
    responses: ["pay", "dispute"],
    source: "https://www.irs.gov/individuals/understanding-your-cp501-notice",
  },
  CP503: {
    title: "CP503: second reminder, you still owe",
    issuer: "irs",
    what: "A second reminder that a balance is unpaid.",
    days: 21,
    amount: "owed",
    responses: ["pay", "dispute"],
    source: "https://www.irs.gov/individuals/understanding-your-cp503-notice",
  },
  CP504: {
    title: "CP504: notice of intent to levy",
    issuer: "irs",
    what: "The IRS intends to take property or money from accounts to pay an unpaid balance. Act before the date on it.",
    days: 30,
    amount: "owed",
    responses: ["pay", "dispute"],
    source: "https://www.irs.gov/individuals/understanding-your-cp504-notice",
  },
  STATE_PROPOSED: {
    title: "State notice of proposed changes",
    issuer: "state",
    what: "Your state's tax agency proposes changes to your return and more tax. You can agree or protest by the date on it.",
    days: 30,
    amount: "proposed",
    responses: ["agree", "dispute"],
    source: "Your state's tax agency (see Taxes, state sources)",
  },
  STATE_BALANCE: {
    title: "State notice of balance due",
    issuer: "state",
    what: "Your state's tax agency says you owe a balance. Paying by the date on it avoids more penalties and interest.",
    days: 30,
    amount: "owed",
    responses: ["pay", "dispute"],
    source: "Your state's tax agency (see Taxes, state sources)",
  },
  ID_VERIFY: {
    title: "Identity verification letter (5071C, 4883C, 6331C)",
    issuer: "irs",
    what: "The IRS holds a return until you confirm it's yours. If you did file it, verify your identity online or by phone; if you didn't, someone may have used your number.",
    days: 30,
    amount: "none",
    responses: ["dispute"],
    source: "https://www.irs.gov/identity-theft-fraud-scams/understanding-your-letter-5071c",
  },
  OTHER: {
    title: "A tax notice",
    issuer: "irs",
    what: "Jane couldn't tell which notice this is. The notice has the date to respond by.",
    days: 30,
    amount: "none",
    responses: ["dispute"],
    source: "https://www.irs.gov/individuals/understanding-your-notice-or-letter",
  },
};

export const isNoticeKind = (v: unknown): v is NoticeKind =>
  typeof v === "string" && Object.hasOwn(NOTICE_KINDS, v);

// The notice fields Jane reads, in order.
export const NOTICE_FIELDS = [
  { key: "kind", label: "Which notice", type: "choice" },
  { key: "issuer", label: "From", type: "text" },
  { key: "taxYear", label: "Tax year", type: "year" },
  { key: "noticeDate", label: "Date of the notice", type: "date" },
  { key: "respondBy", label: "Respond or pay by", type: "date" },
  { key: "amount", label: "Amount on the notice ($)", type: "money" },
  { key: "payer", label: "Payer named (income that doesn't match)", type: "text" },
  { key: "reportedIncome", label: "Income the payer reported ($)", type: "money" },
  { key: "reason", label: "What it says, in a line", type: "text" },
] as const;
export type NoticeFieldKey = (typeof NOTICE_FIELDS)[number]["key"];

// How many past tax years Jane reads a notice for.
export const NOTICE_YEARS_BACK = 6;
// Jane brings up a notice again this many days before it's due.
export const NOTICE_REMIND_DAYS = [14, 3] as const;
