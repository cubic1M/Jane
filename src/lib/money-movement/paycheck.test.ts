import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { AS_OF, input, tx } from "@/detection/__fixtures__/build";
import { addDays } from "@/detection/units";
import { latestPaycheck } from "./paycheck";

// The paycheck split reads step 182's paydays (docs/feature-audit.md, cluster 11): a weekly
// paycheck comes 52 / 12 times a month, not 4, so each paycheck's share of the month is right.
const paychecks = (everyDays: number, count: number) =>
  Array.from({ length: count }, (_, i) =>
    tx({
      date: addDays(AS_OF, -everyDays * (count - 1 - i)),
      amountCents: -150_000,
      description: "ACME CORP PAYROLL",
      pfcPrimary: "INCOME",
      pfcDetailed: "INCOME_SALARY",
    }),
  );

describe("latestPaycheck", () => {
  it("counts a weekly paycheck as 52 / 12 a month, and one every two weeks as 26 / 12", () => {
    expect(latestPaycheck(input({ transactions: paychecks(7, 12) }))).toMatchObject({
      date: AS_OF,
      cents: 150_000,
      perMonth: 52 / 12,
    });
    expect(latestPaycheck(input({ transactions: paychecks(14, 8) }))?.perMonth).toBe(26 / 12);
  });

  it("is nothing without a paycheck in the last few days", () => {
    expect(latestPaycheck(input({ transactions: [] }))).toBeNull();
  });
});
