import { describe, expect, it } from "vitest";
import { affordCheck, affordWindow, monthEnd, type AffordNumbers, type Flow } from "./afford";

const AS_OF = "2026-10-20";

// Pay of $3,000 on the 1st and rent of $2,500 on the 5th, from November: checking ends
// each month $500 higher than the one before, starting from $2,000 today.
function monthly(day: string, amountCents: number): Flow[] {
  return affordWindow(AS_OF)
    .months.slice(1)
    .map((m) => ({ date: `${m}-${day}`, amountCents }));
}

function numbers(overrides: Partial<AffordNumbers> = {}): AffordNumbers {
  return {
    asOf: AS_OF,
    safe: { payday: "2026-11-01", balanceCents: 200_000, safeCents: 100_000 },
    flows: [...monthly("01", 300_000), ...monthly("05", -250_000)],
    goals: [],
    ...overrides,
  };
}

const BEFORE = Array.from({ length: 12 }, (_, k) => 200_000 + k * 50_000);
const afterBy = (result: ReturnType<typeof affordCheck>) =>
  result.months!.map((m, k) => m.afterCents - BEFORE[k]);

// $1,200 by Oct 20, 2027 with nothing saved: 12 months at $100.
const TRIP = {
  id: "trip",
  name: "Trip",
  targetCents: 120_000,
  savedCents: 0,
  targetDate: "2027-10-20",
};

describe("affordWindow", () => {
  it("covers this month and the next 11, to the last day", () => {
    const { months, until } = affordWindow(AS_OF);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-10");
    expect(months[11]).toBe("2027-09");
    expect(until).toBe("2027-09-30");
  });

  it("knows month lengths", () => {
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2027-02")).toBe("2027-02-28");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
  });
});

describe("affordCheck", () => {
  it("takes a purchase today off safe to spend and every month", () => {
    const result = affordCheck(numbers(), {
      kind: "purchase",
      amountCents: 30_000,
      date: AS_OF,
    });
    expect(result.safe).toEqual({ payday: "2026-11-01", beforeCents: 100_000, afterCents: 70_000 });
    expect(result.months!.map((m) => m.beforeCents)).toEqual(BEFORE);
    expect(afterBy(result)).toEqual(Array(12).fill(-30_000));
    expect(result.months![0]).toEqual({
      month: "2026-10",
      beforeCents: 200_000,
      afterCents: 170_000,
    });
  });

  it("leaves safe to spend alone for a purchase after payday, and counts it from its month", () => {
    const result = affordCheck(numbers(), {
      kind: "purchase",
      amountCents: 30_000,
      date: "2027-01-10",
    });
    expect(result.safe!.afterCents).toBe(100_000);
    expect(afterBy(result)).toEqual([0, 0, 0, ...Array(9).fill(-30_000)]);
  });

  it("counts a purchase before payday, and on payday not", () => {
    const change = (date: string) =>
      affordCheck(numbers(), { kind: "purchase", amountCents: 5_000, date }).safe!.afterCents;
    expect(change("2026-10-31")).toBe(95_000);
    expect(change("2026-11-01")).toBe(100_000);
  });

  it("uses the bills window when no payday is expected", () => {
    const noPayday = numbers({
      safe: { payday: null, balanceCents: 200_000, safeCents: 100_000 },
    });
    const at = (date: string) =>
      affordCheck(noPayday, { kind: "purchase", amountCents: 5_000, date }).safe!.afterCents;
    expect(at("2026-11-20")).toBe(95_000);
    expect(at("2026-11-21")).toBe(100_000);
  });

  it("adds up a monthly increase from this month, starting today", () => {
    const result = affordCheck(numbers(), {
      kind: "monthly",
      amountCents: 10_000,
      startMonth: "2026-10",
    });
    expect(result.safe!.afterCents).toBe(90_000);
    expect(afterBy(result)).toEqual(Array.from({ length: 12 }, (_, k) => -(k + 1) * 10_000));
  });

  it("starts a monthly increase on the 1st of a later month", () => {
    const result = affordCheck(numbers(), {
      kind: "monthly",
      amountCents: 10_000,
      startMonth: "2026-12",
    });
    expect(result.safe!.afterCents).toBe(100_000);
    expect(afterBy(result).slice(0, 4)).toEqual([0, 0, -10_000, -20_000]);
    expect(afterBy(result)[11]).toBe(-100_000);
  });

  it("adds a monthly cut back to checking", () => {
    const result = affordCheck(numbers(), {
      kind: "monthly",
      amountCents: -10_000,
      startMonth: "2026-11",
    });
    // November 1 is payday, so the cut lands after this stretch of safe to spend.
    expect(result.safe!.afterCents).toBe(100_000);
    expect(afterBy(result).slice(0, 3)).toEqual([0, 10_000, 20_000]);

    const thisMonth = affordCheck(numbers(), {
      kind: "monthly",
      amountCents: -10_000,
      startMonth: "2026-10",
    });
    expect(thisMonth.safe!.afterCents).toBe(110_000);
  });

  it("flags the first month that goes below zero, before and after", () => {
    const result = affordCheck(numbers(), {
      kind: "purchase",
      amountCents: 320_000,
      date: "2026-12-10",
    });
    expect(result.firstShort).toEqual({ before: null, after: "2026-12" });
    expect(result.months![2].afterCents).toBe(-20_000);
    expect(result.months![3].afterCents).toBe(30_000);

    // Rent higher than pay: checking runs out in January before any change.
    const shrinking = numbers({ flows: [...monthly("01", 300_000), ...monthly("05", -400_000)] });
    expect(
      affordCheck(shrinking, { kind: "monthly", amountCents: 50_000, startMonth: "2026-10" })
        .firstShort,
    ).toEqual({ before: "2027-01", after: "2026-12" });
  });

  it("doesn't flag a month that ends at exactly zero", () => {
    const result = affordCheck(numbers(), {
      kind: "purchase",
      amountCents: 300_000,
      date: "2026-12-10",
    });
    expect(result.months![2].afterCents).toBe(0);
    expect(result.firstShort!.after).toBeNull();
  });

  it("works out goals without a checking account, and nothing else", () => {
    const result = affordCheck(numbers({ safe: null, flows: [], goals: [TRIP] }), {
      kind: "purchase",
      amountCents: 24_000,
      date: AS_OF,
    });
    expect(result.safe).toBeNull();
    expect(result.months).toBeNull();
    expect(result.firstShort).toBeNull();
    expect(result.goals).toHaveLength(1);
  });
});

