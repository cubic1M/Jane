import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";
import {
  chargeStoryReply,
  moneyFromPeopleReply,
  priceChangeReply,
  savingsTransfersReply,
  sentByAppReply,
  type MoveLine,
} from "./replies-money-moves";

// The backup chat's second batch of the walkers' misses (desktop sweeps 7 to 9, phone passes 5 to
// 7): each was unanswered or answered as another question.

const AS_OF = "2026-11-20";
const line = (
  date: string,
  amountCents: number,
  description: string,
  pfcDetailed: string | null = null,
): MoveLine => ({
  date,
  amountCents,
  description,
  merchantName: null,
  pfcDetailed,
  accountId: "chk",
});

describe("what these questions are read as", () => {
  it.each([
    ["What happened with the Amazon charge?", { kind: "charge_story", target: "amazon" }],
    ["How much does my mom send me?", { kind: "money_from_people" }],
    ["How much do I send on Venmo?", { kind: "sent_by_app", app: "venmo" }],
    ["How much do I put into savings each month?", { kind: "savings_moves" }],
    ["Should I switch Netflix plans?", { kind: "plan_switch", target: "netflix" }],
    ["What is my student loan rate?", { kind: "debt_detail", target: "student loan" }],
    ["How much card interest have I paid this year?", { kind: "card_interest", thisYear: true }],
    ["How much money will I have at the end of the month?", { kind: "balance_forecast" }],
  ])("%s", (question, intent) => {
    expect(parseIntent(question, AS_OF)).toEqual(intent);
  });

  it("leaves a price going up and the escrow to their own answers", () => {
    expect(parseIntent("When did Netflix go up?", AS_OF)).toEqual({
      kind: "about",
      target: "netflix",
    });
    expect(parseIntent("did my escrow go up", AS_OF)).toEqual({ kind: "mortgage" });
  });
});

describe("one merchant's charge", () => {
  const amazon = [
    line("2026-08-10", 1_239, "AMAZON MKTPL*1A2B3C AMZN.COM/BILL WA"),
    line("2026-09-12", 1_128, "AMAZON MKTPL*4D5E6F AMZN.COM/BILL WA"),
    line("2026-10-14", 1_350, "AMAZON MKTPL*7G8H9I AMZN.COM/BILL WA"),
    line("2026-11-13", 10_270, "AMAZON MKTPL*0J1K2L AMZN.COM/BILL WA"),
  ];

  it("says the latest against the usual, and a dispute when it's far above (desktop sweep 7)", () => {
    expect(chargeStoryReply("amazon", amazon).body).toBe(
      "Your latest Amazon charge was $102.70 on Nov 13, far above your usual $12.39. If it wasn't you, ask your bank to dispute it.",
    );
  });

  it("says plainly when there's no such charge", () => {
    expect(chargeStoryReply("target", amazon).body).toBe(
      "I don't see a charge at target in what I have, so I can't answer that from it.",
    );
  });

  it("says when a price went up, and what it is a year", () => {
    const netflix = ["2026-06-03", "2026-07-03", "2026-08-03", "2026-09-03", "2026-10-03"].map(
      (d, i) => line(d, i < 3 ? 1_549 : 1_799, "NETFLIX.COM"),
    );
    expect(priceChangeReply("netflix", netflix).body).toBe(
      "Netflix went up on Sep 3, 2026, from $15.49 to $17.99 a month: $30.00 a year more.",
    );
  });
});

describe("money moved by app and to savings", () => {
  it("gives what people sent by app, and says it can't tell who's who (desktop sweep 7)", () => {
    const venmo = ["2026-08-20", "2026-09-20", "2026-10-20"].map((d) =>
      line(d, -20_000, "VENMO CASHOUT", "TRANSFER_IN_TRANSFER_IN_FROM_APPS"),
    );
    expect(moneyFromPeopleReply(venmo).body).toBe(
      "People sent you $200.00 by Venmo on Aug 20, Sep 20 and Oct 20 ($600.00 in all). The bank's lines don't say who's who to you, so I can't tell which is from your mom.",
    );
  });

  it("gives what went out by Venmo (Plaid S4)", () => {
    const sent = [
      line("2026-09-18", 4_000, "VENMO PAYMENT 1023456789"),
      line("2026-10-18", 4_000, "VENMO PAYMENT 1023456790"),
    ];
    expect(sentByAppReply("venmo", sent).body).toBe(
      "You've sent $80.00 by Venmo since Sep 18 (2 times), about $40.00 a month.",
    );
  });

  it("gives a month into savings (upload S6)", () => {
    const ally = ["2026-08-20", "2026-09-20", "2026-10-20"].map((d) =>
      line(d, 20_000, "ONLINE TRANSFER TO ALLY BANK SAVINGS"),
    );
    expect(savingsTransfersReply(ally).body).toMatch(
      /^You move about \$200\.00 a month into savings(?:, to [^:]+)?: \$600\.00 in 3 transfers since Aug 20\.$/,
    );
  });

  it("says plainly when nothing went to savings", () => {
    expect(savingsTransfersReply([line("2026-10-01", 1_000, "STARBUCKS")]).body).toBe(
      "I don't see money moved into savings in what I have, so I can't answer that from it.",
    );
  });
});
