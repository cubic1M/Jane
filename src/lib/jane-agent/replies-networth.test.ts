import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";
import { netWorthReply } from "./replies-networth";

describe("net worth in the chat", () => {
  it.each(["what's my net worth", "networth", "how much am i worth", "what do i own and owe"])(
    "reads %j",
    (text) => {
      expect(parseIntent(text, "2026-10-20")).toEqual({ kind: "net_worth" });
    },
  );

  it("says what they own less what they owe, first", () => {
    const reply = netWorthReply({
      assetsCents: 1_000_000,
      debtsCents: 250_000,
      netCents: 750_000,
      cryptoCents: 5_000,
      missing: ["Citi card"],
      unbalanced: [{ name: "Citi card", card: true }],
      known: true,
    } as never);
    expect(reply.body).toBe(
      "Your net worth is $7,500.00: you have $10,000.00 and owe $2,500.00. That includes $50.00 of crypto I only read. Not counting your Citi card balance: the file doesn't say it yet.",
    );
    expect(reply.actions[0]).toMatchObject({ href: "/net-worth" });
  });

  it("asks for an account when there's nothing to add up", () => {
    const reply = netWorthReply({
      assetsCents: 0,
      debtsCents: 0,
      netCents: 0,
      cryptoCents: 0,
      missing: [],
      unbalanced: [],
      known: false,
    } as never);
    expect(reply.body).toMatch(/add your accounts/);
  });

  // QA rounds 6-7 and the CSV bench's skipped-balance path: accounts there, no balance on any.
  it("says it doesn't know yet, never $0, when no balance is known", () => {
    const reply = netWorthReply({
      assetsCents: 0,
      debtsCents: 0,
      netCents: 0,
      cryptoCents: 0,
      missing: ["Wells Fargo checking", "Citi card"],
      unbalanced: [
        { name: "Wells Fargo checking", card: false },
        { name: "Citi card", card: true },
      ],
      known: false,
    } as never);
    expect(reply.body).toBe(
      "I don't know your net worth yet. Not counting your Wells Fargo checking or Citi card balances: the files don't say them yet. Add a balance and I'll add it up.",
    );
    expect(reply.body).not.toMatch(/\$0/);
  });
});
