// What if (spec step 203): the scenarios Jane can run through every sector, and the
// assumptions each starts from. Every number here is shown to the person and can be changed
// when they ask ("what if I lose my job for 4 months").

export const SCENARIOS = [
  "job_loss",
  "raise",
  "baby",
  "moving",
  "car",
  "home",
  "part_time",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export type ScenarioParams = {
  // Share of monthly income lost for `months` (1 = all of it). Negative for a raise.
  incomeLossShare: number;
  // How many months the income change lasts; 0 means for the whole year.
  months: number;
  // Extra spending each month from the start, in cents.
  extraMonthlyCents: number;
  // Spending that stops each month, in cents (a smaller commute, say).
  savedMonthlyCents: number;
  // One-time cost in the first month, in cents.
  oneTimeCents: number;
};

export const SCENARIO_LABELS: Record<Scenario, string> = {
  job_loss: "Losing your job",
  raise: "A raise",
  baby: "A new baby",
  moving: "Moving",
  car: "Buying a car",
  home: "Buying a home",
  part_time: "Going part-time",
};

// Starting assumptions, plainly stated. Dollars are in cents.
export const SCENARIO_DEFAULTS: Record<Scenario, ScenarioParams> = {
  job_loss: {
    incomeLossShare: 1,
    months: 6,
    extraMonthlyCents: 0,
    savedMonthlyCents: 0,
    oneTimeCents: 0,
  },
  raise: {
    incomeLossShare: -0.1,
    months: 0,
    extraMonthlyCents: 0,
    savedMonthlyCents: 0,
    oneTimeCents: 0,
  },
  baby: {
    incomeLossShare: 0,
    months: 0,
    extraMonthlyCents: 120_000,
    savedMonthlyCents: 0,
    oneTimeCents: 500_000,
  },
  moving: {
    incomeLossShare: 0,
    months: 0,
    extraMonthlyCents: 30_000,
    savedMonthlyCents: 0,
    oneTimeCents: 400_000,
  },
  car: {
    incomeLossShare: 0,
    months: 0,
    extraMonthlyCents: 85_000,
    savedMonthlyCents: 0,
    oneTimeCents: 400_000,
  },
  home: {
    incomeLossShare: 0,
    months: 0,
    extraMonthlyCents: 90_000,
    savedMonthlyCents: 0,
    oneTimeCents: 6_000_000,
  },
  part_time: {
    incomeLossShare: 0.4,
    months: 0,
    extraMonthlyCents: 0,
    savedMonthlyCents: 0,
    oneTimeCents: 0,
  },
};

// How each scenario is asked for in the chat.
export const SCENARIO_WORDS: Record<Scenario, RegExp> = {
  job_loss:
    /\b(?:lose|lost|losing) (?:my|the|our) job\b|\bget(?:ting)? laid off\b|\blaid off\b|\bjob loss\b|\bif i (?:get|got) fired\b|\bunemployed\b/,
  raise:
    /\b(?:get|got|getting) a (?:raise|promotion)\b|\bmy pay (?:goes|went) up\b|\bwhat if i earn(?:ed)? more\b/,
  baby: /\b(?:have|having|had|got|expecting) a (?:baby|child|kid)\b|\bnew baby\b|\bstart a family\b/,
  moving: /\b(?:move|moving|relocate|relocating) (?:to|out|house|apartments?)\b|\bwhat if i move\b/,
  car: /\bbuy(?:ing)? a (?:new |used )?car\b|\bnew car\b|\bcar payment\b/,
  home: /\bbuy(?:ing)? a (?:home|house|condo|place)\b|\bpurchase a (?:home|house)\b/,
  part_time: /\bpart[- ]time\b|\bwork(?:ing)? less\b|\bcut my hours\b|\breduce my hours\b/,
};

// Things worth looking at in each scenario, said as things to check (not advice).
export const SCENARIO_COVER: Record<Scenario, string[]> = {
  job_loss: [
    "Health cover through work usually ends; COBRA or a marketplace plan can fill the gap.",
    "Disability and life cover through work may end with the job.",
  ],
  raise: [
    "Check your 401(k) contribution and W-4 so more pay doesn't just become a bigger tax bill.",
  ],
  baby: [
    "Add the baby to a health plan within the plan's window (often 30 days).",
    "Life and disability cover matter more with a dependant.",
  ],
  moving: [
    "Renters or homeowners cover has to move with you.",
    "Car insurance changes with a new address.",
  ],
  car: ["A new car needs auto cover before you drive it; check the rate first."],
  home: [
    "A mortgage lender needs homeowners cover from day one.",
    "Umbrella cover is worth a look once you own a home.",
  ],
  part_time: ["Check whether part-time hours keep your health plan at work."],
};

// Months projected.
export const WHAT_IF_MONTHS = 12;
// Goals and big costs: a month counts as "short" when cash would drop below this.
export const WHAT_IF_FLOOR_CENTS = 0;
// The most months a person can ask for in one scenario.
export const WHAT_IF_MAX_MONTHS = 36;
