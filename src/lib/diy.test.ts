import { describe, expect, it } from "vitest";
import { DIY_KITS } from "@/config/diy";
import { ACTION_FOR_FINDING } from "./cards";
import { buildKit } from "./diy";
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

  it("has no kit where there's nothing to do with a link", () => {
    expect(buildKit("move_idle_cash", findingOfType("idle_cash"), null)).toBeNull();
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
