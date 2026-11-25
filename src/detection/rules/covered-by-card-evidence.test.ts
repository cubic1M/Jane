import { describe, expect, it } from "vitest";
import { CARD, CHECKING, input, monthly } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput } from "../types";
import { coveredByCard } from "./covered-by-card";

// A plan is called covered only on evidence for the card's condition, not on a look-alike.

const phoneBill = (merchantName: string, accountId: string) => ({
  description: merchantName.toUpperCase(),
  merchantName,
  accountId,
  pfcPrimary: "RENT_AND_UTILITIES",
  pfcDetailed: "RENT_AND_UTILITIES_TELEPHONE",
});
const insurance = (description: string, merchantName: string) => ({
  description,
  merchantName,
  accountId: CARD.id,
  pfcPrimary: "GENERAL_SERVICES",
  pfcDetailed: "GENERAL_SERVICES_INSURANCE",
});
const run = (d: DetectionInput) => coveredByCard(d, buildStreams(d));
const withCard = (transactions: DetectionInput["transactions"]) =>
  input({ transactions, cardProducts: { [CARD.id]: "demo-card" } });

describe("covered_by_card needs the card to meet its condition for this plan", () => {
  it("offers phone protection when the one phone bill is on the card", () => {
    const d = withCard([
      ...monthly(4, 14_500, phoneBill("Verizon Wireless", CARD.id)),
      ...monthly(4, 1_700, insurance("ASURION WIRELESS PROTECTION", "Asurion")),
    ]);
    expect(run(d)).toHaveLength(1);
  });

  it("raises nothing when another phone bill is paid from a bank account", () => {
    // Two lines: one paid with the card, one with debit. Which one the plan protects isn't known.
    const d = withCard([
      ...monthly(4, 14_500, phoneBill("Verizon Wireless", CARD.id)),
      ...monthly(4, 6_000, phoneBill("Mint Mobile", CHECKING.id)),
      ...monthly(4, 1_700, insurance("ASURION WIRELESS PROTECTION", "Asurion")),
    ]);
    expect(run(d)).toEqual([]);
  });

  it("raises nothing for an extended warranty: paying for the warranty isn't buying the item", () => {
    const d = withCard(
      monthly(4, 900, insurance("EXTENDED WARRANTY PLAN", "Extended Warranty Co")),
    );
    expect(run(d)).toEqual([]);
  });

  it("does not take a renters policy from Assurant for phone protection", () => {
    const d = withCard([
      ...monthly(4, 14_500, phoneBill("Verizon Wireless", CARD.id)),
      ...monthly(4, 1_500, insurance("ASSURANT RENTERS INSURANCE", "Assurant")),
    ]);
    expect(run(d)).toEqual([]);
  });

  it("still takes Assurant phone protection for phone protection", () => {
    const d = withCard([
      ...monthly(4, 14_500, phoneBill("Verizon Wireless", CARD.id)),
      ...monthly(4, 1_500, insurance("ASSURANT PHONE PROTECTION", "Assurant")),
    ]);
    expect(run(d)).toHaveLength(1);
  });
});
