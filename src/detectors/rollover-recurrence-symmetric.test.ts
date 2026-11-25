import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { ROLLOVER_DETECTORS } from "./rollover";

// CodeRabbit sweep 1c (#2270): "about the same amount" has to read the same from either payout,
// or a recurring draw still shows its older payment as a one-off.
const base = inputFor("freelancer");
const account = base.accounts[0]!.id;
const deposit = (date: string, cents: number) => ({
  date,
  amountCents: -cents,
  description: "IRA DISTRIBUTION",
  pfc: "TRANSFER_IN_DEPOSIT",
  accountId: account,
});
const run = (rows: ReturnType<typeof deposit>[]) => {
  const data: ProfileInput = {
    ...base,
    today: "2026-11-06",
    transactions: [...base.transactions, ...rows],
  };
  return runDetectors({ profile: buildProfile(data), data }, ROLLOVER_DETECTORS);
};

describe("the rollover clock's recurrence", () => {
  it("treats 500,000 and 650,000 cents of the same draw as one recurring stream", () => {
    expect(run([deposit("2026-10-25", 650_000), deposit("2026-10-15", 500_000)])).toEqual([]);
  });
  it("still finds two payouts far apart in amount", () => {
    expect(run([deposit("2026-10-25", 700_000), deposit("2026-10-15", 300_000)])).toHaveLength(1);
  });
});
