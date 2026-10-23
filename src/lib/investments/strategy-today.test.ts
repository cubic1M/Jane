import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { strategyTickers } from "@/config/portfolios";
import type { PrismaClient } from "@/generated/prisma/client";
import { realFixtureBars } from "@/lib/market/__fixtures__/real";
import { strategyToday } from "./strategy-today";

// The strategy a level follows today: the latest evaluation's choice, worked out for the month
// from the stored closes (the fixture stands in for market_prices). No call out.

const chosen = (level: number, id: string, params: object, key: string) => ({
  level,
  id,
  params,
  key,
  label: id === "trend" ? "Trend filter" : "The level's mix",
  why: "Because.",
});

function fakeClient(withRows: boolean) {
  const bars = realFixtureBars();
  const findMany = vi.fn(
    async ({ where }: { where: { ticker: string; date: { gte: Date; lte: Date } } }) =>
      withRows && (strategyTickers() as string[]).includes(where.ticker)
        ? bars[where.ticker]
            .map((b) => ({
              date: new Date(`${b.date}T00:00:00Z`),
              closeCents: b.closeCents,
              source: "alpaca",
            }))
            .filter((r) => r.date >= where.date.gte && r.date <= where.date.lte)
        : [],
  );
  const findFirst = vi.fn(async () => ({
    ranAt: new Date("2022-06-06T11:00:00Z"),
    source: "alpaca",
    fromDate: new Date("2016-01-04T00:00:00Z"),
    toDate: new Date("2022-06-03T00:00:00Z"),
    chosen: [
      chosen(2, "trend", { months: 6 }, "trend(months=6)"),
      chosen(5, "static", { rebalance: "band" }, "static(rebalance=band)"),
    ],
  }));
  return {
    client: {
      marketPrice: { findMany },
      strategyEvaluation: { findFirst },
    } as unknown as PrismaClient,
    findMany,
  };
}

describe("strategyToday", () => {
  it("works out the month's weights from the stored closes for the level's choice", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const { client } = fakeClient(true);
    const today = await strategyToday(2, { client, now: new Date("2022-06-15T21:30:00Z") });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
    expect(today?.chosen.key).toBe("trend(months=6)");
    expect(today?.follow).toBe(true);
    expect(today?.follow && today.weights.bonds).toBe(0);
    expect(today?.follow && today.signalDate).toBe("2022-06-01");
  });

  it("follows nothing for the mix or closes not stored yet; the research choice before an evaluation", async () => {
    const stored = fakeClient(true);
    const now = new Date("2022-06-16T21:30:00Z");
    expect(await strategyToday(5, { client: stored.client, now })).toMatchObject({
      follow: false,
      why: "The level's mix is the choice.",
    });
    // A level the evaluation has no choice for: the committed research choice.
    expect(await strategyToday(3, { client: stored.client, now })).toMatchObject({
      source: "research",
      chosen: { key: "trend(months=6)", label: "Trend filter" },
      follow: true,
    });
    const empty = fakeClient(false);
    expect(await strategyToday(2, { client: empty.client, now })).toMatchObject({
      follow: false,
      why: "Jane doesn't have enough recent prices for this strategy's funds yet, so the portfolio keeps the level's mix until the daily price load has them.",
    });
  });
});

describe("strategyToday before the first evaluation", () => {
  it("follows the committed research choice (STRATEGY_RESEARCH_CHOICE)", async () => {
    const bars = realFixtureBars();
    const client = {
      marketPrice: {
        findMany: async ({
          where,
        }: {
          where: { ticker: string; date: { gte: Date; lte: Date } };
        }) =>
          (bars[where.ticker] ?? [])
            .map((b) => ({
              date: new Date(`${b.date}T00:00:00Z`),
              closeCents: b.closeCents,
              source: "alpaca",
            }))
            .filter((r) => r.date >= where.date.gte && r.date <= where.date.lte),
      },
      strategyEvaluation: { findFirst: async () => null },
    } as unknown as PrismaClient;
    const now = new Date("2022-06-17T21:30:00Z");
    const low = await strategyToday(2, { client, now });
    expect(low).toMatchObject({ source: "research", chosen: { id: "trend" }, follow: true });
    expect(low?.chosen.why).toMatch(/Alpaca's closes/);
    expect(await strategyToday(5, { client, now })).toMatchObject({
      source: "research",
      chosen: { id: "static" },
      follow: false,
    });
  });
});
