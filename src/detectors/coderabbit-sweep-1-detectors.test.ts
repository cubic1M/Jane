import { describe, expect, it } from "vitest";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { TAX_DETECTORS } from "./taxes";

// CodeRabbit sweep, part 1 (money figures), src/planning chunk 4 (inherited IRA): the figure
// reproduced against the code first (failing), then fixed.

const spreadOf = (subtype: string) => {
  const d = inputFor("preretire");
  const data = {
    ...d,
    accounts: d.accounts.map((a) => (a.name === "Inherited IRA" ? { ...a, subtype } : a)),
  };
  return runDetectors({ profile: buildProfile(data), data }, TAX_DETECTORS).find(
    (s) => s.topic === "inherited_ira_spread",
  );
};

describe("the inherited IRA's spread estimate", () => {
  it("is not worked out on an inherited Roth, whose qualified withdrawals are not income", () => {
    expect(spreadOf("ira")?.worthCents ?? 0).toBeGreaterThan(0);
    expect(spreadOf("roth")).toBeUndefined();
  });
});
