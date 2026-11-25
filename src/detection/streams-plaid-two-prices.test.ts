import { describe, expect, it } from "vitest";
import { CARD, CHECKING, input, monthly, plaidStream } from "./__fixtures__/build";
import { buildStreams } from "./streams";

const NETFLIX = { merchantName: "Netflix", description: "NETFLIX.COM" };

describe("a plan seen by Plaid at two prices counts once at each", () => {
  it("drops a fallback stream that matches the second Plaid stream, not only the first", () => {
    const card12 = monthly(3, 1_200, { ...NETFLIX, accountId: CARD.id }).map((t, i) => ({
      ...t,
      plaidTransactionId: `a${i}`,
    }));
    const card20 = monthly(3, 2_000, { ...NETFLIX, accountId: CARD.id }).map((t, i) => ({
      ...t,
      plaidTransactionId: `b${i}`,
    }));
    const upload = monthly(4, 2_000, { ...NETFLIX, accountId: CHECKING.id });
    const data = input({
      transactions: [...card12, ...card20, ...upload],
      recurringStreams: [
        plaidStream({
          plaidStreamId: "a",
          accountId: CARD.id,
          lastAmountCents: 1_200,
          averageAmountCents: 1_200,
          transactionIds: ["a0", "a1", "a2"],
        }),
        plaidStream({
          plaidStreamId: "b",
          accountId: CARD.id,
          lastAmountCents: 2_000,
          averageAmountCents: 2_000,
          transactionIds: ["b0", "b1", "b2"],
        }),
      ],
    });
    const streams = buildStreams(data);
    expect(streams.map((s) => s.lastAmountCents).sort()).toEqual([1_200, 2_000]);
  });
});
