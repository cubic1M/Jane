import { describe, expect, it } from "vitest";
import { PERSON_IDS } from "@/config/people";
import { buildProfile, type ProfileInput } from "./build";
import {
  commuteReading,
  eatingReading,
  fitnessReading,
  healthCostReading,
  kidsReading,
  ownerBills,
  petReading,
  sideGigReading,
  studentReading,
  travelReading,
  type LifeTx,
} from "./life-facts";
import { inputFor } from "./sample";

// A person's life from their payments (founder, 2026-10-26): each fact needs a pattern, never a
// single payment, and names what it saw.

const tx = (
  date: string,
  description: string,
  pfc: string | null = null,
  cents = 2500,
): LifeTx => ({
  date,
  amountCents: cents,
  description,
  pfc,
});
const monthly = (description: string, pfc: string | null, n: number, cents = 2500): LifeTx[] =>
  Array.from({ length: n }, (_, i) =>
    tx(`2026-${String(i + 1).padStart(2, "0")}-10`, description, pfc, cents),
  );

describe("children", () => {
  it("one childcare payment is seen, as before", () => {
    const r = kidsReading([tx("2026-06-01", "BRIGHT HORIZONS", "GENERAL_SERVICES_CHILDCARE")]);
    expect(r).toMatchObject({ value: true, source: "seen", matches: 1 });
  });

  it("a school and a pediatrician across months are seen, with what was seen", () => {
    const r = kidsReading([
      ...monthly("RIVERDALE SCHOOL DISTRICT LUNCH", null, 4),
      ...monthly("SUNNYSIDE PEDIATRICS", "MEDICAL_PRIMARY_CARE", 3, 4000),
    ]);
    expect(r).toMatchObject({ value: true, source: "seen" });
    expect(r.what).toBe("school and pediatric payments");
  });

  it("one kind of weaker sign is a guess, and a toy shop twice is nothing", () => {
    expect(kidsReading(monthly("PTA DUES", null, 3))).toMatchObject({
      value: true,
      source: "guessed",
    });
    expect(
      kidsReading([tx("2026-05-01", "LEGO STORE"), tx("2026-12-01", "LEGO STORE")]).value,
    ).toBe(false);
  });
});

describe("pets", () => {
  it("vet visits and pet food over months are seen; a lone purchase is not a pet", () => {
    const seen = petReading([
      ...monthly("CHEWY.COM", "GENERAL_MERCHANDISE_PET_SUPPLIES", 4),
      tx("2026-03-03", "RIVERSIDE ANIMAL HOSPITAL", "MEDICAL_VETERINARY_SERVICES", 18000),
    ]);
    expect(seen).toMatchObject({ value: true, source: "seen", matches: 5 });
    expect(petReading([tx("2026-03-03", "PETCO")]).value).toBe(false);
    expect(petReading(monthly("PETCO", null, 3))).toMatchObject({ value: true, source: "guessed" });
  });
});

