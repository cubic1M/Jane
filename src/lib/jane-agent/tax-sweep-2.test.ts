import { describe, expect, it, vi } from "vitest";

vi.mock("@/planning/tax-estimate", () => ({
  estimateTaxes: () => ({ totalTaxCents: 0, state: null }),
}));

import { parseIntent } from "./intents";
import { moveReply } from "./tax-states-message";
import { refundMessage } from "./tax-refund-message";
import { investmentsReply } from "./tax-investments";
import { selfEmployedReply } from "./tax-replies";
import { identityReply } from "./tax-identity-message";
import { parseTaxIntent } from "./tax-intents";
import type { TaxIntent } from "./tax-intents";

// CodeRabbit part 2 (root-14): tax questions routed to the right answer, and answers that say what
// is true of the view they were given.

const parse = (text: string) => parseIntent(text, "2026-11-20");

describe("tax questions, routed", () => {
  it("leaves a plain 'how much do I owe' to the debts, and keeps the tax ones", () => {
    expect(parse("how much do i owe")).toEqual({ kind: "debts" });
    // A bare "will I owe" is about the year's tax (the tax chat's own question); "do I owe" is debts.
    expect(parse("how much will i owe")).toMatchObject({ kind: "tax", ask: "decide" });
    expect(parse("how much tax do i owe")).toMatchObject({ kind: "tax", ask: "decide" });
    expect(parse("how much will i owe in taxes")).toMatchObject({ kind: "tax", ask: "decide" });
  });

  it("keeps the year said in a move", () => {
    expect(parse("i moved from california to texas in june last year")).toMatchObject({
      ask: "move",
      month: 6,
      relativeYear: "last",
    });
    // 11-20: June is already past, so with no year said it is this year.
    expect(parse("i moved from california to texas in june")).not.toHaveProperty("relativeYear");
    const intent = parse("i moved from california to texas in june last year") as TaxIntent & {
      from: string;
      to: string;
      month: number;
      day: null;
      relativeYear: "last";
    };
    const reply = moveReply(intent, "CA", new Date("2026-11-20T12:00:00Z"));
    expect(reply.body).toMatch(/, 2025/);
    expect(reply.refs.taxYear).toBe(2025);
  });

  it("reads a tag command as a tag, not as the home topic", () => {
    expect(parseTaxIntent("tag mortgage interest as rental")).toMatchObject({ ask: "tag" });
    expect(parseTaxIntent("untag mortgage interest")).toMatchObject({ ask: "tag", tag: null });
    // CodeRabbit #2294: the "don't tag" forms reach the tag command, not the debts or the home.
    for (const text of [
      "don't tag mortgage interest",
      "do not tag mortgage interest",
      "stop tagging mortgage interest",
    ]) {
      expect(parse(text)).toMatchObject({ kind: "tax", ask: "tag", tag: null });
    }
  });
});

describe("tax answers, as far as the view says", () => {
  it("offers no setup for a refund already set up", () => {
    const view = {
      refund: {
        to: "federal",
        cents: 120_000,
        date: "2026-03-02",
        transactionId: "t1",
        taxYear: 2025,
      },
      match: null,
      handled: true,
      plan: { items: [{ cents: 120_000, label: "your emergency fund" }], leftCents: 0 },
    } as never;
    const reply = refundMessage(view);
    expect(reply.actions.map((a) => ("id" in a ? a.id : ""))).not.toContain("tax.refund_apply");
  });

  it("puts the wash-sale condition beside a harvest saving", () => {
    const view = {
      taxableAccounts: 1,
      holdingsKnown: true,
      year: 2026,
      realisedCents: { shortTerm: 0, longTerm: 0 },
      unrealisedCents: { total: 0, longTerm: 0 },
      washSales: [],
      harvest: [
        {
          holding: { name: "Fund X", ticker: "FNDX" },
          lossCents: 200_000,
          washRisk: { reinvests: true, boughtRecently: false },
        },
      ],
    } as never;
    const estimate = {
      estimate: { totalTaxCents: 0, state: null },
      input: { income: { shortTermGainsCents: 0, longTermGainsCents: 0 } },
    } as never;
    const said = investmentsReply(view, estimate, true);
    expect(said.body).toMatch(/That holds only if you turn off its dividend reinvestment first/);
    // CodeRabbit #2294: the day count is inclusive, and with no known risk the future purchase
    // is still a condition.
    const recent = {
      ...(view as { harvest: { washRisk: object }[] }),
      harvest: [
        {
          ...(view as { harvest: object[] }).harvest[0],
          washRisk: { reinvests: false, boughtRecently: true },
        },
      ],
    } as never;
    expect(investmentsReply(recent, estimate, true).body).toMatch(/is more than 30 days past/);
    const none = {
      ...(view as object),
      harvest: [
        {
          ...(view as { harvest: object[] }).harvest[0],
          washRisk: { reinvests: false, boughtRecently: false },
        },
      ],
    } as never;
    expect(investmentsReply(none, estimate, true).body).toMatch(
      /only if you do not buy it again, or something substantially identical, within 30 days after selling/,
    );
  });

  it("names the state payment still to make when no federal one is left", () => {
    const view = {
      active: true,
      advice: true,
      year: 2026,
      recent: [],
      setAsideRate: 0.25,
      federal: { needed: false, owedCents: 0, payments: [] },
      state: { payments: [{ date: "2026-12-15", cents: 80_000 }] },
    } as never;
    const reply = selfEmployedReply({ kind: "tax", ask: "paid" } as never, view, "2026-11-20");
    expect(reply.body).toMatch(/state estimate still has \$800 due Dec 15/);
  });

  it("says the PIN tool is unavailable in the direct reply too", () => {
    const view = { year: 2026, havePin: false, toolOpen: false, case: null } as never;
    const body = identityReply(view, null).body;
    expect(body).toMatch(/Identity Protection PIN/);
    expect(body).toMatch(/online tool is off/);
  });
});
