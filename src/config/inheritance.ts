// Inherited money and gifts (spec step 268). FOR REVIEW: rules and limits by year, with
// sources. Jane states facts and points to counsel; she gives no legal advice.
//
// Sources: IRS Publication 590-B (inherited IRAs and the 10-year rule, final regulations of
// July 2024: a beneficiary of an owner who had begun required withdrawals also takes yearly
// withdrawals in years 1 to 9), IRC section 1014 (basis of inherited property is its fair
// market value at the date of death), IRS "Frequently asked questions on gift taxes" (the
// annual exclusion, Form 709) and "Estate tax" (the basic exclusion amount), and each state's
// department of revenue for its estate or inheritance tax.

// An account is an inherited IRA when its name says so (custodians call it "Inherited IRA" or
// "Beneficiary IRA").
export const INHERITED_NAME = /inherit|beneficiar/i;

// How many years a non-spouse beneficiary has to empty an inherited IRA: the end of the 10th
// year after the year the owner died.
export const INHERITED_IRA_YEARS = 10;

// The excise tax on money that should have come out of an inherited IRA by the deadline:
// 25% of the shortfall (10% if put right within two years), IRS Publication 590-B / SECURE 2.0.
export const MISSED_WITHDRAWAL_PENALTY = 0.25;

// Who is exempt from the 10-year rule (eligible designated beneficiaries).
export const ELIGIBLE_BENEFICIARIES = [
  "a spouse (who can also treat it as their own)",
  "a minor child of the owner (until they turn 21)",
  "a disabled or chronically ill person",
  "someone not more than 10 years younger than the owner",
] as const;

// Spreading an inherited IRA is raised when it saves at least this much against taking it all
// in the last year.
export const SPREAD_MIN_SAVING_CENTS = 50_000;

// The annual gift tax exclusion per person (src/config/family.ts GIFT_ANNUAL_EXCLUSION_CENTS
// holds the same 2026 figure for the family tools); a couple can split a gift to double it,
// which takes a Form 709.
export const GIFT_RETURN_DUE = "04-15";
export const GIFT_SPLIT_FACTOR = 2;

// The federal estate tax basic exclusion amount, per person, 2026 (made permanent at this
// level by the 2025 law). ESTIMATE TO VERIFY with the IRS.
export const ESTATE_EXCLUSION_CENTS = 1_500_000_000;
export const ESTATE_SOURCE = "IRS: Estate tax, the basic exclusion amount for 2026";

// The estate facts Jane says, word for word (planning/inheritance.ts estateFacts). The federal
// line names the estate tax, which the legal guardrail blocks as advice in any other sentence,
// so these exact sentences pass it (APPROVED_ESTATE_SENTENCES, src/lib/guardrails.ts).
export const FEDERAL_ESTATE_FACT = `The federal estate tax only applies to estates over ${Math.round(ESTATE_EXCLUSION_CENTS / 100_000_000)} million dollars per person (more for a couple); most families owe none.`;
export const ESTATE_LAWYER_POINTER =
  "An estate lawyer can say what applies to a particular family.";

// States with their own estate or inheritance tax, with the lowest threshold (an estate over
// it is taxed) or who pays; rough, ESTIMATE TO VERIFY with the state.
export const STATE_DEATH_TAXES: Readonly<Record<string, string>> = {
  WA: "Washington taxes estates over about $3 million.",
  OR: "Oregon taxes estates over $1 million.",
  MA: "Massachusetts taxes estates over $2 million.",
  NY: "New York taxes estates over about $7 million (and taxes the whole estate if it is more than 5% over).",
  MN: "Minnesota taxes estates over $3 million.",
  IL: "Illinois taxes estates over $4 million.",
  MD: "Maryland has both an estate tax and an inheritance tax (10% on non-relatives).",
  NJ: "New Jersey has an inheritance tax on heirs who aren't close family.",
  PA: "Pennsylvania has an inheritance tax, with lower rates for close family.",
  KY: "Kentucky has an inheritance tax on heirs who aren't close family.",
  NE: "Nebraska has an inheritance tax, with the county collecting it.",
};

export const APPROVED_ESTATE_SENTENCES: readonly string[] = [
  FEDERAL_ESTATE_FACT,
  ...Object.values(STATE_DEATH_TAXES),
  ESTATE_LAWYER_POINTER,
];
