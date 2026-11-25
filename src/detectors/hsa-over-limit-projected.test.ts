import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c, PR 2266 (comment 4695930958): a married filer's HSA card with cover not told
// says the deposits "are over" the self-only limit only when what's in already is over it; when only
// the pace to December passes it, the title says "could".

const card = (contributedCents: number, today = "2026-06-17") => {
  const base = inputFor("equity");
  const data: ProfileInput = {
    ...base,
    today,
    told: { ...base.told, household: "couple" as never },
    // The year's HSA deposits as a payroll report gives them, in place of the account's rows.
    extras: { ...base.extras, hsaContributions: { cents: contributedCents, count: 6 } } as never,
  };
  return runDetectors({ profile: buildProfile(data), data }).find(
    (s) => s.topic === "hsa_over_limit",
  );
};

describe("the HSA cover card's title", () => {
  it("says could, not are, when only the pace to December passes the self-only limit", () => {
    // $3,000 by June is about $6,000 for the year: past $4,400 self-only, within the family limit.
    const s = card(300_000)!;
    expect(s).toBeDefined();
    expect(s.worthCents).toBe(0);
    expect(s.title).toBe("Your HSA deposits could pass the self-only limit at this pace");
    expect(s.title).not.toMatch(/are over/);
  });

  it("says are over once the deposits so far pass the self-only limit", () => {
    // $4,500 by mid-November is about $4,900 for the year: over $4,400, within the family limit.
    const s = card(450_000, "2026-11-17")!;
    expect(s.title).toBe("Your HSA deposits are over the self-only limit");
  });
});
