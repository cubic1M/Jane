// What the person's investments are for (spec step 129): the four questions Jane asks, the
// answers she offers, and how the answers become a risk level. Later investment steps read
// the level (src/planning/investor-profile.ts), never the raw answers.
//
// The method is the common one in investor questionnaires: the level is the lower of what
// the person can afford to risk (when they need the money: capacity) and what they'd be
// comfortable with (how a drop would feel: willingness). Source: FINRA Rule 2111
// (suitability: age, time horizon, risk tolerance and investment objectives) and its
// Supplementary Material .05.

export const RISK_LEVELS = {
  1: {
    label: "Conservative",
    description: "Keeping what you have matters most; smaller ups and downs, slower growth.",
  },
  2: {
    label: "Moderately conservative",
    description: "Mostly steady, with some room to grow.",
  },
  3: {
    label: "Moderate",
    description: "A balance of growth and steadiness.",
  },
  4: {
    label: "Moderately aggressive",
    description: "Mostly growth, accepting bigger drops along the way.",
  },
  5: {
    label: "Aggressive",
    description: "Growth first; you can ride out large drops.",
  },
} as const;

export type RiskLevel = keyof typeof RISK_LEVELS;

export type ProfileQuestionKey = "age" | "horizon" | "drop" | "goal";

export type ProfileChoice = { label: string; value: string };

export type ProfileQuestion = {
  key: ProfileQuestionKey;
  text: string;
  choices: readonly ProfileChoice[];
};

// Ages from the chat's buttons are the middle of each band; the profile page takes an
// exact age.
export const AGE_CHOICES: readonly ProfileChoice[] = [
  { label: "Under 30", value: "25" },
  { label: "30s", value: "35" },
  { label: "40s", value: "45" },
  { label: "50s", value: "55" },
  { label: "60 or over", value: "65" },
];
export const MIN_AGE = 18;
export const MAX_AGE = 100;

export const HORIZONS = {
  under_3: { label: "Within 3 years", capacity: 1 },
  "3_to_10": { label: "In 3 to 10 years", capacity: 3 },
  "10_to_20": { label: "In 10 to 20 years", capacity: 4 },
  over_20: { label: "In 20 years or more", capacity: 5 },
} as const satisfies Record<string, { label: string; capacity: RiskLevel }>;

export const DROP_REACTIONS = {
  sell: { label: "I'd sell to stop the losses", willingness: 1 },
  worry: { label: "I'd worry, but wait it out", willingness: 3 },
  fine: { label: "I'd be fine; it comes back", willingness: 4 },
  buy: { label: "I'd put more in", willingness: 5 },
} as const satisfies Record<string, { label: string; willingness: RiskLevel }>;

export const GOALS = {
  retirement: "Retirement",
  home: "Buying a home",
  education: "A child's education",
  growth: "Growing my money",
  income: "Income to live on",
} as const;

export type Horizon = keyof typeof HORIZONS;
export type DropReaction = keyof typeof DROP_REACTIONS;
export type Goal = keyof typeof GOALS;

// How big a drop the "how would it feel" question describes.
export const DROP_QUESTION_PERCENT = 20;

// The questions in the order Jane asks them in the chat (at most five answers each, the
// chat's answer buttons).
export const PROFILE_QUESTIONS: readonly ProfileQuestion[] = [
  { key: "age", text: "How old are you?", choices: AGE_CHOICES },
  {
    key: "horizon",
    text: "When will you need most of this money?",
    choices: Object.entries(HORIZONS).map(([value, h]) => ({ label: h.label, value })),
  },
  {
    key: "drop",
    text: `If your investments fell ${DROP_QUESTION_PERCENT}% in a month, what would you do?`,
    choices: Object.entries(DROP_REACTIONS).map(([value, d]) => ({ label: d.label, value })),
  },
  {
    key: "goal",
    text: "What's this money mostly for?",
    choices: Object.entries(GOALS).map(([value, label]) => ({ label, value })),
  },
];

// Jane asks again after this long, in case life has changed.
export const PROFILE_REVIEW_DAYS = 365;

// Spec step 131: the mix of investments each risk level aims for, as shares of the money
// invested. The stock/bond split follows the usual ladder of model portfolios (about 30%
// stocks for the most careful up to about 90% for the boldest, as in target-date funds and
// robo-adviser models), with about a third of stocks outside the US, roughly
// international stocks' share of the world's stock markets.
export const TARGET_MIXES: Readonly<
  Record<RiskLevel, { us_stocks: number; intl_stocks: number; bonds: number; cash: number }>
> = {
  1: { us_stocks: 0.2, intl_stocks: 0.1, bonds: 0.6, cash: 0.1 },
  2: { us_stocks: 0.3, intl_stocks: 0.15, bonds: 0.5, cash: 0.05 },
  3: { us_stocks: 0.4, intl_stocks: 0.2, bonds: 0.35, cash: 0.05 },
  4: { us_stocks: 0.5, intl_stocks: 0.25, bonds: 0.2, cash: 0.05 },
  5: { us_stocks: 0.6, intl_stocks: 0.3, bonds: 0.08, cash: 0.02 },
};

// An asset class this many percentage points away from its target counts as off target.
export const DRIFT_POINTS = 5;
// Any one company's shares above this share of everything invested count as concentrated:
// a common rule of thumb is no more than 5% in a single stock, and no more than 10% in the
// stock of the company you work for (FINRA, "Concentrate on the Concentration").
export const SINGLE_STOCK_LIMIT = 0.05;
// Cash above the target by this many percentage points is money sitting idle.
export const CASH_DRAG_POINTS = 5;
// Moves smaller than this aren't worth suggesting.
export const MIN_MOVE_CENTS = 50_000;
