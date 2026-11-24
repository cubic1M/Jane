import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { inputFor } from "@/profile/sample";
import { regular } from "./spending";

// CodeRabbit sweep 1b: a quarterly charge (January, April, July) passed as a monthly one because
// it fell in three separate months, and was then priced at 12 charges a year.
const data = (dates: string[]) => {
  const d = inputFor("renter");
  return {
    ...d,
    today: "2026-08-01",
    transactions: dates.map((date) => ({
      date,
      amountCents: 9_000,
      description: "CITY WATER",
      pfc: "RENT_AND_UTILITIES_WATER",
      accountId: d.accounts[0]!.id,
    })),
  };
};

describe("regular charges", () => {
  it("counts a monthly bill", () => {
    expect(
      regular(data(["2026-05-10", "2026-06-10", "2026-07-10"])).map((s) => s.description),
    ).toEqual(["CITY WATER"]);
  });
  it("does not count a quarterly one", () => {
    expect(regular(data(["2026-01-10", "2026-04-10", "2026-07-10"]))).toEqual([]);
  });
});
