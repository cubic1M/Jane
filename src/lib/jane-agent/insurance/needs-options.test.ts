import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));
vi.mock("@/lib/insurance/need/load", async (original) => ({
  ...(await original<typeof import("@/lib/insurance/need/load")>()),
  loadNeeds: vi.fn(),
  optionsForNeed: vi.fn(),
}));

import { DEMO_ADVICE_LABEL } from "@/config/advice";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { loadNeeds, optionsForNeed } from "@/lib/insurance/need/load";
import type { OptionSet } from "@/lib/insurance/need/options";
import type { Need } from "@/lib/insurance/need/types";
import { cardProblems } from "@/lib/option-card";
import { runInsuranceTool } from "./tools";

// insurance_needs (spec step 278) brings the options for the cover asked about, or the first
// that is short, as the pick-one card the chat floats with the answer (refs.options). Demo
// advice only, like the insurance page.

const client = {} as PrismaClient;
const now = new Date("2026-10-18T15:00:00Z");

const need = (kind: Need["kind"], gapCents: number, policyId: string | null = null): Need => ({
  kind,
  applies: true,
  unit: "total",
  needCents: 50_000_000,
  haveCents: 50_000_000 - gapCents,
  gapCents,
  lines: [{ label: "Ten years of pay", cents: 50_000_000, adds: true }],
  summary: "You need about $500,000.",
  policyId,
});

const set = (forNeed: Need): OptionSet => ({
  need: forNeed.kind,
  policyId: forNeed.policyId,
  pickId: "o1",
  confidence: { percent: 76, reason: "it closes the gap for the least" },
  working: forNeed.lines,
  options: [
    {
      id: "o1",
      role: "meets_need",
      carrier: "Lighthouse",
      rating: "A",
      annualPremiumCents: 48_000,
      premiumFrequency: "monthly",
      premiumCents: 4_000,
      coverage: { faceAmount: 50_000_000 },
      deductibleCents: null,
      coverLines: ["Cover: $500,000 for 20 years"],
      whyThisOne: "Closes the gap for the least.",
      isPick: true,
      partnerQuoteId: "q1",
      details: ["Priced by the demo partner."],
    },
    {
      id: "o2",
      role: "better",
      carrier: "Harbor",
      rating: "A+",
      annualPremiumCents: 61_200,
      premiumFrequency: "monthly",
      premiumCents: 5_100,
      coverage: { faceAmount: 60_000_000 },
      deductibleCents: null,
      coverLines: ["Cover: $600,000 for 20 years"],
      whyThisOne: "More cover from a higher rated insurer.",
      isPick: false,
      partnerQuoteId: "q2",
      details: [],
    },
  ],
});

const run = (input: unknown) => runInsuranceTool("u1", "insurance_needs", input, { client, now });

beforeEach(() => {
  vi.mocked(adviceMode).mockReset().mockResolvedValue(true);
  vi.mocked(optionsForNeed)
    .mockReset()
    .mockImplementation(async (_u, kind) => {
      const n = need(kind, 20_000_000, kind === "auto_liability" ? "p1" : null);
      return { need: n, set: set(n) };
    });
});

describe("insurance_needs with options", () => {
  it("prices the cover asked about and hands it on as the pick-one card", async () => {
    vi.mocked(loadNeeds).mockResolvedValue([need("umbrella", 0), need("life", 20_000_000)]);
    const out = await run({ need: "life" });
    expect(optionsForNeed).toHaveBeenCalledWith("u1", "life", { client, now });
    expect(out.options).toMatchObject({ kind: "insurance", topic: "life", advice: true });
    expect(cardProblems(out.options!)).toEqual([]);
    expect(out.options!.options[0]).toMatchObject({ id: "o1", isPick: true });
    // Claude sees the options too, with their prices allowed, and is told they're a card.
    const content = JSON.parse(out.content);
    expect(content.options).toMatchObject({ for: "life", shownAsACard: true });
    expect(content.options.label).toBe(DEMO_ADVICE_LABEL);
    expect(out.cents).toEqual(expect.arrayContaining([48_000, 61_200]));
  });

  it("takes the first cover that is short when none was asked about, with its policy", async () => {
    vi.mocked(loadNeeds).mockResolvedValue([
      need("life", 0),
      need("auto_liability", 20_000_000, "p1"),
    ]);
    const out = await run({});
    expect(optionsForNeed).toHaveBeenCalledWith("u1", "auto_liability", {
      client,
      now,
      policyId: "p1",
    });
    expect(out.options).toMatchObject({ topic: "auto_liability", policyId: "p1" });
  });

  it("brings no card when nothing is short, or the cover asked about isn't", async () => {
    vi.mocked(loadNeeds).mockResolvedValue([need("life", 0), need("umbrella", 0)]);
    expect((await run({})).options).toBeUndefined();
    expect((await run({ need: "life" })).options).toBeUndefined();
    expect(optionsForNeed).not.toHaveBeenCalled();
  });

  it("never brings options to a real account", async () => {
    vi.mocked(adviceMode).mockResolvedValue(false);
    vi.mocked(loadNeeds).mockResolvedValue([need("life", 20_000_000)]);
    const out = await run({ need: "life" });
    expect(out.options).toBeUndefined();
    expect(JSON.parse(out.content).options).toBeUndefined();
    expect(optionsForNeed).not.toHaveBeenCalled();
  });
});
