import { describe, expect, it } from "vitest";
import { DUPLICATE_CHARGE_PER_SEAT_CATEGORIES } from "@/config/detection";
import { AS_OF, CARD, CHECKING, NETFLIX, input, monthly, tx } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput, DetectionTransaction } from "../types";
import { addDays } from "../units";
import { duplicateCharge } from "./duplicate-charge";

const run = (data: DetectionInput) => duplicateCharge(data, buildStreams(data));
const charge = (daysAgo: number, overrides: Partial<DetectionTransaction> = {}) =>
  tx({
    accountId: CARD.id,
    date: addDays(AS_OF, -daysAgo),
    amountCents: 4_999,
    description: "GADGET SHOP 12",
    merchantName: "Gadget Shop",
    pfcPrimary: "GENERAL_MERCHANDISE",
    ...overrides,
  });

describe("duplicate_charge", () => {
  it("still finds a streaming plan charged twice, though cinemas share its category", () => {
    const plan = monthly(4, 1549, NETFLIX);
    const last = plan[plan.length - 1];
    const again = { ...last, id: `${last.id}-again` };
    expect(run(input({ transactions: [...plan, again] }))).toEqual([
      expect.objectContaining({ type: "duplicate_charge" }),
    ]);
  });

  // CSV bench, second tuning set: each order carries its own number after the "*".
  it("never calls two orders with their own order numbers a double charge", () => {
    const amazon = { merchantName: null, pfcPrimary: "GENERAL_MERCHANDISE" };
    const two = [
      charge(5, { ...amazon, description: "AMZN Mktp US*2K4L91Z3" }),
      charge(5, { ...amazon, description: "AMZN Mktp US*7HQ2MX0PB" }),
    ];
    expect(run(input({ transactions: two }))).toEqual([]);
    // The same order number twice is the card run twice.
    const same = [two[0], { ...two[0], id: `${two[0].id}-again` }];
    expect(run(input({ transactions: same }))).toHaveLength(1);
  });

  it("never calls two plans billed together every month a double charge", () => {
    const plan = monthly(4, 1549, NETFLIX);
    const twins = plan.flatMap((t) => [t, { ...t, id: `${t.id}-b` }]);
    expect(run(input({ transactions: twins }))).toEqual([]);
    // Once, it is one.
    const last = plan[plan.length - 1];
    expect(run(input({ transactions: [...plan, { ...last, id: `${last.id}-b` }] }))).toHaveLength(
      1,
    );
  });

  it("finds the second of two identical charges a day apart, as a refund", () => {
    const second = charge(9);
    const [finding] = run(input({ transactions: [charge(10), second] }));

    expect(finding).toMatchObject({
      type: "duplicate_charge",
      key: `transaction:${second.id}`,
      title: "Charged twice? $49.99 at Gadget Shop",
      annualSavingsCents: 4_999,
      confidence: "medium",
    });
    expect(finding.evidence.charges).toHaveLength(2);
  });

  it("finds a big restaurant bill charged twice", () => {
    const dinner = { pfcPrimary: "FOOD_AND_DRINK", amountCents: 6_840 };
    expect(run(input({ transactions: [charge(10, dinner), charge(9, dinner)] }))).toHaveLength(1);
  });

  it("ignores look-alikes", () => {
    const none = (transactions: DetectionTransaction[]) =>
      expect(run(input({ transactions }))).toEqual([]);
    // Different amounts, or days apart.
    none([charge(10), charge(9, { amountCents: 5_000 })]);
    none([charge(10), charge(6)]);
    // Two accounts.
    none([charge(10), charge(10, { accountId: CHECKING.id })]);
    // Lunch twice, or a small repeat. (A dinner bill of DUPLICATE_CHARGE_MEAL_MIN_CENTS or more
    // twice is a double charge: below.)
    none([
      charge(10, { pfcPrimary: "FOOD_AND_DRINK", amountCents: 1_250 }),
      charge(10, { pfcPrimary: "FOOD_AND_DRINK", amountCents: 1_250 }),
    ]);
    none([charge(10, { amountCents: 500 }), charge(10, { amountCents: 500 })]);
    // Already refunded by the merchant.
    none([charge(10), charge(10), charge(8, { amountCents: -4_999 })]);
    // Too old to dispute.
    none([charge(90), charge(90)]);
    // Two concert tickets, or two fares: a seat each.
    const seat = (pfcDetailed: string) => ({
      pfcPrimary: pfcDetailed.split("_")[0],
      pfcDetailed,
    });
    for (const category of DUPLICATE_CHARGE_PER_SEAT_CATEGORIES) {
      none([charge(10, seat(category)), charge(10, seat(category))]);
    }
    const cinema = { description: "AMC THEATRES 2201", merchantName: null };
    none([charge(10, cinema), charge(10, cinema)]);
    // Two seats at a cinema filed with TV and movies, at a place with no regular charge.
    const cinema2 = {
      description: "GRAND PALACE 042",
      merchantName: null,
      pfcPrimary: "ENTERTAINMENT",
      pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
    };
    none([charge(10, cinema2), charge(10, cinema2)]);
    // A film house or a ticket seller, by its words.
    const films = { description: "ROXY FILM CENTER", merchantName: null };
    none([charge(10, films), charge(10, films)]);
    // Three at one price on one day, at a place whose name says nothing: a group's seats.
    const hall = { description: "GRAND HALL 042", merchantName: null };
    none([charge(10, hall), charge(10, hall), charge(10, hall)]);
    // A cinema chain whose descriptor is its name alone (CSV bench).
    const amc = { description: "AMC 0517 ONLINE", merchantName: null };
    none([charge(10, amc), charge(10, amc)]);
    // Two overdraft fees on one day: the bank fees finding's.
    const overdraft = { pfcPrimary: "BANK_FEES", pfcDetailed: "BANK_FEES_OVERDRAFT_FEES" };
    none([charge(10, overdraft), charge(10, overdraft)]);
  });
});
