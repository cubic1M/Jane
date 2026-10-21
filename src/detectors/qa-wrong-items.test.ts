import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { reportFor } from "@/detectors/harness";
import { PEOPLE } from "@/config/people";
import { DETECTOR_RATES as R } from "@/config/detectors";
import { lineOf } from "@/lib/jane-agent/agenda";
import { coverBody } from "@/lib/jane-agent/insurance/cover-words";
import { worthPhrase } from "@/lib/jane-agent/sources/suggestions";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";

// QA's wrong items on the eight people (qa-report.md), each pinned on the person named.

const person = (id: string) => PEOPLE.find((p) => p.id === id)!;
const topic = (id: string, t: string) => reportFor(person(id)).fired.find((s) => s.topic === t);

describe("QA's wrong items", () => {
  it("Jo's retirement figure counts profit, not sales: the same 15% as his estimated taxes", () => {
    const data = inputFor("owner");
    const sales = buildProfile(data).facts.monthly_income.value as number;
    const s = topic("owner", "retirement_self_employed")!;
    const profit = Math.round(sales * 12 * R.tax.businessProfitShare);
    expect(s.why).toContain(
      `about $${(profit / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    );
    expect(s.worthCents).toBe(Math.round(profit * R.selfRetireShare * R.selfRetireTaxRate));
    expect(s.confidence.reason).toMatch(/assumed 15% is profit/);
    // A freelancer's deposits are pay: unchanged.
    const sam = topic("freelancer", "retirement_self_employed")!;
    expect(sam.why).toMatch(/a tenth of your income/);
  });

  it("the Reyes' repair claim is money back once, not a year", () => {
    const claim = topic("family", "insurance_claim")!;
    expect(worthPhrase(claim)).toMatch(/^could get you back about \$[\d,.]+, once$/);
    expect(worthPhrase(claim)).not.toMatch(/a year/);
    expect(worthPhrase(topic("family", "pmi_removal")!)).toMatch(/a year$/);
  });

  it("the agenda keeps a list's items, not just the sentence that introduces it", () => {
    const body = coverBody(
      "car_bought",
      [
        {
          id: "c1",
          event: "car_bought",
          eventKey: "k",
          change: "add_vehicle",
          policyId: "p1",
          detail: { vehicle: "Demo car" },
          status: "prepared",
          newPremiumCents: null,
          confirmation: null,
          doneBy: null,
        } as never,
      ],
      [{ id: "p1", kind: "auto", carrier: "GEICO", premiumCents: 14_200 } as never],
      true,
    );
    const line = lineOf({
      body,
      kind: "decision",
      refs: {},
      actions: [],
      dedupeKey: "x",
      priority: 1,
    });
    expect(line).toMatch(
      /^You've got a new car\. Here's what I've got ready for your insurance: Add Demo car/,
    );
  });
});
