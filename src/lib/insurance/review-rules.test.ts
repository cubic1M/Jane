import { describe, expect, it } from "vitest";
import { checkGuardrails } from "@/lib/guardrails";
import {
  reviewBody,
  reviewCents,
  reviewItems,
  reviewMoney,
  type ReviewInput,
} from "./review-rules";

// The yearly insurance review (spec step 202): one message with what Jane did, what needs a
// tap, and the yearly money. Pure.

const base: ReviewInput = {
  level: "ask",
  did: [],
  savedYearlyCents: 0,
  savings: [],
  calls: 0,
  risks: 0,
  coverChanges: 0,
  gaps: 0,
  recommendations: [],
  claimDrafts: 0,
  health: null,
};
const busy: ReviewInput = {
  ...base,
  savings: [
    { kind: "autopay", yearlySavingCents: 5_000 },
    { kind: "pay_in_full", yearlySavingCents: 9_000 },
    { kind: "higher_deductible", yearlySavingCents: 12_000 },
  ],
  calls: 1,
  risks: 2,
  coverChanges: 1,
  gaps: 3,
  recommendations: [
    {
      title: "Lower the deductible.",
      cost: "Saves about $200.00 a year",
      costCents: -20_000,
      cents: [],
    },
    { title: "Add life cover.", cost: "About $300.00 more a year", costCents: 30_000, cents: [] },
  ],
  claimDrafts: 1,
  health: { fsaLeftCents: 80_000, fsaDeadline: "2026-12-31", disputes: 1 },
};

describe("reviewItems", () => {
  it("has an item and a button for everything that needs a tap", () => {
    expect(reviewItems(busy).map((i) => i.key)).toEqual([
      "keep_covered",
      "deductible",
      "risks",
      "cover_changes",
      "gaps",
      "checkup",
      "claims",
      "health",
    ]);
    for (const item of reviewItems(busy)) expect(item.button.label.length).toBeGreaterThan(0);
  });

  it("keeps a higher deductible out of Keep me covered: it only links", () => {
    const keep = reviewItems(busy).find((i) => i.key === "keep_covered");
    expect(keep?.text).toMatch(/2 ways to pay less for the same cover, up to \$140\.00/);
    expect(keep?.button.href).toBeNull();
    expect(reviewItems(busy).find((i) => i.key === "deductible")?.button.href).toBe(
      "/insurance#savings",
    );
  });

  it("is empty when nothing needs a tap", () => {
    expect(reviewItems(base)).toEqual([]);
  });
});

describe("reviewMoney and reviewBody", () => {
  it("adds up what is saved already and what waits", () => {
    const r = { ...busy, savedYearlyCents: 21_000, did: ["Applied a paperless saving"] };
    expect(reviewMoney(r)).toEqual({ savedCents: 21_000, waitingCents: 26_000 + 20_000 });
    const body = reviewBody(r);
    expect(body).toContain("What I did within your limits:\n- Applied a paperless saving");
    expect(body).toContain("What needs your tap:");
    expect(body).toMatch(
      /about \$210\.00 a year already saved, and up to \$460\.00 a year waiting/,
    );
  });

  it("says nothing price-changing happens without a tap below Everything allowed", () => {
    expect(reviewBody(busy)).toMatch(/nothing that changes a price happens without your tap/);
    expect(reviewBody({ ...busy, level: "all" })).toMatch(/haven't had to change anything/);
  });

  it("says a clean year plainly", () => {
    expect(reviewBody(base)).toMatch(/Nothing needs your tap: your cover looks right/);
  });

  it("passes the guardrails with its own figures", () => {
    const r = { ...busy, savedYearlyCents: 21_000, did: ["Applied a paperless saving"] };
    expect(checkGuardrails(reviewBody(r), reviewCents(r), undefined, "demo_advice")).toEqual({
      ok: true,
    });
  });
});
