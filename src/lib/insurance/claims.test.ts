import { describe, expect, it } from "vitest";
import { CLAIM_CONTACT_FALLBACK, CLAIM_GUIDES } from "@/config/claims";
import { POLICY_KINDS, type PolicyKind } from "@/config/insurance";
import { normalize, parseIntent } from "@/lib/jane-agent/intents";
import { guideBody, trackerActions, trackerBody } from "@/lib/jane-agent/insurance/claim-words";
import { claimContact, nextStep, reminderDue, type Claim } from "./claim-rules";

// The claims helper's rules (spec step 107). Pure.

const claim = (over: Partial<Claim> = {}): Claim => ({
  id: "c1",
  policyId: "p1",
  kind: "auto",
  event: "accident",
  happenedOn: "2026-10-19",
  status: "open",
  steps: [
    { key: "police", label: "Get the police report number", dueOn: "2026-10-20", doneAt: null },
    { key: "file", label: "Call your insurer", dueOn: "2026-10-20", doneAt: null },
  ],
  carrier: "GEICO",
  claimsPhone: null,
  claimsUrl: null,
  claimNumber: null,
  createdAt: new Date("2026-10-19T16:00:00Z"),
  ...over,
});

describe("claim guides", () => {
  it.each(Object.keys(POLICY_KINDS) as PolicyKind[])(
    "has what to do now, what to collect and steps to a payment for %s",
    (kind) => {
      const guide = CLAIM_GUIDES[kind];
      expect(Object.keys(guide.events).length).toBeGreaterThan(0);
      expect(guide.now.length).toBeGreaterThan(0);
      expect(guide.collect.length).toBeGreaterThan(0);
      expect(guide.steps.at(-1)?.key).toBe("paid");
      // Keys are stored on claims: unique, and due in order.
      const keys = guide.steps.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
      const due = guide.steps.map((s) => s.dueDays);
      expect([...due].sort((a, b) => a - b)).toEqual(due);
      for (const event of Object.keys(guide.events)) {
        expect(guideBody(kind, event, null, { phone: null, url: null })).toContain(
          guide.collect[0],
        );
      }
    },
  );
});

describe("the tracker", () => {
  it("moves to the next step not done, and says when everything is done", () => {
    expect(nextStep(claim())?.key).toBe("police");
    const one = claim({
      steps: [{ ...claim().steps[0], doneAt: "2026-10-19T17:00:00Z" }, claim().steps[1]],
    });
    expect(nextStep(one)?.key).toBe("file");
    expect(trackerBody(one)).toBe(
      "Your claim tracker with GEICO: a car accident on Oct 19. 1 of 2 steps done.\nNext: Call your insurer (by Oct 20).",
    );
    expect(trackerActions(one).map((a) => a.id)).toEqual(["insurance.claim_step", "open"]);
    const all = claim({ steps: one.steps.map((s) => ({ ...s, doneAt: "2026-10-20T00:00:00Z" })) });
    expect(nextStep(all)).toBeNull();
    expect(trackerBody(all)).toContain(
      "Every step is done. Close the claim once you've been paid.",
    );
    expect(trackerActions(all).map((a) => a.id)).toEqual(["insurance.claim_close", "open"]);
  });

  it("reminds when the next step is due, then every few days, never for a closed claim", () => {
    expect(reminderDue(claim(), "2026-10-19")).toBeNull();
    expect(reminderDue(claim(), "2026-10-20")).toMatchObject({ step: { key: "police" }, round: 0 });
    expect(reminderDue(claim(), "2026-10-23")).toMatchObject({ round: 1 });
    expect(reminderDue(claim({ status: "closed" }), "2026-10-23")).toBeNull();
  });

  it("gives a stand-in carrier's claims line, never a guessed one for a real insurer", () => {
    expect(claimContact("Lighthouse Insurance (demo)")).toEqual({
      phone: "1-800-555-0101",
      url: "https://example.com/jane-demo/carriers/lighthouse/claims",
    });
    expect(claimContact("GEICO")).toEqual({ phone: null, url: null });
    expect(
      guideBody("auto", "accident", { carrier: "GEICO", kind: "auto" }, claimContact("GEICO")),
    ).toContain(`Your insurer: GEICO. ${CLAIM_CONTACT_FALLBACK} It's on your car insurance.`);
  });
});

describe("what happened, in the person's words", () => {
  it.each([
    ["I had a car accident", "auto", "accident"],
    ["someone rear-ended me", "auto", "accident"],
    ["my car was stolen", "auto", "theft"],
    ["someone broke into my apartment", "home", "break_in"],
    ["we had a flood in the basement", "home", "damage"],
    ["my bike got stolen", "home", "theft"],
    ["my dog is sick and we went to the vet", "pet", "vet"],
    ["my dad passed away", "life", "death"],
    ["I got a surprise hospital bill", "health", "bill"],
    // Spec step 149.
    ["my phone was stolen", "device", "theft"],
    ["I cracked my phone screen", "device", "broken"],
    ["our flight got cancelled", "travel", "cancelled"],
    ["I can't work after my surgery", "disability", "unable"],
    ["my neighbor is suing me", "umbrella", "sued"],
  ])("reads %j as a claim", (text, policyKind, event) => {
    expect(parseIntent(text, "2026-10-19")).toEqual({
      kind: "insurance",
      ask: "claim",
      policyKind,
      event,
    });
  });

  it("leaves questions about cover alone", () => {
    expect(parseIntent("am I covered if my car is stolen", "2026-10-19")).toMatchObject({
      ask: "cover",
    });
    expect(parseIntent("what happens if there's a flood", "2026-10-19")).not.toMatchObject({
      ask: "claim",
    });
  });

  it("asks which policy when only a claim is mentioned", () => {
    expect(parseIntent("I need to file a claim on my car insurance", "2026-10-19")).toEqual({
      kind: "insurance",
      ask: "claim",
      policyKind: "auto",
    });
    expect(normalize("Jane, I had an accident!")).toBe("i had an accident");
  });
});