describe("affordCheck goal effects", () => {
  const check = (change: Parameters<typeof affordCheck>[1], goals = [TRIP]) =>
    affordCheck(numbers({ goals }), change).goals;

  it("shows the monthly amount to still reach a goal on time after a purchase", () => {
    expect(check({ kind: "purchase", amountCents: 24_000, date: AS_OF })).toEqual([
      {
        kind: "monthly_needed",
        id: "trip",
        name: "Trip",
        targetDate: "2027-10-20",
        beforeCents: 10_000,
        // ($1,200 + $240) over 12 months.
        afterCents: 12_000,
      },
    ]);
  });

  it("leaves a goal alone when the purchase comes after its date", () => {
    const soon = { ...TRIP, targetDate: "2026-12-20", targetCents: 20_000 };
    expect(check({ kind: "purchase", amountCents: 24_000, date: "2027-01-10" }, [soon])).toEqual([
      expect.objectContaining({ beforeCents: 10_000, afterCents: 10_000 }),
    ]);
  });

  it("moves the date a goal is reached by when less goes to it each month", () => {
    expect(check({ kind: "monthly", amountCents: 5_000, startMonth: "2026-10" })).toEqual([
      {
        kind: "reached_by",
        id: "trip",
        name: "Trip",
        beforeMonthlyCents: 10_000,
        afterMonthlyCents: 5_000,
        before: "2027-10-20",
        after: "2028-10-20",
      },
    ]);
  });

  it("keeps the old pace until the starting month", () => {
    // Six months at $100 (October to March), then $50 a month for twelve more.
    const [goal] = check({ kind: "monthly", amountCents: 5_000, startMonth: "2027-04" });
    expect(goal).toMatchObject({ before: "2027-10-20", after: "2028-04-20" });
  });

  it("brings a goal closer with a monthly cut", () => {
    const [goal] = check({ kind: "monthly", amountCents: -10_000, startMonth: "2026-10" });
    expect(goal).toMatchObject({ afterMonthlyCents: 20_000, after: "2027-04-20" });
  });

  it("says a goal isn't reached when nothing is left for it", () => {
    const [goal] = check({ kind: "monthly", amountCents: 15_000, startMonth: "2026-10" });
    expect(goal).toMatchObject({ afterMonthlyCents: 0, after: null });
  });

  it("leaves out goals already reached or past their date", () => {
    const reached = { ...TRIP, id: "done", savedCents: 120_000 };
    const passed = { ...TRIP, id: "late", targetDate: "2026-10-01" };
    expect(check({ kind: "purchase", amountCents: 100, date: AS_OF }, [reached, passed])).toEqual(
      [],
    );
  });
});
