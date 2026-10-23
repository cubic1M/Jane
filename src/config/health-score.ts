// Money health score (spec step 146): one number from 0 to 100, made of parts that each
// count for these many points. Parts Jane can't see yet are left out, and the score is
// scaled over the parts she can, so nobody loses points for what isn't linked.
export const HEALTH_WEIGHTS = {
  // Months of spending the person's cash would cover.
  cushion: 25,
  // How much of income is left after spending, over the last few full months.
  margin: 25,
  // Late, overdraft and insufficient-funds fees lately (none is full points).
  onTime: 20,
  // Card balances carried, as a share of a month's income.
  cards: 15,
  // Savings goals on track.
  goals: 15,
} as const;
export type HealthPart = keyof typeof HEALTH_WEIGHTS;

// Full cushion points at this many months of spending in cash.
export const HEALTH_CUSHION_FULL_MONTHS = 3;
// Full margin points when this share of income is left after spending. None only once
// spending runs this far above income, so breaking even or running a little over still
// counts for something (a 0 should mean every part is truly at its worst).
export const HEALTH_MARGIN_FULL_RATE = 0.2;
export const HEALTH_MARGIN_ZERO_RATE = -0.3;
// Full months of income and spending averaged for the margin and the cushion.
export const HEALTH_MONTHS = 3;
// Fees that mean a bill or balance slipped, and how far back they count.
export const HEALTH_SLIP_CATEGORIES: readonly string[] = [
  "BANK_FEES_LATE_FEES",
  "BANK_FEES_OVERDRAFT_FEES",
  "BANK_FEES_INSUFFICIENT_FUNDS",
];
export const HEALTH_SLIP_DAYS = 90;
// Each such fee costs this many of onTime's points (five in 90 days take them all).
export const HEALTH_POINTS_PER_SLIP = 4;
// No card-balance points once balances carried reach this many months of income.
export const HEALTH_CARDS_ZERO_MONTHS = 6;

// Bands, kind words only. The lowest is still on the way, never a verdict.
export const HEALTH_BANDS: readonly { min: number; label: string }[] = [
  { min: 80, label: "Strong" },
  { min: 60, label: "Steady" },
  { min: 0, label: "Building" },
];
// Under this the number and band aren't quoted to the person ("0, Building" reads as a verdict):
// the chat says it in words, with the one thing that would raise it most.
export const HEALTH_SAY_IN_WORDS_BELOW = 20;
// A change this big or bigger is worth telling the person about.
export const HEALTH_CHANGE_WORTH_SAYING = 5;
// Never in anything the score says: it explains, it doesn't judge.
export const HEALTH_NEVER_SAY =
  /\b(?:bad|poor|fail(?:ing|ed)?|terrible|awful|worst|irresponsible|reckless|careless|shame|ashamed|behind|wasteful|should have)\b/i;
