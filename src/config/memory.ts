// What Jane knows about the person (src/lib/memory/): how sure it starts, and how each new
// piece of evidence moves that.

// Where a fact came from. "upload": read from statements the person uploaded; "detector": read
// from a linked bank by the nightly scan; "answer": the person's answer or correction; "chat":
// something they said in the chat; "action": what they did with a suggestion or a card.
export const FACT_SOURCES = ["upload", "detector", "answer", "chat", "action"] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

// How sure a fact starts, by where it came from, when the evidence gives no figure of its own.
export const START_CONFIDENCE: Record<FactSource, number> = {
  answer: 95,
  chat: 80,
  action: 70,
  upload: 60,
  detector: 60,
};

// Whose word counts most: the person's own beats what they did, which beats what the data
// suggests. Evidence of a higher or equal rank replaces a different value at once; weaker
// evidence only lowers the confidence of what's known.
export const SOURCE_RANK: Record<FactSource, number> = {
  answer: 3,
  chat: 3,
  action: 2,
  upload: 1,
  detector: 1,
};

// Agreeing evidence from somewhere new raises a fact by this much, up to MAX_CONFIDENCE.
export const CONFIRM_STEP = 10;
export const MAX_CONFIDENCE = 99;
// Disagreeing weaker evidence lowers it by this much...
export const CONTRADICT_STEP = 25;
// ...and once it falls below this, the new value takes its place.
export const SUPERSEDE_BELOW = 40;
// What the person answered never falls below this from data alone: only they can change it.
export const ANSWER_FLOOR = 50;
// A correction on /settings/memory.
export const CORRECTED_CONFIDENCE = 99;

// Jane's chat and the detectors use facts at least this sure.
export const USE_FROM_CONFIDENCE = 60;
// How many facts go into a chat answer's context, the surest first.
export const CHAT_MEMORY_FACTS = 25;

// Lengths kept.
export const FACT_LABEL_MAX = 160;
export const FACT_TEXT_MAX = 80;

// The profile facts (src/profile/facts.ts) the nightly scan remembers when it sees them in the
// data. Steady things only: amounts that move every month aren't kept as facts.
export const DATA_FACT_KEYS = [
  "income_pattern",
  "employer",
  "earners",
  "housing",
  "has_car",
  "has_pet",
  "is_student",
  "work_style",
  "travels_often",
  "eating_style",
  "side_gig",
  "has_children",
  "insurance_auto",
  "insurance_home",
  "has_401k",
  "has_hsa",
  "has_stock_plan",
] as const;

// Paychecks: at least this many in the window, mostly on the same days of the month (within
// PAYDAY_SLACK_DAYS), make a payday.
export const PAYDAY_WINDOW_DAYS = 120;
export const PAYDAY_MIN_DEPOSITS = 3;
export const PAYDAY_SLACK_DAYS = 2;
export const PAYDAY_SHARE = 0.75;
// Something never seen (no car payments, no home cover) is remembered as a "no" only after this
// many months of data; with less, it may just not have shown up yet.
export const ABSENCE_MIN_MONTHS = 3;
// Card habit: any interest charged in this many days means a balance is carried.
export const CARD_HABIT_DAYS = 90;
// Rent payee: at least this many rent payments to the same name.
export const RENT_PAYEE_MIN = 2;
