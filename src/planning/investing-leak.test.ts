import { describe, expect, it } from "vitest";
import { investingLeak } from "./investing-leak";

const s = (topic: string, worthCents: number, worthKind = "saves") => ({
  topic,
  worthCents,
  worthKind,
});

describe("the investing leak", () => {
  it("adds up what is lost each year, biggest first", () => {
    const leak = investingLeak([
      s("investment_fees", 44_000),
      s("employer_match", 118_000, "earns"),
      s("invested_cash", 10_000, "earns"),
      s("asset_location", 3_900),
      s("costly_products", 127_500),
    ]);
    expect(leak.totalCents).toBe(44_000 + 118_000 + 10_000 + 3_900 + 127_500);
    expect(leak.parts.map((p) => p.key)).toEqual(["annuity", "match", "costs", "cash", "tax"]);
  });

  it("counts a fund's cost once when the plan menu and the old plan describe the same dollars", () => {
    const leak = investingLeak([
      s("investment_fees", 44_000),
      s("plan_menu", 30_000),
      s("old_accounts", 12_000),
    ]);
    expect(leak.totalCents).toBe(44_000);
    expect(leak.parts).toHaveLength(1);
    expect(leak.parts[0].topics.sort()).toEqual(["investment_fees", "old_accounts", "plan_menu"]);
  });

  it("leaves out risks, checking and savings cash, and things that aren't leaks", () => {
    const leak = investingLeak([
      s("concentration", 7_000_000, "risk"),
      s("beneficiaries", 900_000, "risk"),
      s("idle_cash", 150_000, "earns"),
      s("short_term_cash", 90_000, "earns"),
      s("catch_up", 165_000),
      s("employer_match", 0, "earns"),
    ]);
    expect(leak).toEqual({ totalCents: 0, parts: [] });
  });

  it("adds tax placement and harvesting, which are different dollars", () => {
    expect(
      investingLeak([s("asset_location", 3_900), s("tax_loss_harvest", 61_000)]).totalCents,
    ).toBe(64_900);
  });
});
