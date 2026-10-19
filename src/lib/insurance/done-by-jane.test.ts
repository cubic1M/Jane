import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { parseIntent } from "@/lib/jane-agent/intents";
import {
  askCallBody,
  callResultBody,
  claimStatusBody,
  draftBody,
} from "@/lib/jane-agent/insurance/done-by-jane-words";
import type { Claim } from "./claim-rules";
import { demoPartner } from "./demo-partner";
import type { Negotiation } from "./negotiate";

// Renewal negotiation and claims, done by Jane (spec step 155): the stand-in carrier's
// answers, and how Jane says them. Pure.

const NOW = new Date("2026-10-19T16:00:00Z");
const DAY = 86_400_000;

describe("the stand-in carrier on a renewal call", () => {
  const ask = (competing: number | null) =>
    demoPartner.negotiateRenewal(
      {
        carrier: "GEICO",
        kind: "auto",
        currentAnnualCents: 170_400,
        renewalAnnualCents: 204_000,
        competingAnnualCents: competing,
      },
      { now: NOW },
    );

  it("meets a cheaper like-for-like quote closely, never below today's price", async () => {
    expect(await ask(180_000)).toMatchObject({ outcome: "lowered", annualPremiumCents: 183_600 });
    expect((await ask(100_000)).annualPremiumCents).toBe(170_400);
  });

  it("takes off half the rise for a loyal customer, and offers a cover change that's never taken", async () => {
    const result = await ask(null);
    expect(result).toMatchObject({
      outcome: "lowered",
      annualPremiumCents: 187_200,
      offer: "a higher deductible for a lower price",
    });
    expect(result.transcript.at(-1)).toBe(
      "Jane: Thanks, I'll pass that on; I can't change the cover on this call.",
    );
  });
});

describe("the stand-in carrier on a claim", () => {
  it("moves from received to paid, less the deductible", async () => {
    const claim = { claimNumber: "X", filedAt: NOW, amountCents: 60_000, deductibleCents: 25_000 };
    const at = (days: number) =>
      demoPartner.claimStatus(claim, { now: new Date(NOW.getTime() + days * DAY) });
    expect(await at(0)).toEqual({ status: "received", payoutCents: null });
    expect(await at(3)).toEqual({ status: "reviewing", payoutCents: null });
    expect(await at(6)).toEqual({ status: "approved", payoutCents: 35_000 });
    expect(await at(11)).toEqual({ status: "paid", payoutCents: 35_000 });
  });
});

describe("in the chat", () => {
  const negotiation: Negotiation = {
    id: "n1",
    policyId: "p1",
    key: "k",
    currentAnnualCents: 170_400,
    renewalAnnualCents: 204_000,
    competingAnnualCents: 180_000,
    status: "asked",
    resultAnnualCents: null,
    transcript: [],
    offer: null,
    calledBy: null,
  };
  const policy = { carrier: "GEICO", kind: "auto" as const };

  it("asks before calling, saying it only asks for a lower price", () => {
    expect(askCallBody(negotiation, policy).split("\n")).toEqual([
      "Your GEICO car policy renews at $2,040.00 a year, up from $1,704.00. Want me to call GEICO and ask for a better rate?",
      "I'm shopping it at the same time: the same cover is $1,800.00 a year elsewhere, which I'll mention on the call.",
      "I'll only ask for a lower price; I won't change your cover on the call.",
    ]);
  });

  it("says what the insurer agreed, and what it offered that Jane didn't take", () => {
    expect(
      callResultBody(
        {
          ...negotiation,
          status: "lowered",
          resultAnnualCents: 183_600,
          calledBy: "autopilot",
          offer: "a higher deductible for a lower price",
        },
        policy,
      ).split("\n"),
    ).toEqual([
      "On autopilot, I called GEICO: they'll renew your GEICO car policy at $1,836.00 a year instead of $2,040.00, the same cover. That saves $204.00 a year.",
      "They also offered a higher deductible for a lower price. I didn't take it; tell me if you want it.",
    ]);
    expect(callResultBody({ ...negotiation, status: "kept" }, policy)).toBe(
      "I called GEICO: they won't go below $2,040.00 a year for your GEICO car policy. The same cover is $1,800.00 a year elsewhere: see the quotes.",
    );
  });

  const claim: Claim = {
    id: "c1",
    policyId: "p1",
    kind: "device",
    event: "broken",
    happenedOn: "2026-10-17",
    status: "open",
    steps: [],
    carrier: "Bluepeak Mutual (demo)",
    claimsPhone: null,
    claimsUrl: null,
    claimNumber: null,
    createdAt: NOW,
    amountCents: 32_900,
    description: "Dropped my phone and the screen cracked.",
    filing: "draft",
  };

  it("shows the draft before anything is filed", () => {
    expect(draftBody(claim).split("\n")).toEqual([
      "Here's the claim I'd file with Bluepeak Mutual (demo). Nothing goes until you tap File it.",
      "- What happened: Dropped my phone and the screen cracked.",
      "- On: 2026-10-17",
      "- Claiming: $329.00",
    ]);
  });

  it("says the insurer's news on the claim", () => {
    const filed = { ...claim, filing: "filed" as const, claimNumber: "DEMO-CLM-1" };
    expect(claimStatusBody({ ...filed, carrierStatus: "reviewing" })).toBe(
      "Bluepeak Mutual (demo) is reviewing your claim (number DEMO-CLM-1).",
    );
    expect(claimStatusBody({ ...filed, carrierStatus: "paid", payoutCents: 27_900 })).toBe(
      "Bluepeak Mutual (demo) paid your claim (number DEMO-CLM-1). They paid $279.00, so I've closed the claim.",
    );
  });

  it("reads asks to negotiate a renewal and to file a claim", () => {
    for (const text of [
      "ask my insurance company for a better renewal rate",
      "haggle with my insurer",
      "ring the insurer about my renewal price",
    ]) {
      expect(parseIntent(text, "2026-10-19"), text).toMatchObject({
        kind: "insurance",
        ask: "renewal_call",
      });
    }
    for (const text of [
      "will you file my claim for me",
      "could you file my claim with the insurer",
      "file it with my insurer",
    ]) {
      expect(parseIntent(text, "2026-10-19"), text).toMatchObject({ ask: "file_claim" });
    }
  });
});
