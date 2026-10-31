import { describe, expect, it } from "vitest";
import { balanceLine } from "./balance-line";

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
