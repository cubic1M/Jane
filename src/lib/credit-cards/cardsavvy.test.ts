import { afterEach, describe, expect, it, vi } from "vitest";
import { earnsCents } from "@/planning/credit-cards";
import {
  CardSavvyError,
  cardSavvyProduct,
  clearCardSavvyCache,
  getCardSavvyCard,
} from "./cardsavvy";

// CardSavvy's card catalog, against its own get_card answer for one card (mcp.card-savvy.com, 2026-11-19;
// public catalog data). No network: a fake fetch that speaks MCP over Streamable HTTP.

const SAPPHIRE = {
  result: {
    card: {
      name: "Chase Sapphire Preferred",
      issuer: "Chase",
      annual_fee: 95.0,
      point_value_cents: 1.5,
      modality: "Points",
      rewards: {
        Flights: 2.0,
        Hotels: 2.0,
        "Other Travel": 2.0,
        Dining: 3.0,
        "Fast Food": 3.0,
        Grocery: 1.0,
        Gas: 3.0,
        "Online Shopping": 1.0,
        Other: 1.0,
        Streaming: 3.0,
      },
      issuer_url: "https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred",
      is_legacy: false,
      modeling_warning: null,
    },
  },
  as_of: "2026-10-24T00:00:00+00:00",
  notices: ["Informational and educational only. This is not individualized financial ... advice."],
};

afterEach(() => clearCardSavvyCache());

describe("a card as CardSavvy describes it, in Jane's shape", () => {
  const product = cardSavvyProduct(SAPPHIRE)!;

  it("values each multiple at the card's point value: 3x at 1.5 cents is 4.5%", () => {
    expect(product).toMatchObject({
      id: "cardsavvy:Chase Sapphire Preferred",
      issuer: "Chase",
      annualFeeCents: 9_500,
      rateBps: { dining: 450, gas: 450, travel: 300, streaming: 450 },
      baseRateBps: 150,
      sourceUrl: "https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred",
      demo: false,
    });
    // Groceries and online earn the base rate here, so they aren't listed apart.
    expect(product.rateBps.groceries).toBeUndefined();
  });

  it("says it's CardSavvy's, with its verification date, as its terms ask", () => {
    expect(product.rewardsLabel).toMatch(/\(CardSavvy, checked 2026-10-24\)$/);
    expect(product.rewardsLabel).toContain("3x points on Dining");
    expect(product.rewardsLabel).not.toMatch(/apply|switch|save \$/i);
  });

  it("works out what the person's own spending earned with Jane's own math", () => {
    const year = {
      dining: 300_000,
      groceries: 500_000,
      gas: 100_000,
      travel: 0,
      streaming: 0,
      online: 0,
      other: 200_000,
    };
    // $3,000 dining and $1,000 gas at 4.5%, $7,000 else at 1.5%.
    expect(earnsCents(product, year)).toBe(13_500 + 4_500 + 10_500);
  });

  it("has nothing to say without a verification date, a point value or a base rate", () => {
    expect(cardSavvyProduct({ ...SAPPHIRE, as_of: null })).toBeNull();
    expect(
      cardSavvyProduct({
        ...SAPPHIRE,
        result: { card: { ...SAPPHIRE.result.card, point_value_cents: null } },
      }),
    ).toBeNull();
    expect(
      cardSavvyProduct({ ...SAPPHIRE, result: { card: { ...SAPPHIRE.result.card, rewards: {} } } }),
    ).toBeNull();
  });
});

describe("CardSavvy's get_card over MCP", () => {
  const sse = (id: number, result: unknown, headers: Record<string, string> = {}) =>
    new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`, {
      headers: { "content-type": "text/event-stream", ...headers },
    });
  const answering = () =>
    vi
      .fn()
      .mockResolvedValueOnce(sse(1, { capabilities: {} }, { "mcp-session-id": "s1" }))
      .mockResolvedValueOnce(sse(2, { structuredContent: SAPPHIRE, isError: false }));

  it("initializes, then calls get_card with the card's name alone and the _meta envelope", async () => {
    const send = answering();
    const found = await getCardSavvyCard("Chase Sapphire Preferred", { fetch: send as never });
    expect(found.result?.card?.name).toBe("Chase Sapphire Preferred");
    const [url, init] = send.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://mcp.card-savvy.com/mcp");
    expect((init.headers as Record<string, string>)["mcp-session-id"]).toBe("s1");
    expect(JSON.parse(String(init.body))).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "get_card",
        arguments: { name: "Chase Sapphire Preferred" },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2025-06-18",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
  });

  it("asks for a card once a day at most, inside its 120 calls an hour", async () => {
    const send = answering();
    let clock = 0;
    await getCardSavvyCard("Chase Sapphire Preferred", { fetch: send as never, now: () => clock });
    clock = 23 * 3_600_000;
    await getCardSavvyCard("chase sapphire preferred", { fetch: send as never, now: () => clock });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("says when CardSavvy doesn't know the card, and refuses an empty or long name before calling", async () => {
    const unknown = vi
      .fn()
      .mockResolvedValueOnce(sse(1, { capabilities: {} }))
      .mockResolvedValueOnce(
        sse(2, { isError: true, content: [{ type: "text", text: "no such card" }] }),
      );
    await expect(
      getCardSavvyCard("Made Up Card", { fetch: unknown as never }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const none = vi.fn();
    await expect(getCardSavvyCard(" ", { fetch: none as never })).rejects.toBeInstanceOf(
      CardSavvyError,
    );
    await expect(
      getCardSavvyCard("x".repeat(200), { fetch: none as never }),
    ).rejects.toBeInstanceOf(CardSavvyError);
    expect(none).not.toHaveBeenCalled();
  });
});
