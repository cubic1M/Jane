import {
  ASSUMED_GAIN_SHARE,
  HIGH_INTEREST_APR_BPS,
  HOME_SALE_EXCLUSION_CENTS,
  MIN_STAGE_CENTS,
  SUPPLEMENTAL_WITHHOLDING,
  TAX_SOURCES,
  type SuddenKind,
} from "@/config/sudden-money";

// Sudden money (spec step 235, demo advice). Pure. A large deposit that isn't pay becomes a
// staged plan, in this order: the tax to set aside (figured by kind, always first), then
// high-interest debt, the emergency fund, the retirement limits, the goals, and last
// investing. Each stage is a part of the money, never more than is left, and each is a tap.

export type TaxSetAside = { cents: number; note: string; source: string };

export function taxSetAside(input: {
  kind: SuddenKind;
  amountCents: number;
  // The marginal federal rate on the next dollar, and the long-term gains rate.
  marginalRate: number;
  gainRate: number;
  filing: "single" | "married_joint";
  // A home sale or other sale's cost basis, when the person has said it.
  basisCents: number | null;
}): TaxSetAside {
  const { kind, amountCents } = input;
  const source = TAX_SOURCES[kind];
  if (kind === "bonus") {
    // The deposit is after the 22% already withheld: the gross is amount / (1 − 0.22). The
    // extra owed is the rate gap on the gross, if the person's rate is above 22%.
    const gross = amountCents / (1 - SUPPLEMENTAL_WITHHOLDING);
    const extra = Math.max(0, input.marginalRate - SUPPLEMENTAL_WITHHOLDING);
    return {
      cents: Math.round(gross * extra),
      note:
        extra > 0
          ? `22% was already taken out; at your ${Math.round(input.marginalRate * 100)}% rate the rest comes due when you file.`
          : "22% was already taken out, which covers your rate: nothing more to set aside.",
      source,
    };
  }
  if (kind === "inheritance" || kind === "gift") {
    return { cents: 0, note: "Not income to you, so nothing to set aside for tax.", source };
  }
  if (kind === "home_sale") {
    const exclusion = HOME_SALE_EXCLUSION_CENTS[input.filing];
    const gain =
      input.basisCents === null
        ? Math.round(amountCents * ASSUMED_GAIN_SHARE)
        : Math.max(0, amountCents - input.basisCents);
    const taxable = Math.max(0, gain - exclusion);
    return {
      cents: Math.round(taxable * input.gainRate),
      note:
        taxable === 0
          ? "The gain is under the home-sale exclusion, so no tax, if you lived there 2 of the last 5 years."
          : `${input.basisCents === null ? "Assuming half is gain. " : ""}The gain above the exclusion is taxed at ${Math.round(input.gainRate * 100)}%.`,
      source,
    };
  }
  const gain =
    input.basisCents === null
      ? Math.round(amountCents * ASSUMED_GAIN_SHARE)
      : Math.max(0, amountCents - input.basisCents);
  return {
    cents: Math.round(gain * input.gainRate),
    note: `${input.basisCents === null ? "Assuming half the proceeds is gain. " : ""}Taxed at ${Math.round(input.gainRate * 100)}% long-term.`,
    source,
  };
}

export type StageKey = "taxes" | "debt" | "emergency" | "limits" | "goals" | "investing";
export type Stage = { key: StageKey; title: string; cents: number; note: string };

export type PlanInput = {
  amountCents: number;
  tax: TaxSetAside;
  cards: { name: string; balanceCents: number; aprBps: number }[];
  emergencyGapCents: number;
  // Room left this year in IRAs (the match comes through pay, not a lump sum).
  iraRoomCents: number;
  goalShortfalls: { name: string; cents: number }[];
};

export function suddenPlan(input: PlanInput): Stage[] {
  let left = input.amountCents;
  const stages: Stage[] = [];
  const take = (key: StageKey, title: string, want: number, note: string) => {
    const cents = Math.max(0, Math.min(left, want));
    if (cents < (key === "taxes" ? 1 : MIN_STAGE_CENTS)) return;
    left -= cents;
    stages.push({ key, title, cents, note });
  };
  take("taxes", "Set aside for tax", input.tax.cents, input.tax.note);
  const high = input.cards
    .filter((c) => c.aprBps >= HIGH_INTEREST_APR_BPS)
    .sort((a, b) => b.aprBps - a.aprBps);
  take(
    "debt",
    "Pay off high-interest debt",
    high.reduce((s, c) => s + c.balanceCents, 0),
    high.map((c) => `${c.name} at ${(c.aprBps / 100).toFixed(2)}%`).join(", "),
  );
  take(
    "emergency",
    "Fill the emergency fund",
    input.emergencyGapCents,
    "Up to your emergency fund's target.",
  );
  take(
    "limits",
    "Use your retirement limits",
    input.iraRoomCents,
    "Into your IRA, up to this year's limit.",
  );
  take(
    "goals",
    "Move toward your goals",
    input.goalShortfalls.reduce((s, g) => s + g.cents, 0),
    input.goalShortfalls.map((g) => g.name).join(", "),
  );
  take("investing", "Invest the rest", left, "In your target mix.");
  return stages;
}
