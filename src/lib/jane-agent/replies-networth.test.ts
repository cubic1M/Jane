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
      missing: ["x"],
    } as never);
    expect(reply.body).toBe(
      "Your net worth is $7,500.00: you have $10,000.00 and owe $2,500.00. That includes $50.00 of crypto I only read. 1 account has no balance yet, so it isn't counted.",
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
    } as never);
    expect(reply.body).toMatch(/link an account/);
  });
});
