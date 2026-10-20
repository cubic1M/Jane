// A steady hand (spec step 163, demo advice): when markets drop, Jane keeps the plan.
// She says what changed, what it means for each goal's timeline, and what the plan is. She
// never says what markets will do, in any message, reply or tool. FOR REVIEW.

// A "big drop": the investments' own return (money in and out left out) over a window.
export const DROP_THRESHOLDS = [
  { key: "1m", below: -0.08, label: "the last month" },
  { key: "3m", below: -0.15, label: "the last 3 months" },
] as const;

// A sell the person starts pauses once while a drop is on, and shows what selling costs
// over this many years at the assumed range (src/config/market-assumptions.ts).
export const PAUSE_YEARS = 10;

// Words Jane never uses about markets: a test checks every steady-hand message for them.
export const PREDICTION_WORDS =
  /\b(will (?:recover|rebound|bounce|fall|drop|rise|crash|go up|go down|come back)|expect(?:ed)? (?:to|a)|likely to|forecast|predict|going to (?:recover|rebound|fall|rise)|bottom|rally|should recover)\b/i;

export const NO_PREDICTION = "I can't tell you what markets will do, and nobody can.";
