import { describe, expect, it } from "vitest";
import { escrowCheck } from "./home-equity";
import { pmiTimelineLines } from "@/lib/jane-agent/home-equity-replies";
import { pmiTimeline } from "./home-equity";

// CodeRabbit sweep 1b: an escrow check with one bill not entered counted it as $0 and could tell
// the person the servicer over-collects; and PMI "has to end by itself" was said when extra
// payments had taken the balance under 78%, when only the original schedule ends it.
describe("escrow check with one bill not entered", () => {
  const base = { paymentCents: 250_000, paymentPiCents: 190_000, escrowBalanceCents: 100_000 };
  it("is unknown, not over, when the insurance bill is missing", () => {
    expect(escrowCheck({ ...base, yearlyTaxCents: 400_000, yearlyInsuranceCents: null })).toEqual({
      kind: "unknown",
      why: "one_bill",
    });
    expect(escrowCheck({ ...base, yearlyTaxCents: null, yearlyInsuranceCents: 100_000 }).kind).toBe(
      "unknown",
    );
  });
  it("a 0 insurance bill is a bill", () => {
    expect(
      escrowCheck({ ...base, yearlyTaxCents: 700_000, yearlyInsuranceCents: 0 }).kind,
    ).not.toBe("unknown");
  });
});

describe("PMI wording under 78% from extra payments", () => {
  it("does not say PMI has to end by itself now", () => {
    const t = pmiTimeline({
      originalValueCents: 40_000_000,
      balanceCents: 31_000_000,
      aprBps: 399,
      paymentPiCents: 200_000,
      today: "2026-10-18",
    });
    expect(t.endsNow).toBe(true);
    const text = pmiTimelineLines(t).join(" ");
    expect(text).not.toMatch(/has to end by itself/);
    expect(text).toMatch(/original payment schedule/);
  });
});
