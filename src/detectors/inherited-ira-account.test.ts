import { describe, expect, it } from "vitest";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { TAX_DETECTORS } from "./taxes";

// CodeRabbit sweep 1b: a taxable account named "Inherited Brokerage" got the inherited-IRA
// 10-year deadline and a 25% penalty; and "all of it is taxed" was said over a Roth part.
const cards = (id: "retiree" | "preretire", subtype: string) => {
  const d = inputFor(id);
  const data = {
    ...d,
    accounts: d.accounts.map((a) =>
      /inherit/i.test(a.name ?? "") && a.type === "investment" ? { ...a, subtype } : a,
    ),
  };
  return runDetectors({ profile: buildProfile(data), data }, TAX_DETECTORS);
};

describe("which accounts the inherited-IRA cards read", () => {
  it("fires for an inherited IRA", () => {
    expect(cards("retiree", "ira").map((s) => s.topic)).toContain("inherited_ira");
  });
  it("does not fire for an inherited brokerage account", () => {
    const topics = cards("retiree", "brokerage").map((s) => s.topic);
    expect(topics).not.toContain("inherited_ira");
    expect(cards("preretire", "brokerage").map((s) => s.topic)).not.toContain(
      "inherited_ira_spread",
    );
  });
  it("doesn't say all of an inherited Roth is taxed", () => {
    const why = cards("retiree", "roth").find((s) => s.topic === "inherited_ira")?.why ?? "";
    expect(why).not.toMatch(/All of it is taxed/);
  });
});
