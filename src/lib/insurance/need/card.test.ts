import { describe, expect, it } from "vitest";
import { demoPartner } from "@/lib/insurance/demo-partner";
import { cardProblems } from "@/lib/option-card";
import { insuranceCard } from "./card";
import { liabilityNeedsFor, type NeedInput } from "./index";
import { buildOptions, optionRequests } from "./options";

// An option set as the shared card (spec step 276).

const car = {
  id: "p1",
  kind: "auto" as const,
  status: "active",
  deductibleCents: 100_000,
  coverage: { bodilyInjuryPerPerson: 5_000_000, bodilyInjuryPerAccident: 10_000_000 },
};
const input: NeedInput = {
  yearlyPayCents: null,
  dependants: 0,
  mortgageCents: 0,
  otherDebtCents: 0,
  mortgageYearsLeft: null,
  savingsCents: 0,
  cashCents: 0,
  netWorthCents: 20_000_000,
  workLifeCoverCents: 0,
  policies: [car],
};

async function setAndNeed() {
  const [need] = liabilityNeedsFor(input);
  const requests = optionRequests(need, car, { netWorthCents: 20_000_000 });
  const priced = await Promise.all(
    requests.map(async (request) => ({
      request,
      quotes: await demoPartner.quote(
        {
          kind: request.kind,
          state: null,
          household: { housing: "own", vehicles: 1, dependants: 0, pets: 0 },
          deductibleCents: request.deductibleCents,
          coverage: request.coverage,
          premiumFrequency: "monthly",
          startDate: "2026-10-19",
        },
        { now: new Date("2026-10-18T15:00:00Z") },
      ),
    })),
  );
  return { need, set: buildOptions(need, priced, 170_400, { policyId: "p1" }) };
}

describe("insuranceCard", () => {
  it("builds a card that holds to the shared shape, her pick first, with advice", async () => {
    const { need, set } = await setAndNeed();
    const card = insuranceCard(set, need, true);
    expect(cardProblems(card)).toEqual([]);
    expect(card.kind).toBe("insurance");
    expect(card.topic).toBe("auto_liability");
    expect(card.newCover).toBe(false);
    expect(card.options[0].isPick).toBe(true);
    expect(card.options[0].confidence?.percent).toBeLessThanOrEqual(80);
    expect(card.options[0].details.some((d) => d.includes("Injury liability per accident"))).toBe(
      true,
    );
  });

  it("gives a real account the options and no pick", async () => {
    const { need, set } = await setAndNeed();
    const card = insuranceCard(set, need, false);
    expect(cardProblems(card)).toEqual([]);
    expect(card.options.some((o) => o.isPick || o.confidence)).toBe(false);
    expect(card.advice).toBe(false);
  });

  it("says the cover is new when there is no policy behind the need", async () => {
    const { need, set } = await setAndNeed();
    expect(insuranceCard({ ...set, policyId: null }, need, true).newCover).toBe(true);
  });

  it("carries the comparison cards' numbers: a month, a year, how much cover", async () => {
    const { need, set } = await setAndNeed();
    const card = insuranceCard(set, need, true);
    for (const o of card.options) {
      const source = set.options.find((x) => x.id === o.id)!;
      expect(o.compare).toMatchObject({
        monthlyCents: Math.round(source.annualPremiumCents / 12),
        totalCents: source.annualPremiumCents,
        payoffMonths: null,
      });
      expect(o.compare!.rows.map((r) => r.key)).toEqual(["cover", "deductible", "year", "rated"]);
    }
    // More injury liability is more cover.
    const byCover = [...card.options].sort(
      (a, b) => a.compare!.coverScore! - b.compare!.coverScore!,
    );
    const perPerson = byCover.map(
      (o) => set.options.find((x) => x.id === o.id)!.coverage.bodilyInjuryPerPerson as number,
    );
    expect(perPerson).toEqual([...perPerson].sort((a, b) => a - b));
  });
});
