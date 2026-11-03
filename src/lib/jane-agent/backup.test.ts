import { describe, expect, it, vi } from "vitest";

vi.mock("@/detection/engine", () => ({ loadTransactionsBetween: vi.fn() }));
import {
  namedPayees,
  payeeFactsReply,
  questionParts,
  rulesCoverQuestion,
  type PayeeTotals,
} from "./backup";
import { SPENDING_NOT_FOUND, type Reply } from "./replies";

// Founder 10-30: when Claude couldn't answer, the rules answered "spend for that earning" as a
// spending category. The backup answers only a question the rules read whole, and otherwise gives
// what came in and went out for the names the person typed. Made-up rows shaped like a prop
// trading firm's payouts and fees, never the founder's data.

const FOUNDER =
  "How much tax will I have to pay because of lucid trading? How much did I earn from them, how much did I actually spend for that earning";

const row = (description: string, amountCents: number, merchantName: string | null = null) => ({
  date: "2026-09-01",
  amountCents,
  description,
  merchantName,
});
const ROWS = [
  row("LUCID TRADING PAYOUT ACH CREDIT", -150_000),
  row("LUCID TRADING PAYOUT ACH CREDIT", -170_000),
  row("LUCIDTRADING.COM EVALUATION", 14_900, "Lucid Trading"),
  row("LUCID TRADING RESET FEE", 8_500),
  row("NETFLIX.COM", 1_549, "Netflix"),
  row("SHELL OIL 12345", 4_210),
];
const reply = (body: string): Reply => ({ body, actions: [], refs: {} });

describe("questionParts", () => {
  it("finds each question in a message", () => {
    expect(questionParts(FOUNDER)).toEqual([
      "How much tax will I have to pay because of lucid trading",
      "How much did I earn from them",
      "how much did I actually spend for that earning",
    ]);
    expect(questionParts("what did I spend on food and how much is netflix?")).toHaveLength(2);
    expect(questionParts("how much did I spend on food and drinks this month?")).toHaveLength(1);
    expect(questionParts("hi")).toEqual([]);
  });
});

describe("namedPayees", () => {
  it("finds the firm the person named, with what came in and went out", () => {
    expect(namedPayees(FOUNDER, ROWS)).toEqual([
      { name: "Lucid Trading", inCents: 320_000, inCount: 2, outCents: 23_400, outCount: 2 },
    ]);
  });

  it("finds a name typed on its own, and nothing for everyday words", () => {
    expect(namedPayees("what did lucid pay me", ROWS).map((p) => p.name)).toEqual(["Lucid"]);
    expect(namedPayees("how much did I earn and spend this year", ROWS)).toEqual([]);
    expect(namedPayees("can I deduct my trading fees", ROWS)).toEqual([]);
  });
});

describe("everyday words aren't payees", () => {
  const rows = [
    row("THANK YOU PAYMENT", -85_000),
    row("TRANSFER FROM CHECKING", -25_000),
    row("OVERDRAFT FEE", 3_400),
    row("WHOLE FOODS MARKET", 6_000, "Whole Foods Market"),
    row("TARGET STORE 1234", 4_000, "Target"),
    row("HULU", 1_199, "Hulu"),
  ];
  // 11-03: "thank you!" got "$8,500.00 came in from Thank".
  it.each([
    "thank you!",
    "how much is in my checking",
    "am i going to overdraft",
    "get me a discount at the store",
    "what about the market",
  ])("%s names no one", (text) => {
    expect(namedPayees(text, rows)).toEqual([]);
  });
  it.each([
    ["no hulu", "Hulu"],
    ["what did i spend at target", "Target"],
    ["whole foods this year", "Whole Foods"],
  ])("%s names who it says", (text, name) => {
    expect(namedPayees(text, rows)[0]?.name).toBe(name);
  });
});

