import { describe, expect, it } from "vitest";
import { MERCHANT_SEED } from "@/config/merchant-seed";
import { CARD, input, monthsAgo, sampleYear, tx } from "./__fixtures__/build";
import { detect } from "./detect";
import { withDirectory } from "./merchants";
import type { Candidate } from "./types";

const summary = (findings: Candidate[]) =>
  findings.map((f) => `${f.type}:${f.annualSavingsCents}:${f.confidence}`).sort();

describe("withDirectory", () => {
  it("changes nothing on the existing fixtures (no regressions)", () => {
    const year = sampleYear();
    expect(summary(detect(withDirectory(year, MERCHANT_SEED)))).toEqual(summary(detect(year)));
  });

  it("joins a company's different statement names into one subscription", () => {
    // A CSV export with no categories, where Spotify shows up two ways.
    const charge = (m: number, description: string) =>
      tx({ accountId: CARD.id, date: monthsAgo(m), amountCents: 1_199, description });
    const data = input({
      transactions: [
        ...[5, 4, 3].map((m) => charge(m, "SPOTIFY USA")),
        ...[2, 1, 0].map((m) => charge(m, "SPOTIFY P0D3F2A1")),
      ],
    });

    expect(detect(data).filter((f) => f.type === "subscription_review")).toEqual([]);

    const subscriptions = (findings: Candidate[]) =>
      findings.filter((f) => f.type === "subscription_review");
    expect(subscriptions(detect(withDirectory(data, MERCHANT_SEED)))).toEqual([
      expect.objectContaining({
        type: "subscription_review",
        key: "merchant:spotify",
        title: "Review your Spotify subscription",
        annualSavingsCents: 1_199 * 12,
      }),
    ]);
  });

  it("keeps the bank's own category and leaves unlisted merchants alone", () => {
    const own = tx({
      description: "NETFLIX.COM",
      pfcPrimary: "ENTERTAINMENT",
      pfcDetailed: "ENTERTAINMENT_OTHER_ENTERTAINMENT",
    });
    const other = tx({ description: "CORNER SHOP 12" });
    const [a, b] = withDirectory(input({ transactions: [own, other] }), MERCHANT_SEED).transactions;
    expect(a).toMatchObject({
      merchantName: "Netflix",
      pfcDetailed: "ENTERTAINMENT_OTHER_ENTERTAINMENT",
    });
    expect(b).toEqual(other);
  });

  it("doesn't mistake a store for a subscription with a one-word name", () => {
    const store = tx({ description: "APPLE STORE R123 PALO ALTO" });
    expect(withDirectory(input({ transactions: [store] }), MERCHANT_SEED).transactions[0]).toEqual(
      store,
    );
  });
});
