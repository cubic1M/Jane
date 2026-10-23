import { describe, expect, it } from "vitest";
import { DEPOSIT_DEFAULT, DEPOSIT_RULES, LOCAL_RENT } from "@/config/renting";
import { depositView, enoughRent, rentPayments, rentRise } from "./renting";

const rent = (date: string, amountCents: number, description = "OAK APARTMENTS RENT") => ({
  date,
  amountCents,
  description,
  pfc: "RENT_AND_UTILITIES_RENT",
});

describe("rent payments", () => {
  it("finds rent by category and a landlord name, oldest first, and leaves the rest", () => {
    const found = rentPayments([
      rent("2026-03-01", 150_000),
      rent("2026-01-01", 150_000),
      { ...rent("2026-02-01", 5_000), pfc: "FOOD_AND_DRINK_COFFEE" },
      rent("2026-02-01", 90_000, "HOME RENT SHARE"),
      rent("2026-02-01", -150_000),
    ]);
    expect(found).toEqual([
      { date: "2026-01-01", cents: 150_000 },
      { date: "2026-03-01", cents: 150_000 },
    ]);
  });

  it("needs a few payments before it calls it a pattern", () => {
    expect(enoughRent([{ date: "2026-01-01", cents: 1 }])).toBe(false);
    expect(
      enoughRent(["2026-01-01", "2026-02-01", "2026-03-01"].map((date) => ({ date, cents: 1 }))),
    ).toBe(true);
  });
});

describe("a rent increase", () => {
  const months = (cents: number[]) =>
    cents.map((c, i) => ({ date: `2026-0${i + 1}-01`, cents: c }));

  it("compares the latest rent with what it was and says what a year of it costs", () => {
    const r = rentRise(months([150_000, 150_000, 150_000, 165_000]))!;
    expect(r).toMatchObject({ beforeCents: 150_000, nowCents: 165_000, risePercentBps: 1_000 });
    expect(r.yearlyExtraCents).toBe(180_000);
    expect(r.usualBps).toBe(LOCAL_RENT.usualYearlyRiseBps);
    expect(r.askAbout).toBe(true);
  });

  it("does not ask about a rise at the usual rate", () => {
    const r = rentRise(months([150_000, 150_000, 150_000, 156_000]))!;
    expect(r.risePercentBps).toBe(400);
    expect(r.askAbout).toBe(false);
  });

  it("is nothing when rent is flat, fell, or there's one payment", () => {
    expect(rentRise(months([150_000, 150_000, 150_000]))).toBeNull();
    expect(rentRise(months([150_000, 150_000, 140_000]))).toBeNull();
    expect(rentRise(months([150_000]))).toBeNull();
  });
});

describe("a security deposit", () => {
  it("is due the state's number of days after moving out", () => {
    const v = depositView(
      { state: "CA", movedOutOn: "2026-06-01", returnedOn: null },
      "2026-06-10",
    );
    expect(v).toMatchObject({ dueOn: "2026-06-22", daysLeft: 12, status: "due" });
    expect(v.rule.source).toBe(DEPOSIT_RULES.CA.source);
  });

  it("uses the state's own days", () => {
    const due = (state: string) =>
      depositView({ state, movedOutOn: "2026-06-01", returnedOn: null }, "2026-06-01").dueOn;
    expect(due("NY")).toBe("2026-06-15");
    expect(due("TX")).toBe("2026-07-01");
    expect(due("fl")).toBe("2026-06-16");
  });

  it("falls back to a stated default for a state not in the list", () => {
    const v = depositView(
      { state: "ZZ", movedOutOn: "2026-06-01", returnedOn: null },
      "2026-06-01",
    );
    expect(v.rule).toBe(DEPOSIT_DEFAULT);
    expect(v.dueOn).toBe("2026-07-01");
  });

  it("is overdue after the day, returned once returned, and waits without a move-out date", () => {
    expect(
      depositView({ state: "CA", movedOutOn: "2026-06-01", returnedOn: null }, "2026-06-23"),
    ).toMatchObject({ status: "overdue", daysLeft: -1 });
    expect(
      depositView({ state: "CA", movedOutOn: "2026-06-01", returnedOn: "2026-06-20" }, "2026-06-23")
        .status,
    ).toBe("returned");
    expect(
      depositView({ state: "CA", movedOutOn: null, returnedOn: null }, "2026-06-23").status,
    ).toBe("waiting_for_move_out");
  });

  it("gives every state rule a source", () => {
    for (const r of Object.values(DEPOSIT_RULES)) {
      expect(r.source.length).toBeGreaterThan(5);
      expect(r.days).toBeGreaterThan(0);
    }
  });
});
