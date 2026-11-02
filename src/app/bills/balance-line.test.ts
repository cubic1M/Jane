import { describe, expect, it } from "vitest";
import { balanceLine, unevenPayLine } from "./balance-line";

// Debugger 10-31: "$6,210.40 on Thu, Oct 29, about $6,210.40 today" said the same number twice
// when nothing was due since the statement's day.
describe("balanceLine", () => {
  const label = (iso: string) => iso.slice(5);
  const f = (startOn: string, startCents: number, todayCents: number) => ({
    startOn,
    startCents,
    todayCents,
    days: [{ date: "2026-10-31" }],
  });

  it("says today's balance as today's", () => {
    expect(balanceLine(f("2026-10-31", 621_040, 621_040), label)).toBe("$6,210.40 today");
  });

  it("gives a statement's day, and today's estimate only when it differs", () => {
    expect(balanceLine(f("2026-10-29", 621_040, 621_040), label)).toBe("$6,210.40 on 10-29");
    expect(balanceLine(f("2026-10-28", 8_412, 69_652), label)).toBe(
      "$84.12 on 10-28, about $696.52 today",
    );
  });
});

// Debugger 11-02: "Lowest point about -$1,990.78" for a freelancer earning about $2,700 a month,
// with no word that the forecast counts none of it.
describe("unevenPayLine", () => {
  it("says the low point counts none of their pay, and what has been coming in", () => {
    expect(unevenPayLine(271_333)).toBe(
      "That counts none of your pay, because it comes at uneven times: about $2,713.33 a month lately.",
    );
  });

  it("says nothing with no uneven pay", () => {
    expect(unevenPayLine(null)).toBeNull();
  });
});

// Debugger 11-02: "$5,105.18 today" from a statement that ended 66 days ago.
describe("a balance too old to walk forward", () => {
  it("says when it's from, not today", () => {
    const f = {
      startOn: "2026-11-02",
      startCents: 510_518,
      todayCents: 510_518,
      days: [{ date: "2026-11-02" }],
      staleFrom: "2026-08-28",
    };
    expect(balanceLine(f, (iso) => iso.slice(5))).toBe("$5,105.18 on 08-28, your latest statement");
  });
});
