import { describe, expect, it } from "vitest";
import { STALE_UPLOAD_DAYS } from "@/config/import";
import { addDays, daysBetween } from "@/detection/units";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { BILL_FACT_DETECTORS, COVER_FACT_DETECTORS } from "./cover-facts";
import { runDetectors } from "./index";
import { grad, undergrad } from "./__fixtures__/students";

// Gate C (debug 3, 11-19): car cover's "a year" and a cheaper plan's card moved with the calendar. Data held fixed, read on
// each day after it ends: the 12 months counted back from today dropped a premium every month
// ("$3,850.00 a year" one day, "$3,500.00" the next, nothing new seen). They end where the data
// does now.

const premiums = (): ProfileInput => {
  const base = grad();
  const months = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.UTC(2025, 9 + i, 5));
    return d.toISOString().slice(0, 10);
  });
  return {
    ...base,
    today: "2026-11-20",
    transactions: [
      ...base.transactions,
      ...months.map((date) => ({
        date,
        amountCents: 30_000,
        description: "STATE FARM AUTO",
        pfc: "GENERAL_SERVICES_INSURANCE",
        accountId: "grad-checking",
      })),
    ],
  };
};

const yearly = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, COVER_FACT_DETECTORS).find(
    (s) => s.topic === "car_cover_cost",
  )?.short;

describe("car cover's year, with the data held fixed", () => {
  it("reads the same on every day after the data ends", () => {
    const data = premiums();
    const first = yearly(data);
    expect(first).toContain("$3,600.00 a year");
    for (let day = 1; day <= 45; day += 1) {
      const today = addDays(data.today, day);
      expect(yearly({ ...data, today }), today).toBe(first);
    }
  });
});

describe("a cheaper plan's card, with the data held fixed", () => {
  const netflix = (): ProfileInput => {
    const base = undergrad();
    return {
      ...base,
      transactions: [
        ...base.transactions.filter((t) => !/NETFLIX/.test(t.description)),
        ...["2026-08-14", "2026-09-14", "2026-10-14", "2026-11-14"].map((date) => ({
          date,
          amountCents: 1_799,
          description: "NETFLIX.COM",
          pfc: "ENTERTAINMENT_TV_AND_MOVIES",
          accountId: "ug-checking",
        })),
      ],
    };
  };
  const card = (data: ProfileInput) =>
    runDetectors({ profile: buildProfile(data), data }, BILL_FACT_DETECTORS).find(
      (s) => s.topic === "cheaper_tier",
    )?.short;

  it("stays while nothing new comes, until the statements are too old to say what's paid now", () => {
    const data = netflix();
    const first = card(data);
    expect(first).toContain("$17.99");
    const newest = data.transactions.reduce((m, t) => (t.date > m ? t.date : m), "");
    for (let day = 1; day <= 60; day += 1) {
      const today = addDays(data.today, day);
      const tooOld = daysBetween(newest, today) > STALE_UPLOAD_DAYS;
      expect(card({ ...data, today }), today).toBe(tooOld ? undefined : first);
    }
  });
});
