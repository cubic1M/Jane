import { describe, expect, it, vi } from "vitest";
import { ALPACA, HUMAN_REVIEW_READY, REAL_CONNECTORS, REAL_TRADING } from "@/config/connectors";
import { REAL_ACCOUNT_ADVICE } from "@/config/advice";
import { REAL_MONEY_MOVEMENT } from "@/config/money-movement";
import { NoCryptoOrders } from "@/lib/brokerage/partner";
import { allConnectors, mayMoveRealMoney, whyUnavailable } from "../registry";
import { AlpacaError, alpacaBrokerHttp, buyBody } from "./api";
import { sandboxAlpacaAccount, sandboxAlpacaOrder } from "./connector";

// Alpaca's Broker API (read connectors, 11-18), sandbox only, against Alpaca's reference
// (docs.alpaca.markets: Create an Order for an Account, Cancel an Open Order, read 2026-11-17). No
// network: a fake fetch.

const ACCOUNT = "b9b19618-22dd-4e80-8432-fc9e1ba0b27d";
const ORDER = "4c6cbac4-e17a-4373-b012-d446b20f9982";
const ENV = { [ALPACA.keyEnv]: "test-key", [ALPACA.secretEnv]: "test-secret-value" };

describe("Alpaca is sandbox only, behind every lock", () => {
  it("has no real connector, and the trading, money and advice locks are shut in code", () => {
    expect(allConnectors().filter((c) => /alpaca/.test(c.id) && !c.sandbox)).toEqual([]);
    expect(Object.keys(REAL_CONNECTORS).filter((id) => /alpaca/.test(id))).toEqual([]);
    expect(REAL_TRADING).toBe(false);
    expect(REAL_MONEY_MOVEMENT).toBe(false);
    expect(REAL_ACCOUNT_ADVICE).toBe(false);
    expect(HUMAN_REVIEW_READY).toBe(false);
  });

  it("marks a buy as a pick, held back from real people, and neither moves real money", () => {
    expect(sandboxAlpacaOrder.recommends).toBe("investment");
    expect(sandboxAlpacaAccount.recommends).toBeUndefined();
    for (const c of [sandboxAlpacaAccount, sandboxAlpacaOrder]) {
      expect(c.movesMoney).toBe(true);
      expect(mayMoveRealMoney(c)).toBe(false);
    }
  });

  it("reaches sample data only, with connectors on", () => {
    const on = { CONNECTORS: "1" };
    for (const c of [sandboxAlpacaAccount, sandboxAlpacaOrder]) {
      expect(whyUnavailable(c, { userId: "u", sampleData: true }, on)).toBeNull();
      expect(whyUnavailable(c, { userId: "u", sampleData: false }, on)).toBe("sandbox_for_samples");
      expect(whyUnavailable(c, { userId: "u", sampleData: true }, {})).toBe("off");
    }
  });
});

describe("what the person is asked to say yes to", () => {
  it("opens an account in their name, of a type Alpaca opens, with no money in", () => {
    const draft = sandboxAlpacaAccount.prefill!({ kind: "open_account", accountType: "roth_ira" });
    expect(draft).toMatchObject({ kind: "open_account", amountCents: 0 });
    expect(draft.summary).toBe("Open a Roth IRA account in your name at Alpaca");
    expect(() => sandboxAlpacaAccount.prefill!({ accountType: "margin" })).toThrow();
  });

  it("sweeps uninvested cash, saying what FDIC insurance covers", () => {
    const draft = sandboxAlpacaAccount.prefill!({
      kind: "cash_sweep",
      account: "Alpaca Individual",
    });
    const steps = Object.fromEntries(draft.steps.map((s) => [s.label, s.value]));
    expect(steps.Insured).toBe("Up to $250,000 at each bank, $1,000,000 in all (FDIC)");
    expect(steps.Rate).toBe("Variable, set by the program");
  });

  it("buys by dollar amount, and never crypto", () => {
    const draft = sandboxAlpacaOrder.prefill!({
      ticker: "vti",
      amountCents: 25_000,
      account: "Alpaca Individual",
    });
    expect(draft).toMatchObject({
      kind: "buy",
      amountCents: 25_000,
      summary: "Buy $250.00 of VTI in Alpaca Individual",
    });
    expect(() =>
      sandboxAlpacaOrder.prefill!({ ticker: "BTC", amountCents: 25_000, account: "A" }),
    ).toThrow(NoCryptoOrders);
    expect(() =>
      sandboxAlpacaOrder.prefill!({ ticker: "../x", amountCents: 25_000, account: "A" }),
    ).toThrow();
  });
});

describe("Alpaca's order calls, as its reference describes them", () => {
  it("is a market buy by dollar amount for the day, with Jane's id so a retry can't buy twice", () => {
    expect(
      buyBody({
        accountId: ACCOUNT,
        symbol: "VTI",
        amountCents: 25_000,
        clientOrderId: "jane_act_1",
      }),
    ).toEqual({
      symbol: "VTI",
      notional: "250.00",
      side: "buy",
      type: "market",
      time_in_force: "day",
      client_order_id: "jane_act_1",
    });
    expect(() =>
      buyBody({ accountId: ACCOUNT, symbol: "ETH", amountCents: 25_000, clientOrderId: "x" }),
    ).toThrow(NoCryptoOrders);
  });

  it("posts to the sandbox host with Basic auth, and cancels an open order", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: ORDER, status: "accepted" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ message: "not cancelable" }, { status: 422 }));
    const broker = alpacaBrokerHttp({ env: ENV, fetch: send as never });
    expect(
      await broker.buy({
        accountId: ACCOUNT,
        symbol: "VTI",
        amountCents: 25_000,
        clientOrderId: "jane_act_1",
      }),
    ).toEqual({ id: ORDER, status: "accepted" });
    const [url, init] = send.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://broker-api.sandbox.alpaca.markets/v1/trading/accounts/${ACCOUNT}/orders`,
    );
    const auth = (init.headers as Record<string, string>).authorization!;
    expect(Buffer.from(auth.replace(/^Basic /, ""), "base64").toString()).toBe(
      "test-key:test-secret-value",
    );
    expect(await broker.cancel(ACCOUNT, ORDER)).toBe(true);
    expect((send.mock.calls[1] as [string, RequestInit])[1].method).toBe("DELETE");
    // 422: already filled, so it can't be taken back.
    expect(await broker.cancel(ACCOUNT, ORDER)).toBe(false);
  });

  it("never reaches production, and says refusals without the keys", async () => {
    const send = vi.fn(async () => Response.json({ message: "forbidden" }, { status: 403 }));
    const error = await alpacaBrokerHttp({
      env: { ...ENV, ALPACA_ENV: "production" },
      fetch: send as never,
    })
      .buy({ accountId: ACCOUNT, symbol: "VTI", amountCents: 25_000, clientOrderId: "k" })
      .catch((e: unknown) => e);
    expect(String((send.mock.calls[0] as unknown as [string])[0])).toMatch(
      /^https:\/\/broker-api\.sandbox\./,
    );
    expect(error).toBeInstanceOf(AlpacaError);
    expect(String((error as Error).message)).not.toContain("test-secret-value");
    const none = vi.fn();
    await expect(
      alpacaBrokerHttp({ env: {}, fetch: none as never }).cancel(ACCOUNT, ORDER),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(none).not.toHaveBeenCalled();
  });
});
