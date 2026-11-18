import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { BILL_FACT_DETECTORS } from "./cover-facts";
import { runDetectors } from "./index";
import { SPENDING_DETECTORS } from "./spending";

// Debugger 11-18 (r349, 14 months of Wells Fargo checking paying T-Mobile $85 a month, on a
// phone): the dock had "Note T-Mobile's cheapest plan, save $261 a year" and "Ask for a lower bill
// rate, save $122 a year", two cards for one phone bill. The plan card says it with T-Mobile's own
// plan; the ask card keeps to the bills it alone covers.

const bill = (date: string, cents: number, description: string, pfc: string) => ({
  date,
  amountCents: cents,
  description,
  pfc,
  accountId: "x",
});
const months = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const withBills = (internet: boolean): ProfileInput => {
  const base = inputFor("freelancer");
  return {
    ...base,
    transactions: [
      ...base.transactions.filter((t) => !/T-MOBILE|COMCAST|XFINITY|VERIZON/i.test(t.description)),
      ...months.map((m) =>
        bill(`${m}-12`, 8_500, "T-MOBILE AUTO PAY", "RENT_AND_UTILITIES_TELEPHONE"),
      ),
      ...(internet
        ? months.map((m) =>
            bill(`${m}-14`, 8_999, "COMCAST CABLE COMM", "RENT_AND_UTILITIES_INTERNET_AND_CABLE"),
          )
        : []),
    ],
  };
};
const fired = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, [
    ...SPENDING_DETECTORS,
    ...BILL_FACT_DETECTORS,
  ]);

describe("a phone bill a cheaper plan is under", () => {
  it("is one card, the plan's", () => {
    const topics = fired(withBills(false)).map((s) => s.topic);
    expect(topics).toContain("phone_plan_cheaper");
    expect(topics).not.toContain("bill_negotiation");
  });

  it("leaves the ask card to the internet bill beside it", () => {
    const ask = fired(withBills(true)).find((s) => s.topic === "bill_negotiation")!;
    expect(ask).toBeDefined();
    expect(ask.short).toMatch(/Comcast/);
    expect(ask.short).not.toMatch(/T-Mobile/);
  });
});