describe("what the person named has to be in the answer", () => {
  const covered = (text: string, body: string) =>
    rulesCoverQuestion({
      text,
      intent: { kind: "payday" },
      reply: reply(body),
      partsAnswered: 0,
      payees: [],
    });
  it.each([
    ["should i get a roth ira", "In your taxable accounts there's $3.00 of gains."],
    ["is my annuity worth it", "advisory fees: $124.80 in the last 12 months."],
    ["should i pay my card or put money in my 401k", "Paying bills needs a partner."],
    ["call my landlord for me", "Demo home is worth $380,000.00."],
    ["should i pay extra on my mortgage or invest", "Demo Credit Card costs 22.99% a year."],
    ["should we save for college", "You owe $5.00."],
    ["get me a mortgage today", "Your Demo Home Loan: $312,400.00."],
    ["sell all my stocks", "You have 9 holdings."],
  ])("%s isn't answered by that", (text, body) => {
    expect(covered(text, body)).toBe(false);
  });
  it.each([
    ["should i max my hsa", "I don't see an HSA yet."],
    ["whats my rmd", "Required minimum distributions start at 75."],
    ["how much is in my 401k", "Your Demo 401(k) has $84,250.40."],
    ["whats my mortgage rate", "Your Demo Home Loan: 3.99%."],
    ["whats a 529", "College savings plans are only in demo advice mode."],
  ])("%s is answered by that", (text, body) => {
    expect(covered(text, body)).toBe(true);
  });
});

describe("rulesCoverQuestion", () => {
  const payees = namedPayees(FOUNDER, ROWS);
  const spending = { kind: "spending", category: "earning", month: "2026-10" } as const;

  it("refuses the founder's misread: three questions, a category that isn't one", () => {
    expect(
      rulesCoverQuestion({
        text: FOUNDER,
        intent: spending,
        reply: reply(`${SPENDING_NOT_FOUND} "earning" in October 2026 so far.`),
        partsAnswered: 0,
        payees,
      }),
    ).toBe(false);
  });

  it("refuses an answer that leaves out who they named", () => {
    expect(
      rulesCoverQuestion({
        text: "how much did lucid trading pay me",
        intent: { kind: "unknown" },
        reply: reply("You earned $5,000.00 this month."),
        partsAnswered: 0,
        payees,
      }),
    ).toBe(false);
    expect(
      rulesCoverQuestion({
        text: "how much did I spend at lucid trading",
        intent: { kind: "spending", category: "lucid trading", month: "2026-10" },
        reply: reply("You spent $234.00 at Lucid Trading in October 2026."),
        partsAnswered: 0,
        payees,
      }),
    ).toBe(true);
  });

  it("takes two parts only when both were answered", () => {
    const text = "how much can I spend and when is payday";
    const intent = { kind: "safe_to_spend" } as const;
    const ok = reply("You have $500.00 to spend.\n\nPayday is Oct 30.");
    expect(rulesCoverQuestion({ text, intent, reply: ok, partsAnswered: 2, payees: [] })).toBe(
      true,
    );
    expect(rulesCoverQuestion({ text, intent, reply: ok, partsAnswered: 0, payees: [] })).toBe(
      false,
    );
  });

  it("takes a plain one-part answer", () => {
    expect(
      rulesCoverQuestion({
        text: "how much did I spend on food this month",
        intent: { kind: "spending", category: "food", month: "2026-10" },
        reply: reply("You spent $412.00 on Food and drink in October 2026."),
        partsAnswered: 0,
        payees: [],
      }),
    ).toBe(true);
  });
});

describe("payeeFactsReply", () => {
  const lucid: PayeeTotals = {
    name: "Lucid Trading",
    inCents: 320_000,
    inCount: 2,
    outCents: 23_400,
    outCount: 2,
  };

  it("says it couldn't answer, then the totals and the net, and that it can't advise on tax", () => {
    expect(payeeFactsReply(FOUNDER, [lucid]).body).toBe(
      "I couldn't write a full answer to that just now. This year in your accounts, $3,200.00 came in from Lucid Trading (2 payments) and $234.00 went out to it (2 charges), so $2,966.00 more in than out. I can't tell you what to file or deduct.",
    );
  });

  it("leaves the tax line out of a question that isn't about tax, and says the limit first", () => {
    const body = payeeFactsReply("what did lucid trading pay me", [lucid], {
      limitNote: "I've hit today's limit for written answers, back tomorrow.",
    }).body;
    expect(body).toMatch(/^I've hit today's limit/);
    expect(body).not.toMatch(/file or deduct/);
  });

  it("never names a category breakdown", () => {
    expect(payeeFactsReply(FOUNDER, [lucid]).body).not.toMatch(/The most went to/);
  });
});
