import { describe, expect, it } from "vitest";
import { DIY_KITS } from "@/config/diy";
import { ACTION_FOR_FINDING, buildCard } from "./cards";
import { buildKit, selfServe } from "./diy";
import { draftPayload } from "./drafts";
import { SECRET_STRINGS, findingOfType, sampleFindings } from "./__fixtures__/findings";
import { checkGuardrails } from "./guardrails";

const NETFLIX = {
  name: "Netflix",
  cancelUrl: "https://www.netflix.com/cancelplan",
  supportUrl: "https://help.netflix.com",
};

const cases = sampleFindings()
  .filter((f) => DIY_KITS[ACTION_FOR_FINDING[f.type]])
  .map((f) => [f.type, f] as const);

describe("buildKit", () => {
  it("links to the merchant's cancel page for a cancellation", () => {
    const kit = buildKit("cancel_subscription", findingOfType("subscription_review"), NETFLIX);
    expect(kit?.link).toEqual({
      label: "Open Netflix's account page",
      url: "https://www.netflix.com/cancelplan",
    });
    expect(kit?.steps.length).toBeGreaterThan(0);
    expect(kit?.email?.mailto).toMatch(/^mailto:\?subject=/);
  });

  it("works without a directory entry, just with no link", () => {
    const kit = buildKit("request_refund", findingOfType("duplicate_charge"), null);
    expect(kit?.link).toBeNull();
    expect(kit?.email?.body).toContain("charged twice");
    expect(kit?.email?.body).toContain("$49.99");
  });

  it("gives bill negotiation a call script instead of an email", () => {
    const kit = buildKit("negotiate_bill", findingOfType("bill_negotiation"), null);
    expect(kit?.email).toBeNull();
    expect(kit?.script?.join(" ")).toContain("loyalty discount");
  });

  // Read-only mode: a real account does every action itself, so every action has its steps.
  it("has a kit for every action, steps only where there's nothing to send", () => {
    for (const actionType of new Set(Object.values(ACTION_FOR_FINDING))) {
      expect(DIY_KITS[actionType]?.steps.length, actionType).toBeGreaterThan(0);
    }
    const cash = buildKit("move_idle_cash", findingOfType("idle_cash"), null);
    expect(cash?.email).toBeNull();
    expect(cash?.script).toBeNull();
    const card = buildKit("card_interest", findingOfType("card_interest"), null);
    expect(card?.script?.join(" ")).toMatch(/lower my rate/);
  });

  it.each(cases)("%s: says nothing private, promises nothing", (type, finding) => {
    const kit = buildKit(ACTION_FOR_FINDING[type], finding, null);
    const text = JSON.stringify(kit);
    for (const secret of SECRET_STRINGS) expect(text).not.toContain(secret);
    const allowed = draftPayload(ACTION_FOR_FINDING[type], finding)?.allowedCents ?? [];
    const words = [kit?.email?.subject, kit?.email?.body, ...(kit?.script ?? [])].join("\n");
    expect(checkGuardrails(words, allowed)).toEqual({ ok: true });
    expect(text).not.toMatch(/guarantee|will save|promise/i);
  });
});

describe("selfServe (read-only mode)", () => {
  it("says what the person does, never what we do, and keeps everything else", () => {
    for (const finding of sampleFindings()) {
      const card = buildCard({
        ...finding,
        id: `f-${finding.key}`,
        explanation: null,
        explanationHash: null,
      });
      const shown = selfServe(card);
      expect(shown.whatChanges).toBe(DIY_KITS[card.actionType]?.summary);
      expect(shown.whatChanges).toMatch(/^You /);
      expect(shown.whatChanges).not.toMatch(/\b(we|our team)\b/i);
      expect({ ...shown, whatChanges: card.whatChanges }).toEqual(card);
    }
  });
});

// The steps show after "Show me how", where the finding's comparison and figures above are gone
// (demo-video list: "Pick a savings account from the comparison above" with nothing above).
describe("the do-it-yourself steps", () => {
  it("stand on their own, pointing at nothing above them", () => {
    for (const [type, kit] of Object.entries(DIY_KITS)) {
      for (const step of kit?.steps ?? []) expect(step, type).not.toMatch(/\babove\b/i);
    }
  });
});