describe("school", () => {
  it("an online course is not a student; tuition alone is a guess; campus spending is seen", () => {
    expect(studentReading(monthly("SKILLSHARE", "GENERAL_SERVICES_EDUCATION", 6)).value).toBe(
      false,
    );
    expect(
      studentReading([
        tx("2026-01-05", "STATE UNIVERSITY BURSAR", null, 450000),
        tx("2026-08-05", "STATE UNIVERSITY BURSAR", null, 450000),
      ]),
    ).toMatchObject({ value: true, source: "guessed" });
    expect(
      studentReading([
        ...monthly("STATE UNIVERSITY BOOKSTORE", null, 3),
        tx("2026-01-05", "STATE UNIVERSITY BURSAR", null, 450000),
      ]),
    ).toMatchObject({ value: true, source: "seen" });
  });

  it("student-loan payments do not make someone a student", () => {
    expect(
      studentReading(monthly("NAVIENT", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT", 12, 30000)).value,
    ).toBe(false);
  });
});

describe("home", () => {
  it("monthly dues are a homeowner's bills; property tax twice a year only suggests it", () => {
    expect(ownerBills(monthly("MAPLE GROVE HOA DUES", null, 6))).toMatchObject({
      met: true,
      seen: true,
    });
    expect(
      ownerBills([
        tx("2026-04-10", "COUNTY TAX COLLECTOR PROPERTY TAX"),
        tx("2026-11-10", "COUNTY TAX COLLECTOR PROPERTY TAX"),
      ]),
    ).toMatchObject({ met: true, seen: false });
  });
});

describe("getting about", () => {
  it("transit and parking across months is a commuter", () => {
    expect(
      commuteReading(
        [
          ...monthly("MTA*NYCT PAYGO", "TRANSPORTATION_PUBLIC_TRANSIT", 4),
          ...monthly("SP PLUS PARKING", "TRANSPORTATION_PARKING", 4),
        ],
        12,
        true,
      ),
    ).toMatchObject({ value: "commuter", source: "seen" });
  });

  it("remote is only a guess: a salary and no commute at all", () => {
    expect(commuteReading([], 12, true)).toMatchObject({ value: "remote", source: "guessed" });
    expect(commuteReading([], 12, false)).toBeNull();
    // A car commute would show as gas.
    expect(
      commuteReading(
        monthly("SHELL OIL", "TRANSPORTATION_GAS", 12)
          .concat(monthly("CHEVRON", "TRANSPORTATION_GAS", 12))
          .concat(monthly("EXXON", "TRANSPORTATION_GAS", 12)),
        12,
        true,
      ),
    ).toBeNull();
  });

  it("three trips in a year is a frequent traveller", () => {
    const trips = [
      tx("2026-02-01", "DELTA AIR LINES", "TRAVEL_FLIGHTS", 40000),
      tx("2026-02-03", "MARRIOTT", "TRAVEL_LODGING", 30000),
      tx("2026-05-10", "UNITED AIRLINES", "TRAVEL_FLIGHTS", 40000),
      tx("2026-09-01", "AIRBNB", "TRAVEL_LODGING", 60000),
    ];
    expect(travelReading(trips)).toMatchObject({ value: true, matches: 3 });
    expect(travelReading(trips.slice(0, 2))).toMatchObject({ value: false, matches: 1 });
  });

  it("a gym over months, not one visit", () => {
    expect(
      fitnessReading(monthly("PLANET FITNESS", "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", 6)).value,
    ).toBe(true);
    expect(fitnessReading([tx("2026-02-02", "YOGA STUDIO")]).value).toBe(false);
  });
});

describe("how they eat", () => {
  const food = (groceries: number, out: number): LifeTx[] => [
    ...Array.from({ length: 6 }, (_, i) =>
      tx(
        `2026-03-${String(i + 1).padStart(2, "0")}`,
        "KROGER",
        "FOOD_AND_DRINK_GROCERIES",
        groceries,
      ),
    ),
    ...Array.from({ length: 6 }, (_, i) =>
      tx(`2026-04-${String(i + 1).padStart(2, "0")}`, "DOORDASH", null, out),
    ),
  ];
  it("says cooks, eats out or mixed from the share of food spending", () => {
    expect(eatingReading(food(9000, 1500))?.value).toBe("cooks");
    expect(eatingReading(food(1500, 9000))?.value).toBe("eats_out");
    expect(eatingReading(food(5000, 5000))?.value).toBe("mixed");
  });
  it("needs enough food payments to say", () => {
    expect(eatingReading([tx("2026-03-01", "KROGER", "FOOD_AND_DRINK_GROCERIES")])).toBeNull();
  });
});

describe("a side gig and health costs", () => {
  const gigs = Array.from({ length: 4 }, (_, i) =>
    tx(`2026-0${i + 1}-15`, "ETSY PAYOUT", "INCOME_GIG_ECONOMY", -30000),
  );
  it("a side gig is gig deposits beside a salary; for the self-employed it is the job", () => {
    expect(sideGigReading(gigs, true)).toMatchObject({ value: true, source: "seen" });
    expect(sideGigReading(gigs, false).value).toBe(false);
  });
  it("health spending is only a cost: enough payments, months and dollars; vet bills are pets", () => {
    const bills = monthly("RIVERSIDE FAMILY MEDICINE", "MEDICAL_PRIMARY_CARE", 8, 40000);
    expect(healthCostReading(bills, 12)).toMatchObject({ value: true, source: "seen" });
    expect(
      healthCostReading(monthly("ANIMAL HOSPITAL", "MEDICAL_VETERINARY_SERVICES", 8, 40000), 12)
        .value,
    ).toBe(false);
    expect(
      healthCostReading(monthly("PHARMACY", "MEDICAL_PHARMACIES_AND_SUPPLEMENTS", 8, 1500), 12)
        .value,
    ).toBe(false);
  });
});

describe("in the profile", () => {
  const base = (): ProfileInput => ({
    today: "2026-10-21",
    transactions: [],
    accounts: [],
    liabilities: [],
    told: {},
  });

  it("every person has every life fact, with a percentage and what it was worked out from", () => {
    for (const id of PERSON_IDS) {
      const { facts } = buildProfile(inputFor(id));
      for (const key of [
        "has_children",
        "has_pet",
        "new_baby",
        "is_student",
        "work_style",
        "travels_often",
        "goes_to_gym",
        "eating_style",
        "side_gig",
        "health_costs",
        "moved_recently",
      ] as const) {
        expect(facts[key], `${id} ${key}`).toBeDefined();
        expect(facts[key].evidence.length).toBeGreaterThan(0);
        if (facts[key].source === "guessed") expect(facts[key].confidence).toBeLessThan(50);
      }
    }
  });

  it("the sample family has children and the others do not; the traveller travels", () => {
    expect(buildProfile(inputFor("family")).facts.has_children).toMatchObject({
      value: true,
      source: "seen",
    });
    for (const id of PERSON_IDS.filter((p) => p !== "family")) {
      expect(buildProfile(inputFor(id)).facts.has_children.value, id).toBe(false);
    }
    expect(buildProfile(inputFor("equity")).facts.travels_often.value).toBe(true);
    expect(buildProfile(inputFor("retiree")).facts.health_costs.value).toBe(true);
  });

  it("what the person says wins over what is seen", () => {
    const input = { ...base(), told: { has_pet: true, work_style: "commuter" } };
    const { facts } = buildProfile(input);
    expect(facts.has_pet).toMatchObject({ value: true, source: "told", confidence: 100 });
    expect(facts.work_style).toMatchObject({ value: "commuter", source: "told" });
  });

  it("a new baby: baby goods lately with nothing for children before", () => {
    const goods = ["2026-09-01", "2026-09-20", "2026-10-05"].map((d) =>
      tx(d, "PAMPERS DIAPERS", null, 3000),
    );
    const input = { ...base(), transactions: goods.map((t) => ({ ...t, accountId: "a" })) };
    expect(buildProfile(input).facts.new_baby).toMatchObject({ value: true, source: "guessed" });
    const older = [
      { ...tx("2026-01-05", "BRIGHT HORIZONS", "GENERAL_SERVICES_CHILDCARE"), accountId: "a" },
    ];
    const second = { ...input, transactions: [...input.transactions, ...older] };
    expect(buildProfile(second).facts.new_baby.value).toBe(false);
  });
});
