import { describe, expect, it } from "vitest";
import { premiumWithYear, premiumWords } from "@/lib/insurance/premium-words";
import { foundPoliciesSource } from "@/lib/jane-agent/sources/found-policies";
import type { Snapshot } from "@/lib/jane-agent/snapshot";
import { insuranceTree, type InsuranceTreeInput } from "./insurance";

// Debug 2, 11-22 (S6, Plaid 14 months, Plaid + loans): "I found your car insurance from your
// payments: GEICO, $112.40 a month" opened Insurance, which said "$1.3k/yr" and not $112.40. The card
// opens the policy's own item, which says the premium as the card does, with the year it comes to.

const geico = { premiumCents: 11_240, premiumFrequency: "monthly" as const };

describe("a found policy's card and its item on Insurance", () => {
  it("say one premium, the item with its year", () => {
    expect(premiumWords(geico)).toBe("$112.40 a month");
    expect(premiumWithYear(geico)).toBe("$112.40 a month, $1,348.80 a year");
    expect(premiumWithYear({ premiumCents: 60_000, premiumFrequency: "yearly" })).toBe(
      "$600.00 a year",
    );
    expect(premiumWords({ premiumCents: null, premiumFrequency: "monthly" })).toBeNull();
  });

  it("the card opens the policy's item, and the item says $112.40 a month", () => {
    const snapshot = {
      insurance: {
        policies: [
          {
            id: "pol1",
            kind: "auto",
            carrier: "GEICO",
            status: "found",
            source: "payments",
            nextRenewal: null,
            ...geico,
          },
        ],
      },
    } as unknown as Snapshot;
    const [card] = foundPoliciesSource.gather(snapshot, {} as never);
    expect(card!.body).toContain("GEICO, $112.40 a month.");
    expect(card!.actions.at(-1)).toMatchObject({ href: "/insurance?focus=policies:pol1" });

    const input: InsuranceTreeInput = {
      asOf: "2026-11-22",
      needs: [],
      policies: [
        {
          id: "pol1",
          kind: "auto",
          carrier: "GEICO",
          status: "found",
          yearlyCents: 134_880,
          premium: premiumWithYear(geico),
          renewsOn: null,
        },
      ],
      gaps: [],
      savings: [],
      renewals: [],
      changes: [],
      readings: [],
      payingTwice: [],
      cards: [],
      household: [],
      risks: [],
      health: null,
    };
    expect(insuranceTree(input).summaries["policies:pol1"]).toBe(
      "Found from your payments: $112.40 a month, $1,348.80 a year; confirm it to count it.",
    );
  });
});
