import { describe, expect, it } from "vitest";
import { GAP_ADVICE } from "@/config/insurance";
import { normalize } from "../intents";
import { businessReply } from "./business";
import { parseInsurance } from "./intents";
import type { InsuranceSnapshot } from "./snapshot";

// Spec step 201: asking about business and side-gig cover.

describe("business questions", () => {
  // "Do I need it?" is a decision, answered directly from the same gaps (./decisions.ts).
  it("reads do I need business insurance as the business decision", () => {
    expect(parseInsurance(normalize("do I need business insurance for my side gig"))).toMatchObject(
      { ask: "decide", decision: "business" },
    );
  });

  it.each([
    "does my car insurance cover driving for work",
    "am I covered for my freelance work",
    "do I need professional liability insurance",
  ])("reads %s", (text) => {
    expect(parseInsurance(normalize(text))?.ask).toBe("business");
  });
});

const gap = {
  key: "business_liability" as const,
  kind: "business" as const,
  policyId: null,
  title: "No business insurance on file",
  why: "Your freelance income is business income. Your home, renters and car policies cover your personal life, not a client who is hurt.",
};
const snapshot = (gaps: InsuranceSnapshot["gaps"], advice: boolean) =>
  ({ gaps, advice, policies: [] }) as unknown as InsuranceSnapshot;

describe("businessReply", () => {
  it("lists the gaps as facts, with what to add only in demo advice mode", () => {
    const plain = businessReply(snapshot([gap], false));
    expect(plain.body).toMatch(/No business insurance on file/);
    expect(plain.body).not.toContain(GAP_ADVICE.business_liability.text);
    expect(plain.refs).not.toHaveProperty("advice");

    const advised = businessReply(snapshot([gap], true));
    expect(advised.body).toContain(GAP_ADVICE.business_liability.text);
    expect(advised.refs).toMatchObject({ advice: true });
  });

  it("with no signals, says what personal policies don't cover and makes nothing up", () => {
    const reply = businessReply(snapshot([], true));
    expect(reply.body).toMatch(/cover your personal life, not work/);
    expect(reply.body).not.toContain(GAP_ADVICE.business_liability.text);
  });
});
