import { describe, expect, it } from "vitest";
import { buildCard } from "@/lib/cards";
import { cardProducts, limitWords, standInCatalog } from "@/lib/insurance/card-benefits";
import { CARD_CATALOG } from "@/config/card-benefits";
import { CARD, CHECKING, GEICO, input, monthly, tx } from "../__fixtures__/build";
import { detect } from "../detect";
import { buildStreams } from "../streams";
import type { DetectionInput } from "../types";
import { coveredByCard } from "./covered-by-card";
import { insuranceReshop } from "./insurance-reshop";

// Cover you already have (spec step 152): a plan is a duplicate only when a card the
// catalog knows covers all of it and the person meets the card's condition.

const PHONE_BILL = {
  description: "VERIZON WIRELESS",
  merchantName: "Verizon Wireless",
  pfcPrimary: "RENT_AND_UTILITIES",
  pfcDetailed: "RENT_AND_UTILITIES_TELEPHONE",
};
const ASURION = {
  description: "ASURION WIRELESS PROTECTION",
  merchantName: "Asurion",
  pfcPrimary: "GENERAL_SERVICES",
  pfcDetailed: "GENERAL_SERVICES_INSURANCE",
};
const TRAVEL_INSURANCE = {
  description: "ALLIANZ TRAVEL INSURANCE",
  merchantName: "Allianz Travel",
  pfcPrimary: "GENERAL_SERVICES",
  pfcDetailed: "GENERAL_SERVICES_INSURANCE",
};

const DEMO_CARD = { [CARD.id]: "demo-card" };

function data(
  {
    phoneOn = CARD.id,
    cards = DEMO_CARD,
  }: { phoneOn?: string; cards?: Record<string, string> } = {},
  extra = monthly(4, 1700, { ...ASURION, accountId: CARD.id }),
): DetectionInput {
  return input({
    transactions: [...monthly(4, 14_500, { ...PHONE_BILL, accountId: phoneOn }), ...extra],
    cardProducts: cards,
  });
}
const run = (d: DetectionInput) => coveredByCard(d, buildStreams(d));

describe("covered_by_card", () => {
  it("finds phone protection the card already gives, with its limits, when the bill's on the card", () => {
    const [finding, ...rest] = run(data());
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      type: "covered_by_card",
      key: "card:demo-card:merchant:asurion",
      title: "Your Demo Credit Card already covers what Asurion does",
      annualSavingsCents: 1700 * 12,
      confidence: "medium",
      evidence: {
        merchant: "Asurion",
        card: "Demo Credit Card",
        benefit: "Cell phone protection",
        condition: "you pay your phone bill with the card",
        limits: [
          { label: "Up to", cents: 80_000, text: "a claim" },
          { label: "Deductible", cents: 5_000, text: null },
          { label: "Claims a year", cents: null, text: "2" },
        ],
      },
    });
  });

  it("raises nothing when the person doesn't meet the card's condition", () => {
    expect(run(data({ phoneOn: CHECKING.id }))).toEqual([]);
  });

  it("raises nothing for a card the catalog doesn't know", () => {
    expect(run(data({ cards: {} }))).toEqual([]);
  });

  it("raises nothing when the plan covers more than the card", () => {
    expect(run(data({}, monthly(4, 2_900, { ...TRAVEL_INSURANCE, accountId: CARD.id })))).toEqual(
      [],
    );
  });

  it("checks rentals and trips were paid with the card", () => {
    const rentalCover = monthly(3, 900, {
      description: "BONZAH RENTAL COVER",
      merchantName: "Bonzah",
      accountId: CARD.id,
    });
    const rental = (accountId: string) =>
      tx({
        description: "HERTZ",
        pfcDetailed: "TRAVEL_RENTAL_CARS",
        amountCents: 32_000,
        accountId,
      });
    expect(run(data({}, [...rentalCover, rental(CARD.id)])).map((f) => f.key)).toEqual([
      "card:demo-card:merchant:asurion".replace("asurion", "bonzah"),
    ]);
    expect(run(data({}, [...rentalCover, rental(CARD.id), rental(CHECKING.id)]))).toEqual([]);
    expect(run(data({}, rentalCover))).toEqual([]);
  });

  it("is said as a duplicate, not a reshop, and cancelled through the usual flow", () => {
    const d = data();
    expect(insuranceReshop(d, buildStreams(d))).toEqual([]);
    const uncovered = data({ cards: {} });
    expect(insuranceReshop(uncovered, buildStreams(uncovered)).map((f) => f.key)).toEqual([
      "merchant:asurion",
    ]);
    expect(
      detect(d)
        .filter((c) => c.key.includes("asurion"))
        .map((c) => c.type),
    ).toEqual(["covered_by_card"]);
    const [candidate] = run(d);
    const card = buildCard({
      id: "f1",
      ...candidate,
      explanation: null,
      llmModel: null,
    } as never);
    expect(card.actionType).toBe("cancel_subscription");
    expect(card.whatChanges).toBe(
      "We cancel your Asurion plan for you. Your Demo Credit Card keeps covering you as long as you pay your phone bill with the card.",
    );
    expect(card.evidence.slice(0, 3)).toEqual([
      { date: null, label: "Cell phone protection: Up to (a claim)", amountCents: 80_000 },
      { date: null, label: "Cell phone protection: Deductible", amountCents: 5_000 },
      { date: null, label: "Cell phone protection: Claims a year 2", amountCents: null },
    ]);
    // An unrelated insurer is still reshopped.
    const geico = input({ transactions: monthly(4, 9_800, GEICO), cardProducts: DEMO_CARD });
    expect(insuranceReshop(geico, buildStreams(geico)).map((f) => f.key)).toEqual([
      "merchant:geico",
    ]);
  });
});

describe("the card-benefits catalog stand-in", () => {
  it("matches the demo card only for demo-bank people, and only credit cards", () => {
    const account = { id: "a", name: "Demo Credit Card", type: "credit", demo: true };
    expect(standInCatalog.productFor(account)?.id).toBe("demo-card");
    expect(standInCatalog.productFor({ ...account, demo: false })).toBeNull();
    expect(standInCatalog.productFor({ ...account, type: "depository" })).toBeNull();
    expect(cardProducts([account, { ...account, id: "b", name: "Other Card" }])).toEqual({
      a: "demo-card",
    });
  });

  it("has every entry reviewed, with limits said in words", () => {
    for (const product of CARD_CATALOG) {
      expect(product.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(product.benefits.length).toBeGreaterThan(0);
    }
    const phone = CARD_CATALOG[0].benefits.find((b) => b.kind === "phone")!;
    expect(limitWords(phone)).toBe("Up to $800.00 a claim, Deductible $50.00, Claims a year 2");
  });
});
