import { describe, expect, it } from "vitest";
import type { Charge, Recurring } from "./recurring";
import { costReply, paydayReply, subscriptionsReply } from "./recurring-replies";
import type { Snapshot, SnapshotFinding } from "./snapshot";

// Spec step 88: what one thing costs, the subscriptions list and the next payday, each from
// the person's own numbers, with the buttons of anything Jane found about it.

const TODAY = "2026-10-18";

const charge = (over: Partial<Charge>): Charge => ({
  key: over.merchant ?? "x",
  merchant: "Netflix",
  frequency: "MONTHLY",
  lastAmountCents: 1_799,
  lastDate: "2026-10-14",
  nextDate: "2026-11-14",
  annualCostCents: 21_588,
  subscription: true,
  openFindingId: null,
  ...over,
});
const recurring: Recurring = {
  charges: [
    charge({ merchant: "Planet Fitness", lastAmountCents: 2_499, annualCostCents: 29_988 }),
    charge({ openFindingId: "f1" }),
    charge({ merchant: "Hulu", lastAmountCents: 1_199, annualCostCents: 14_388 }),
    charge({
      merchant: "Verizon Wireless",
      lastAmountCents: 14_500,
      annualCostCents: 174_000,
      subscription: false,
    }),
    charge({
      merchant: "Duolingo",
      frequency: "QUARTERLY",
      lastAmountCents: 2_999,
      annualCostCents: 11_996,
    }),
  ],
  nextIncome: { date: "2026-11-01", from: "Acme Corp Payroll", amountCents: 240_000 },
};
const finding: SnapshotFinding = {
  findingId: "f1",
  type: "subscription_review",
  title: "Review your Netflix subscription",
  annualSavingsCents: 21_588,
  savings: "Could save about $215.88 a year",
  fingerprint: "fp1",
  urgent: false,
  pick: null,
};
const snapshot = { timezone: null, findings: [finding] } as unknown as Snapshot;
const ids = (r: { actions: { id: string }[] } | null) => r?.actions.map((a) => a.id);

describe("costReply", () => {
  it("gives the price, a year's cost and the next charge, then Jane's suggestion", () => {
    const reply = costReply({ target: "netflix", year: false }, recurring, snapshot, TODAY)!;
    expect(reply.body).toBe(
      "Netflix is $17.99 a month, $215.88 a year. The next charge is Nov 14 (in 27 days).\nReview your Netflix subscription. Could save about $215.88 a year. Want me to handle it?",
    );
    expect(ids(reply)).toEqual([
      "finding.yes",
      "finding.no",
      "finding.why",
      "suggest.never",
      "snooze",
      "open",
    ]);
    expect(reply.refs.topic).toEqual({ kind: "cost", target: "Netflix", findingId: "f1" });
  });

  it("answers a year when asked, everyday names, and other schedules", () => {
    expect(costReply({ target: "phone", year: true }, recurring, snapshot, TODAY)?.body).toMatch(
      /^Verizon Wireless costs you \$1,740\.00 a year \(\$145\.00 a month\)\./,
    );
    expect(costReply({ target: "gym", year: false }, recurring, null, TODAY)?.body).toMatch(
      /^Planet Fitness is \$24\.99 a month/,
    );
    const duolingo = costReply({ target: "duolingo", year: false }, recurring, null, TODAY)!;
    expect(duolingo.body).toMatch(/^Duolingo is \$29\.99 every 3 months, \$119\.96 a year\./);
    expect(ids(duolingo)).toEqual(["open"]);
  });

  it("asks which when a name fits more than one, and is null when it fits none", () => {
    const two = {
      ...recurring,
      charges: [...recurring.charges, charge({ merchant: "Netflix Kids", openFindingId: null })],
    };
    const which = costReply({ target: "netflix", year: false }, two, null, TODAY)!;
    expect(which.body).toBe("Which one do you mean?");
    expect(ids(which)).toEqual(["clarify.1", "clarify.2"]);
    expect(which.refs.choices?.[1]).toEqual({
      label: "Netflix Kids",
      intent: { kind: "cost", target: "Netflix Kids", year: false },
    });
    expect(costReply({ target: "rent", year: false }, recurring, null, TODAY)).toBeNull();
  });
});

describe("subscriptionsReply", () => {
  it("lists them, most expensive first, with what they come to and the biggest saving", () => {
    const reply = subscriptionsReply({ total: false, all: false }, recurring, snapshot);
    expect(
      reply.body.startsWith(
        "You have 4 subscriptions, about $64.97 a month in all, led by Planet Fitness $24.99 a month.",
      ),
    ).toBe(true);
    expect(reply.body.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3);
    expect(reply.body).toContain("Review your Netflix subscription: could save about");
    expect(ids(reply)).toEqual([
      "finding.yes",
      "finding.no",
      "finding.why",
      "suggest.never",
      "snooze",
      "open",
      "open",
    ]);
  });

  it("gives the total as the answer, and every bill when asked", () => {
    expect(subscriptionsReply({ total: true, all: false }, recurring, null).body).toBe(
      "You spend about $64.97 a month on 4 subscriptions, $779.60 a year. The biggest: Planet Fitness $24.99 a month, Netflix $17.99 a month, Hulu $11.99 a month.",
    );
    expect(subscriptionsReply({ total: false, all: true }, recurring, null).body).toMatch(
      /^You have 5 regular charges/,
    );
    expect(
      subscriptionsReply({ total: false, all: false }, { charges: [], nextIncome: null }, null)
        .body,
    ).toBe("I don't see any subscriptions yet.");
  });
});

describe("paydayReply", () => {
  it("gives the date, how far off and about how much", () => {
    expect(paydayReply(recurring, TODAY).body).toBe(
      "Your next payday is Nov 1 (in 14 days): about $2,400.00 from Acme Corp Payroll.",
    );
    expect(paydayReply({ charges: [], nextIncome: null }, TODAY).body).toMatch(
      /^I don't see a regular paycheck yet\./,
    );
  });
});
