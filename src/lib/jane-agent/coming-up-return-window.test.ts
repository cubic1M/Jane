import { describe, expect, it } from "vitest";
import { comingUp } from "@/insights/coming-up";
import type { Deadline } from "@/insights/deadlines";
import { parseIntent } from "./intents";
import { comingUpReply } from "./replies";

// Debug 3, 11-18 (Claude unreachable, so the chat answers from the data; Plaid sandbox student):
// "what bills do I have?" said "5 things are coming up, $1,053.92 in all." Two of the five were
// return windows (Best Buy $899.00, Amazon $102.70): the day a purchase can last go back, not money
// owed. His bills came to $52.22. A return window is listed with its purchase, not added in.

const asOf = "2026-11-18";
const returnWindow = (merchant: string, date: string, amountCents: number): Deadline => ({
  key: `return:${merchant}`,
  title: `Return window for ${merchant}`,
  date,
  kind: "return",
  source: "transactions",
  amountCents,
  href: null,
  detail: null,
});
const bill = (merchant: string, date: string, amountCents: number) => ({
  merchant,
  date,
  amountCents,
});

describe("what's coming up, with return windows among it", () => {
  const rows = comingUp(
    [bill("ChatGPT", "2026-12-16", 2_000), bill("Netflix", "2026-12-16", 1_957)],
    [returnWindow("Best Buy", "2026-12-01", 89_900), returnWindow("Amazon", "2026-12-13", 10_270)],
    asOf,
    { days: 30, limit: 10 },
  );

  it("adds up only what's owed", () => {
    const intent = parseIntent("what bills do I have?", asOf);
    if (intent.kind !== "coming_up") throw new Error(intent.kind);
    const body = comingUpReply(intent, rows).body;
    expect(body.split("\n")[0]).toBe("4 things are coming up, $39.57 in all.");
  });

  it("still lists each return window with its purchase", () => {
    const intent = parseIntent("what bills do I have?", asOf);
    if (intent.kind !== "coming_up") throw new Error(intent.kind);
    expect(comingUpReply(intent, rows).body).toContain("Return window for Best Buy, $899.00");
  });
});
