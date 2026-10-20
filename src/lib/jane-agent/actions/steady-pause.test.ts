import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/investments/steady-hand", () => ({ loadSteadyHand: vi.fn() }));
vi.mock("@/lib/investments/company-stock", () => ({
  CompanyStockError: class extends Error {},
  linkDemoStockPlan: vi.fn(),
  loadCompanyStock: vi.fn(async () => ({ plan: { parts: [{ proceedsCents: 250_000 }] } })),
  sellPart: vi.fn(async () => ({ part: { proceedsCents: 250_000, taxCents: 18_750 } })),
}));

import { loadSteadyHand } from "@/lib/investments/steady-hand";
import { sellPart } from "@/lib/investments/company-stock";
import { companySell } from "./investments";
import type { ChatMessage } from "../types";

// Spec step 163: the pause before a sell, and that it can always be skipped.

const drop = { key: "1m", windowLabel: "the last month", rate: -0.1 };
const message = (refs: object): ChatMessage =>
  ({
    id: "m",
    refs,
    actions: [
      { id: "company.sell", label: "Sell $2,500.00 now", kind: "primary" },
      { id: "open", label: "See your company stock", kind: "link", href: "/x" },
    ],
  }) as unknown as ChatMessage;
const run = (refs: object) =>
  companySell.run({
    userId: "u",
    message: message(refs),
    action: { id: "company.sell", label: "Sell $2,500.00 now", kind: "primary" },
    client: {} as never,
    now: new Date("2026-10-19T12:00:00Z"),
  });

describe("the pause before a sell", () => {
  it("pauses once in a big drop: the message stays open, nothing is sold, 'Sell anyway' is offered", async () => {
    vi.mocked(loadSteadyHand).mockResolvedValue({ advice: true, drop, buckets: [] });
    const out = await run({ companyPlan: "k", advice: true });
    expect(out.status).toBe("open");
    expect(out.refs).toMatchObject({ paused: true });
    expect(out.note).toMatch(/^Before you sell: your investments are down 10\.0%/);
    expect(out.actions?.map((a) => a.label)).toEqual([
      "Sell anyway",
      "See your company stock",
      "Leave it a few days",
    ]);
    expect(sellPart).not.toHaveBeenCalled();
  });

  it("is skipped by one more tap, with no waiting", async () => {
    vi.mocked(loadSteadyHand).mockResolvedValue({ advice: true, drop, buckets: [] });
    const out = await run({ companyPlan: "k", advice: true, paused: true });
    expect(out.status).toBeUndefined();
    expect(out.note).toMatch(/^Done in the simulated brokerage/);
    expect(sellPart).toHaveBeenCalledTimes(1);
  });

  it("doesn't pause when there's no big drop", async () => {
    vi.mocked(sellPart).mockClear();
    vi.mocked(loadSteadyHand).mockResolvedValue({ advice: true, drop: null, buckets: [] });
    const out = await run({ companyPlan: "k", advice: true });
    expect(out.note).toMatch(/^Done in the simulated brokerage/);
    expect(sellPart).toHaveBeenCalledTimes(1);
  });
});
