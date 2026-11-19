import { describe, expect, it, vi } from "vitest";
import { SAVEONPHONE } from "@/config/saveonphone";
import { SAVEONPHONE_PLAN } from "@/lib/__fixtures__/saveonphone";
import { searchSaveOnPhone, stagedPlan } from "./saveonphone";

// SaveOnPhone's public phone-plan catalog as options to compare, against a plan as its search returned
// it (2026-11-19). No network: a fake fetch.

describe("a SaveOnPhone plan as an option", () => {
  it("prices it at the higher of the first term and the renewal, with the carrier's own sign-up page", () => {
    expect(stagedPlan(SAVEONPHONE_PLAN)).toEqual({
      provider: "Mint Mobile",
      name: "17GB Plan",
      // $180 for the first 12 months, $240 for the next 12: $20 a month is the lasting price.
      monthlyCents: 2_000,
      contractMonths: 12,
      oneTimeFeeCents: 0,
      includes: "17 GB of data, T-Mobile network",
      givesUp:
        "New customers only. Paid 12 months up front. Taxes and fees on top. Check coverage and your phone first",
      signUpUrl: "https://www.mintmobile.com/plans/",
      sourceUrl: "https://saveonphone.com/plans/mint-mobile-15gb-plan/",
      checkedAt: "2026-11-18",
    });
  });

  it("never keeps SaveOnPhone's affiliate link, and needs a price, a source and a date", () => {
    const staged = stagedPlan({ ...SAVEONPHONE_PLAN, carrier_url: SAVEONPHONE_PLAN.affiliate_url });
    expect(staged?.signUpUrl).toBeNull();
    expect(JSON.stringify(stagedPlan(SAVEONPHONE_PLAN))).not.toContain("/go/");
    expect(stagedPlan({ ...SAVEONPHONE_PLAN, billing: {} })).toBeNull();
    expect(
      stagedPlan({ ...SAVEONPHONE_PLAN, saveonphone_url: "https://elsewhere.example/p" }),
    ).toBeNull();
    expect(stagedPlan({ ...SAVEONPHONE_PLAN, catalog_verified_at: null })).toBeNull();
  });
});

describe("SaveOnPhone's search", () => {
  it("asks by price alone, verified plans only, a page at a time", async () => {
    const full = Array.from({ length: 10 }, () => SAVEONPHONE_PLAN);
    const send = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: "ok", plans: full, next_offset: 10 }))
      .mockResolvedValueOnce(
        Response.json({ status: "ok", plans: [SAVEONPHONE_PLAN], next_offset: null }),
      );
    expect(await searchSaveOnPhone({ fetch: send as never })).toHaveLength(11);
    const [url, init] = send.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://saveonphone.com/api/v1/plans/search");
    expect(JSON.parse(String(init.body))).toEqual({
      max_monthly_cents: SAVEONPHONE.maxMonthlyCents,
      verified_only: true,
      limit: 10,
      offset: 0,
    });
    expect(JSON.parse(String((send.mock.calls[1] as [string, RequestInit])[1].body)).offset).toBe(
      10,
    );
  });

  it("stops when it's rate limited, and fails on anything else", async () => {
    const limited = vi.fn(async () => new Response(null, { status: 429 }));
    expect(await searchSaveOnPhone({ fetch: limited as never })).toEqual([]);
    const broken = vi.fn(async () => new Response("no", { status: 500 }));
    await expect(searchSaveOnPhone({ fetch: broken as never })).rejects.toThrow(/HTTP 500/);
  });
});
