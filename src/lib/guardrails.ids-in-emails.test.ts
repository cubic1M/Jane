import { describe, expect, it } from "vitest";
import { findingOfType } from "@/lib/__fixtures__/findings";
import { PLACEHOLDERS, draftMessage, draftPayload } from "@/lib/drafts";
import { checkGuardrails } from "./guardrails";

// Main went red on 11-14 (concierge-safety.integration.test.ts): the person's email carried a random
// UUID, and "…-efd3-403b-adb6-…" read as a 403(b), so the agent held its first email. These are ids
// that tripped it; an id is never advice.
const TRIPPED = [
  "403bbbd6-0f53-4464-8df4-6a5f3075a550",
  "5d036367-efd3-403b-adb6-aeb6304539f7",
  "1120fd97-34ad-457b-8d1b-5acccf7ec928",
  "c11f9f8b-5713-403b-a79b-bc451534b422",
];

describe("an id in an email address", () => {
  it.each(TRIPPED)(
    "lets the agent's refund request through for safety-%s@example.com",
    async (id) => {
      const finding = findingOfType("duplicate_charge");
      const draft = await draftMessage("request_refund", finding, { useClaude: false });
      const prepared = draftPayload("request_refund", finding);
      expect(draft && prepared).toBeTruthy();
      const text = `${draft!.draft.subject}\n${draft!.draft.body}`
        .replaceAll(PLACEHOLDERS.name, "Alex Rivera")
        .replaceAll(PLACEHOLDERS.email, `safety-${id}@example.com`);
      expect(checkGuardrails(text, prepared!.allowedCents)).toEqual({ ok: true });
    },
  );

  it("lets 1,000 random ids through", () => {
    for (let i = 0; i < 1000; i++) {
      const text = `Your account email is safety-${crypto.randomUUID()}@example.com.`;
      expect(checkGuardrails(text, []).ok).toBe(true);
    }
  });

  it.each([
    "Withdraw from your 403(b) early.",
    "Withdraw from your 403b early.",
    "Max your 457(b).",
    "Roll your 457b into an IRA.",
  ])("still stops %s on a real account", (text) => {
    expect(checkGuardrails(text, []).ok).toBe(false);
  });
});
