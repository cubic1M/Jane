import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { ROLLOVER_DETECTORS } from "./rollover";

// CodeRabbit sweep 1c, det-03 findings 1 and 2.
const TODAY = "2026-11-06";
const base = inputFor("freelancer");
const account = base.accounts[0]!.id;
const deposit = (description: string, date: string, cents: number) => ({
  date,
  amountCents: -cents,
  description,
  pfc: "TRANSFER_IN_DEPOSIT",
  accountId: account,
});
const run = (rows: ReturnType<typeof deposit>[]) => {
  const data: ProfileInput = {
    ...base,
    today: TODAY,
    transactions: [...base.transactions, ...rows],
  };
  return runDetectors({ profile: buildProfile(data), data }, ROLLOVER_DETECTORS);
};

describe("the rollover clock", () => {
  it("says nothing of a required minimum distribution, which cannot be rolled over", () => {
    expect(run([deposit("IRA REQUIRED MINIMUM DISTRIBUTION", "2026-10-20", 500_000)])).toEqual([]);
    expect(run([deposit("401K HARDSHIP WITHDRAWAL", "2026-10-20", 500_000)])).toEqual([]);
    expect(run([deposit("IRA DISTRIBUTION", "2026-10-20", 500_000)])).toHaveLength(1);
  });

  it("says the payout may not be eligible", () => {
    const [s] = run([deposit("IRA DISTRIBUTION", "2026-10-20", 500_000)]);
    expect(s!.why).toMatch(/can be rolled over at all/);
  });

  it("finds two old plans' one-off payouts that share a description", () => {
    const s = run([
      deposit("401K DISTRIBUTION", "2026-10-25", 700_000),
      deposit("401K DISTRIBUTION", "2026-10-15", 300_000),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0]!.worthCents).toBe(700_000);
  });

  it("still leaves out a draw that repeats at about the same amount", () => {
    expect(
      run([
        deposit("IRA DISTRIBUTION", "2026-10-15", 150_000),
        deposit("IRA DISTRIBUTION", "2026-09-15", 150_000),
      ]),
    ).toEqual([]);
  });
});
