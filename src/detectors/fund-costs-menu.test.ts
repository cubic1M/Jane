import { describe, expect, it } from "vitest";
import { PEOPLE } from "@/config/people";
import { inputFor } from "@/profile/sample";
import { menuRowsOf } from "./fund-costs";

// CodeRabbit sweep 1b: "your plan offers cheaper" came from the demo plan's menu and reached
// real accounts, naming a fund their plan may not have.
describe("the 401(k) menu claim", () => {
  it("is made for the demo's plan, and never for a real account", () => {
    let withRows = 0;
    for (const p of PEOPLE) {
      const data = inputFor(p.id);
      const rows = menuRowsOf(data);
      if (rows.length > 0) withRows++;
      expect(menuRowsOf(data, true)).toEqual(rows);
      expect(menuRowsOf(data, false), p.id).toEqual([]);
    }
    expect(withRows).toBeGreaterThan(0);
  });
});
