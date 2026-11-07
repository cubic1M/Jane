import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { ROLLOVER_CLOCK } from "@/config/retirement";
import { recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { ROLLOVER_DETECTORS } from "./rollover";

// Connectors roadmap round 17: the 60-day rollover clock.

const TODAY = "2026-11-06";

const withDeposit = (
  description: string,
  date: string,
  amountCents = -1_240_000,
  today = TODAY,
) => {
  const base = inputFor("freelancer");
  const data: ProfileInput = {
    ...base,
    today,
    transactions: [
      ...base.transactions,
      {
        date,
        amountCents,
        description,
        pfc: "TRANSFER_IN_DEPOSIT",
        accountId: base.accounts[0]!.id,
      },
    ],
  };
  return runDetectors({ profile: buildProfile(data), data }, ROLLOVER_DETECTORS)[0] ?? null;
};

describe("the rollover clock", () => {
  it("gives the date a plan payout can still be rolled over, and the 20% a plan withholds", () => {
    const s = withDeposit("FIDELITY 401K DISTRIBUTION", "2026-10-03")!;
    expect(s.topic).toBe("rollover_clock");
    expect(s.worthCents).toBe(1_240_000);
    expect(s.title).toBe(
      "A $12,400.00 retirement payout can still be rolled over until December 2, 2026",
    );
    // $12,400 arriving after 20% withheld means $3,100 was withheld.
    expect(s.why).toContain("about $3,100.00 if it did");
    expect(s.why).toContain("within 60 days");
    expect(s.urgency).toBe("soon");
    expect(s.more?.[0]?.href).toBe(ROLLOVER_CLOCK.source);
    expect(recommendsAChoice(`${s.title} ${s.short} ${s.why}`)).toBe(false);
  });

  it("is urgent in its last two weeks, and gone after day 60", () => {
    expect(withDeposit("IRA DISTRIBUTION", "2026-09-21")!.urgency).toBe("now");
    expect(withDeposit("IRA DISTRIBUTION", "2026-09-07")).not.toBeNull();
    expect(withDeposit("IRA DISTRIBUTION", "2026-09-06")).toBeNull();
  });

  it("needs both a plan or IRA and a payout in the words, money in, and enough of it", () => {
    expect(withDeposit("FIDELITY TRANSFER", "2026-10-20")).toBeNull();
    expect(withDeposit("ACME PAYROLL 401K", "2026-10-20")).toBeNull();
    expect(withDeposit("401K DISTRIBUTION", "2026-10-20", 1_240_000)).toBeNull();
    expect(withDeposit("401K DISTRIBUTION", "2026-10-20", -50_000)).toBeNull();
    expect(withDeposit("PENSION PAYOUT", "2026-10-20")).not.toBeNull();
  });

  it("uses the latest payout when there are several", () => {
    const base = inputFor("freelancer");
    const account = base.accounts[0]!.id;
    const data: ProfileInput = {
      ...base,
      today: TODAY,
      transactions: [
        ...base.transactions,
        {
          date: "2026-09-20",
          amountCents: -500_000,
          description: "IRA DIST",
          pfc: null,
          accountId: account,
        },
        {
          date: "2026-10-30",
          amountCents: -800_000,
          description: "403B DISTRIBUTION",
          pfc: null,
          accountId: account,
        },
      ],
    };
    const s = runDetectors({ profile: buildProfile(data), data }, ROLLOVER_DETECTORS)[0]!;
    expect(s.worthCents).toBe(800_000);
    expect(s.title).toContain("December 29, 2026");
  });

  it("leaves out a payout that comes regularly, like a monthly IRA draw", () => {
    const base = inputFor("freelancer");
    const account = base.accounts[0]!.id;
    const data: ProfileInput = {
      ...base,
      today: TODAY,
      transactions: [
        ...base.transactions,
        ...["2026-08-15", "2026-09-15", "2026-10-15"].map((date) => ({
          date,
          amountCents: -150_000,
          description: "IRA DISTRIBUTION",
          pfc: null,
          accountId: account,
        })),
      ],
    };
    expect(runDetectors({ profile: buildProfile(data), data }, ROLLOVER_DETECTORS)).toEqual([]);
  });

  it("finds nothing for the sample people: the retiree's IRA draw is monthly", () => {
    for (const person of PEOPLE) {
      const data = inputFor(person.id);
      expect(
        runDetectors({ profile: buildProfile(data), data }, ROLLOVER_DETECTORS),
        person.id,
      ).toEqual([]);
    }
  });
});
