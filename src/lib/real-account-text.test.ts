import { describe, expect, it } from "vitest";
import { ADVICE_TOPICS } from "@/config/suggestions";
import { PEOPLE } from "@/config/people";
import { runDetectors } from "@/detectors";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { gather } from "@/lib/jane-agent/brain";
import type { Snapshot } from "@/lib/jane-agent/snapshot";
import { forRealAccount } from "./suggestions";
import { tellsThemToAct } from "./real-account-text";

describe("hand-written text for a real account", () => {
  it.each([
    "Stop your HSA deposits and take the extra out before you file",
    "Take the rest of your inherited IRA out by December 31",
    "Set aside about $120.00 from each week's sales for the tax bill",
    "Keep the bills and receipts, and ask whoever does your return to itemize.",
    "Itemize: it's worth more than the standard deduction.",
    "Keep this year's income under $212,000: Medicare's surcharge line",
    "To stay under it, keep pre-tax withdrawals and conversions this year under about $9,000.",
    "Fix 2 things in your 2026 draft return before you file",
    "You should sell the fund and buy bonds.",
    "Put the extra in your Roth.",
    "Add a $1,000,000 umbrella policy.",
    "Add term life insurance worth about 10 times your yearly pay.",
    "Open a donor-advised fund",
    "Move card debt into one loan",
    "With the bonus, itemizing saves about $400.",
  ])("catches what tells them to act: %s", (text) => {
    expect(tellsThemToAct(text)).toBe(true);
  });

  it.each([
    "Your 401(k) funds cost $640.00 a year.",
    "You hold $9,000.00 in an annuity.",
    "Your HSA deposits are over this year's limit",
    "Your inherited IRA has to be empty by December 31",
    "2 lines in your 2026 draft return don't match your records",
    "Keep your medical receipts: this year's may count on your return",
    "Ask for an itemized bill, and for financial help or a no-interest plan, on your medical bills",
    "Move my tax deadlines",
    "To ease it: move the Student Loan ····4821 due date to the 3rd",
    "I can see what's in your investment accounts now: 3 holdings worth $9,000.00.",
    "Your Netflix price went up: cancel it, or take it to the cheaper plan.",
    "Put $200.00 toward the Con Ed bill.",
    "Something went wrong. Open Taxes instead.",
    "Open the tax-time pack",
    "Start with: Car Loan ····7005 payment.",
    "Good morning! You have $719.04 safe to spend. Start with: Student Loan ····1004 payment.",
    "I can't move money in your bank yet, but it takes a minute: move $50.00 to your emergency fund.",
    "Add RSUs vested, ESPP shares sold or ISOs exercised and I'll work out the tax.",
    "No checkup yet. Add a policy, or check now.",
    "I don't have your deductible yet. Add it from your policy and I'll look.",
    "Add your plan on your insurance page and I'll track the year.",
  ])("leaves a fact or an everyday task alone: %s", (text) => {
    expect(tellsThemToAct(text)).toBe(false);
  });

  it("holds back a card that gives advice under a topic filed as a fact", () => {
    const card = { topic: "beneficiaries", headline: "x", short: "x", why: "x" } as const;
    expect(forRealAccount({ ...card, title: "Sell your stock fund this week" })).toBe(false);
    expect(forRealAccount({ ...card, title: "Nobody is named on this account" })).toBe(true);
    expect(forRealAccount({ ...card, topic: "rebalance", title: "Nobody is named" })).toBe(false);
  });

  it("has no card for a real account, across the sample people, that tells them to act", () => {
    const told = PEOPLE.flatMap((person) => {
      const input = inputFor(person.id);
      return runDetectors({ profile: buildProfile(input), data: input })
        .filter((s) => !(ADVICE_TOPICS as readonly string[]).includes(s.topic))
        .filter((s) => !forRealAccount(s))
        .map((s) => `${person.id}: ${s.topic}: ${s.title}`);
    });
    expect(told).toEqual([]);
  });

  it("never gathers a message that tells a real account to act, from any source", () => {
    const source = {
      key: "any",
      gather: () => [
        {
          kind: "decision",
          body: "Sell your stock fund.",
          refs: {},
          actions: [],
          dedupeKey: "a",
          priority: 1,
        },
        {
          kind: "decision",
          body: "Your fund costs $9.00.",
          refs: {},
          actions: [],
          dedupeKey: "b",
          priority: 1,
        },
      ],
    };
    const snapshot = { timezone: "UTC" } as unknown as Snapshot;
    const settings = { trigger: "open", sources: [source] } as never;
    const now = new Date("2026-11-04T12:00:00Z");
    const keys = (s: object) =>
      gather(snapshot, now, { ...(settings as object), ...s } as never).map((m) => m.dedupeKey);
    expect(keys({ realAccount: true })).toEqual(["any:b"]);
    expect(keys({ realAccount: false })).toEqual(["any:a", "any:b"]);
  });
});
