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

  // Debugger 10-30: "Please refund the following charges … I was charged twice for one
  // purchase", then both $46.18 charges: the person would ask for $92.36 back, not $46.18.
  it("asks for the one extra charge back on a double charge, not both", () => {
    const body = buildKit("request_refund", findingOfType("duplicate_charge"), null)?.email?.body;
    expect(body).toContain("I was charged twice for one purchase");
    expect(body).toMatch(/Please refund the extra charge of \$49\.99\./);
    expect(body).not.toContain("Please refund the following charges");
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

  // Debugger 11-01: the overlapping-services card names no one service (the person picks which
  // to cancel), and its email read "Please cancel my your company subscription".
  it.each(cases)("%s: reads as a sentence when the company isn't named", (type, finding) => {
    const kit = buildKit(ACTION_FOR_FINDING[type], finding, null);
    const words = [kit?.email?.body, ...(kit?.script ?? [])].join("\n");
    expect(words).not.toMatch(/\bmy your\b/i);
  });

  it("asks to cancel the subscription on the overlapping-services card", () => {
    const body = buildKit("cancel_subscription", findingOfType("duplicate_subscription"), null)
      ?.email?.body;
    expect(body).toContain("Please cancel my subscription and confirm");
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

// Debugger 10-30: an Amex Gold's $325 annual fee got the overdraft card: "Ask them to refund the
// fees listed as a courtesy", "Turn off overdraft coverage". An annual fee is waived, met with a
// retention offer, or left by moving to the same company's no-fee card.
describe("a card's annual fee", () => {
  const annualFee = {
    id: "f-annual",
    key: "account:amex",
    type: "bank_fees" as const,
    title: "$325.00 in fees on Amex Gold in the last 3 months",
    annualSavingsCents: 32_500,
    explanation: null,
    explanationHash: null,
    evidence: {
      accountId: "amex",
      accountName: "Amex Gold",
      totalCents: 32_500,
      months: 3,
      transactions: [
        { id: "t1", date: "2026-08-14", amountCents: 32_500, description: "ANNUAL MEMBERSHIP FEE" },
      ],
    },
  };

  it("gets steps to waive it or downgrade, and a call script, not a refund email", () => {
    const kit = buildKit("recover_bank_fees", annualFee, null);
    expect(kit?.steps.join(" ")).toMatch(/waive/i);
    expect(kit?.steps.join(" ")).toMatch(/no-fee/i);
    expect(kit?.email).toBeNull();
    expect(kit?.script?.join(" ")).toMatch(/annual fee/i);
  });

  it("says what the person does about an annual fee", () => {
    const card = buildCard(annualFee);
    expect(selfServe(card).whatChanges).toMatch(/annual fee/i);
    expect(card.explanation).toMatch(/annual fee/i);
    expect(card.explanation).not.toMatch(/refund fees when asked/i);
    expect(card.alternatives.join(" ")).not.toMatch(/overdraft/i);
  });

  it("leaves other fees on the refund kit", () => {
    const atm = {
      ...annualFee,
      evidence: {
        ...annualFee.evidence,
        transactions: [
          { id: "t2", date: "2026-08-11", amountCents: 350, description: "NON-WF ATM FEE" },
        ],
      },
    };
    expect(buildKit("recover_bank_fees", atm, null)?.steps.join(" ")).toMatch(/refund/i);
    expect(selfServe(buildCard(atm)).whatChanges).toBe(DIY_KITS.recover_bank_fees?.summary);
  });
});
