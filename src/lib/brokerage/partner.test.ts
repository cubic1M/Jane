import { describe, expect, it, vi } from "vitest";
import { ACTION_IDS } from "@/lib/jane-agent/types";
import { NoCryptoOrders, refuseCrypto, simulatedBrokerage } from "./partner";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/market-data/partner", () => ({
  marketDataFor: vi.fn(async () => ({ priceCents: () => 10_000 })),
  lastClose: (now: Date) => now.toISOString().slice(0, 10),
}));

// Spec step 161: there is no order path for crypto, whichever partner is in use.

describe("the brokerage and crypto", () => {
  it("refuses a whole batch with any crypto in it, before anything is recorded", async () => {
    const create = vi.fn();
    const client = { brokerageOrder: { create } } as never;
    await expect(
      simulatedBrokerage.placeOrders(
        "u",
        {
          batchId: "b",
          reason: "rebalance",
          orders: [
            {
              accountId: "a",
              ticker: "KTSIX",
              securityName: "Fund",
              side: "buy",
              amountCents: 100,
            },
            {
              accountId: "a",
              ticker: "btc",
              securityName: "Bitcoin",
              side: "buy",
              amountCents: 100,
            },
          ],
        },
        { client, now: new Date() },
      ),
    ).rejects.toBeInstanceOf(NoCryptoOrders);
    expect(create).not.toHaveBeenCalled();
    expect(() =>
      refuseCrypto([
        { accountId: "a", ticker: "ETH", securityName: "", side: "sell", amountCents: 1 },
      ]),
    ).toThrow("Jane never trades crypto.");
  });

  it("has no price for crypto", async () => {
    const options = { userId: "u", client: {} as never, now: new Date() };
    expect(await simulatedBrokerage.priceOf("BTC", options)).toBeNull();
    expect(await simulatedBrokerage.priceOf("KTSIX", options)).toBe(10_000);
  });

  it("has no crypto button in the chat but the read-only connect", () => {
    expect(ACTION_IDS.filter((id) => id.startsWith("crypto."))).toEqual(["crypto.link"]);
  });
});
