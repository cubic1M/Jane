import { describe, expect, it } from "vitest";
import {
  DEADLINE_HORIZON_DAYS,
  DEADLINE_REMINDER_DAYS,
  RETURN_MIN_CENTS,
  RETURN_REMINDER_DAYS,
  RETURN_WINDOW_DAYS,
  TRIAL_LENGTH_DAYS,
} from "@/config/deadlines";
import { AS_OF, CARD, input, plaidStream, tx } from "@/detection/__fixtures__/build";
import { buildStreams } from "@/detection/streams";
import type { DetectionInput } from "@/detection/types";
import { addDays } from "@/detection/units";
import type { DebtAccount } from "./loans";
import {
  deadlineAlerts,
  fromDocumentDates,
  dueIn,
  enteredDeadlines,
  groupDeadlines,
  paymentDeadlines,
  renewalDeadlines,
  returnDeadlines,
  returnWindowDays,
  trialDeadlines,
  upcomingDeadlines,
  type Deadline,
} from "./deadlines";

const deadline = (overrides: Partial<Deadline> = {}): Deadline => ({
  key: `k-${crypto.randomUUID()}`,
  title: "Something",
  date: addDays(AS_OF, 10),
  kind: "other",
  source: "entered",
  amountCents: null,
  href: null,
  detail: null,
  ...overrides,
});

describe("renewals", () => {
  const run = (data: DetectionInput) => renewalDeadlines(data, buildStreams(data));

  it("lists a yearly or quarterly subscription's next charge, not monthly ones", () => {
    const data = input({
      recurringStreams: [
        plaidStream({
          id: "yearly",
          plaidStreamId: "p-yearly",
          merchantName: "Adobe",
          frequency: "ANNUALLY",
          lastAmountCents: 23_988,
          lastDate: addDays(AS_OF, -340),
          predictedNextDate: addDays(AS_OF, 25),
        }),
        plaidStream({ id: "monthly", plaidStreamId: "p-monthly", frequency: "MONTHLY" }),
      ],
    });
    expect(run(data)).toEqual([
      expect.objectContaining({
        title: "Adobe renews",
        date: addDays(AS_OF, 25),
        kind: "renewal",
        source: "transactions",
        amountCents: 23_988,
        href: "/subscriptions",
      }),
    ]);
  });

  it("leaves out a renewal past the horizon", () => {
    const data = input({
      recurringStreams: [
        plaidStream({
          frequency: "ANNUALLY",
          lastDate: addDays(AS_OF, -100),
          predictedNextDate: addDays(AS_OF, 265),
        }),
      ],
    });
    expect(run(data)).toEqual([]);
  });
});

describe("trials", () => {
  const trial = (overrides = {}) =>
    tx({
      accountId: CARD.id,
      date: addDays(AS_OF, -6),
      amountCents: 99,
      description: "PARAMOUNT+",
      merchantName: "Paramount+",
      pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
      ...overrides,
    });

  it("estimates when a $1 first charge from a subscription turns into the full price", () => {
    const start = trial();
    expect(trialDeadlines(input({ transactions: [start] }))).toEqual([
      expect.objectContaining({
        key: `trial:${start.id}`,
        title: "Paramount+ trial may end",
        date: addDays(start.date, TRIAL_LENGTH_DAYS),
        kind: "trial",
      }),
    ]);
  });

  it("ignores a trial that already converted, a bigger charge, or a non-subscription shop", () => {
    const converted = [trial(), trial({ date: addDays(AS_OF, -1), amountCents: 1_199 })];
    expect(trialDeadlines(input({ transactions: converted }))).toEqual([]);
    expect(trialDeadlines(input({ transactions: [trial({ amountCents: 899 })] }))).toEqual([]);
    const parking = trial({ description: "CITY PARKING", merchantName: null, pfcDetailed: null });
    expect(trialDeadlines(input({ transactions: [parking] }))).toEqual([]);
  });

  it("counts a merchant Claude confirmed as a subscription", () => {
    const start = trial({
      description: "ACME TOOLS",
      merchantName: "Acme Tools",
      pfcDetailed: null,
    });
    expect(trialDeadlines(input({ transactions: [start] }))).toEqual([]);
    expect(
      trialDeadlines(input({ transactions: [start], subscriptionMerchantKeys: ["acme tools"] })),
    ).toHaveLength(1);
  });

  it("drops a trial whose estimated end has passed", () => {
    const old = trial({ date: addDays(AS_OF, -TRIAL_LENGTH_DAYS - 1) });
    expect(trialDeadlines(input({ transactions: [old] }))).toEqual([]);
  });
});

describe("return windows", () => {
  const purchase = (overrides = {}) =>
    tx({
      accountId: CARD.id,
      date: addDays(AS_OF, -2),
      amountCents: 134_900,
      description: "APPLE STORE R102",
      merchantName: "Apple",
      pfcDetailed: "GENERAL_MERCHANDISE_ELECTRONICS",
      ...overrides,
    });
  const run = (data: DetectionInput) => returnDeadlines(data, buildStreams(data));

  it("gives a big purchase a return-by date from the merchant's usual window", () => {
    const apple = purchase();
    expect(run(input({ transactions: [apple] }))).toEqual([
      expect.objectContaining({
        key: `return:${apple.id}`,
        title: "Return window for Apple",
        date: addDays(apple.date, 14),
        kind: "return",
        amountCents: 134_900,
        href: "/transactions?q=Apple",
      }),
    ]);
  });

  it("uses the default window for shops not listed", () => {
    expect(returnWindowDays("corner shop")).toBe(RETURN_WINDOW_DAYS);
    expect(returnWindowDays("best buy 123")).toBe(15);
    expect(returnWindowDays(undefined)).toBe(RETURN_WINDOW_DAYS);
  });

  it("needs the threshold and a shop category", () => {
    const small = purchase({ amountCents: RETURN_MIN_CENTS - 1 });
    const atThreshold = purchase({ amountCents: RETURN_MIN_CENTS });
    const dinner = purchase({ pfcDetailed: "FOOD_AND_DRINK_RESTAURANT" });
    expect(run(input({ transactions: [small, dinner] }))).toEqual([]);
    expect(run(input({ transactions: [atThreshold] }))).toHaveLength(1);
  });

  it("leaves out a closed window and a purchase already refunded", () => {
    const old = purchase({ date: addDays(AS_OF, -15) });
    expect(run(input({ transactions: [old] }))).toEqual([]);
    const bought = purchase();
    const refund = purchase({ date: addDays(AS_OF, -1), amountCents: -134_900 });
    expect(run(input({ transactions: [bought, refund] }))).toEqual([]);
  });

  it("leaves out recurring charges", () => {
    const monthly = [0, 1, 2, 3].map((i) =>
      purchase({
        description: "FURNITURE RENTAL CO",
        merchantName: "Furniture Rental Co",
        pfcDetailed: "HOME_IMPROVEMENT_FURNITURE",
        amountCents: 15_000,
        date: addDays(AS_OF, -2 - 30 * i),
      }),
    );
    expect(run(input({ transactions: monthly }))).toEqual([]);
  });
});

describe("payments", () => {
  const card = (nextPaymentDueDate: Date | null): DebtAccount => ({
    id: "card1",
    name: "Rewards Card",
    mask: "4242",
    type: "credit",
    subtype: "credit card",
    currentBalanceCents: 120_000,
    liability: {
      aprBps: 2499,
      rateType: null,
      minimumPaymentCents: 3_500,
      nextPaymentDueDate,
      payoffDate: null,
      isOverdue: false,
      pastDueCents: null,
      ytdInterestPaidCents: null,
      description: null,
    },
  });

  it("lists each card and loan's next due date from the bank", () => {
    const due = addDays(AS_OF, 9);
    expect(paymentDeadlines([card(new Date(`${due}T00:00:00Z`))], AS_OF)).toEqual([
      expect.objectContaining({
        key: `payment:card1:${due}`,
        title: "Rewards Card ····4242 payment",
        date: due,
        kind: "payment",
        source: "loans",
        amountCents: 3_500,
        href: "/loans",
      }),
    ]);
  });

  it("skips a missing or passed due date", () => {
    expect(paymentDeadlines([card(null)], AS_OF)).toEqual([]);
    expect(paymentDeadlines([card(new Date(`${addDays(AS_OF, -1)}T00:00:00Z`))], AS_OF)).toEqual(
      [],
    );
  });
});

describe("hand-entered", () => {
  it("lists the ones not done, with their row id", () => {
    const rows = [
      {
        id: "d1",
        title: "FSA deadline",
        dueOn: new Date("2026-12-31T00:00:00Z"),
        kind: "fsa" as const,
        note: "Spend the rest on glasses",
        doneAt: null,
      },
      {
        id: "d2",
        title: "Travel credit",
        dueOn: new Date("2026-12-31T00:00:00Z"),
        kind: "card_benefit" as const,
        note: null,
        doneAt: new Date(),
      },
    ];
    expect(enteredDeadlines(rows)).toEqual([
      {
        key: "entered:d1:2026-12-31",
        title: "FSA deadline",
        date: "2026-12-31",
        kind: "fsa",
        source: "entered",
        amountCents: null,
        href: null,
        detail: "Spend the rest on glasses",
        entryId: "d1",
      },
    ]);
  });
});

describe("uploaded documents", () => {
  const dates = [
    { documentId: "doc1", title: "GEICO car insurance", date: "2026-11-01", what: "renewal" },
    { documentId: "doc2", title: "Dyson", date: "2026-12-01", what: "warranty_end" },
    { documentId: "doc3", title: "Best Buy", date: "2026-10-30", what: "return_window" },
  ] as const;

  it("turns each document date into a deadline that links to the documents", () => {
    expect(fromDocumentDates([...dates])).toEqual([
      expect.objectContaining({
        key: "document:doc1:renewal:2026-11-01",
        title: "GEICO car insurance renews",
        kind: "renewal",
        source: "documents",
        href: "/documents",
      }),
      expect.objectContaining({ title: "Dyson warranty ends", kind: "warranty" }),
      expect.objectContaining({ title: "Return window for Best Buy", kind: "return" }),
    ]);
  });

  it("reminds about a policy renewal, which has no other reminder", () => {
    const [renewal] = fromDocumentDates([{ ...dates[0], date: addDays(AS_OF, 2) }]);
    expect(deadlineAlerts([renewal], AS_OF).map((a) => a.key)).toEqual([renewal.key]);
  });
});

describe("the list", () => {
  it("keeps the next 90 days, soonest first, once each, and the person's passed ones", () => {
    const soon = deadline({
      key: "a",
      title: "B",
      date: addDays(AS_OF, 1),
      source: "transactions",
    });
    const sameDay = deadline({ key: "b", title: "A", date: addDays(AS_OF, 1) });
    const far = deadline({ key: "c", date: addDays(AS_OF, DEADLINE_HORIZON_DAYS + 1) });
    const passedMine = deadline({ key: "d", date: addDays(AS_OF, -3) });
    const passedSpotted = deadline({ key: "e", date: addDays(AS_OF, -3), source: "transactions" });
    expect(
      upcomingDeadlines([soon, far, passedSpotted, sameDay, passedMine, soon], AS_OF).map(
        (d) => d.key,
      ),
    ).toEqual(["d", "b", "a"]);
  });

  it("groups into passed, this week, this month and later", () => {
    const at = (days: number) => deadline({ key: String(days), date: addDays(AS_OF, days) });
    const groups = groupDeadlines([at(-1), at(0), at(6), at(7), at(29), at(30), at(89)], AS_OF);
    expect(groups.map((g) => [g.label, g.deadlines.map((d) => d.key)])).toEqual([
      ["Passed", ["-1"]],
      ["This week", ["0", "6"]],
      ["This month", ["7", "29"]],
      ["Later", ["30", "89"]],
    ]);
    expect(groupDeadlines([at(40)], AS_OF).map((g) => g.label)).toEqual(["Later"]);
  });

  it("says when in words", () => {
    expect(dueIn(AS_OF, AS_OF)).toBe("today");
    expect(dueIn(addDays(AS_OF, 1), AS_OF)).toBe("tomorrow");
    expect(dueIn(addDays(AS_OF, 5), AS_OF)).toBe("in 5 days");
    expect(dueIn(addDays(AS_OF, -1), AS_OF)).toBe("yesterday");
    expect(dueIn(addDays(AS_OF, -4), AS_OF)).toBe("4 days ago");
  });
});

describe("reminders", () => {
  it("reminds DEADLINE_REMINDER_DAYS before, keyed by the deadline", () => {
    const due = deadline({ key: "entered:d1:x", title: "FSA deadline", date: addDays(AS_OF, 3) });
    expect(DEADLINE_REMINDER_DAYS).toBe(3);
    expect(deadlineAlerts([due], AS_OF)).toEqual([
      expect.objectContaining({
        type: "deadline_soon",
        key: "entered:d1:x",
        title: expect.stringContaining("FSA deadline"),
      }),
    ]);
    expect(deadlineAlerts([due], addDays(AS_OF, -1))).toEqual([]);
    expect(deadlineAlerts([due], addDays(AS_OF, 4))).toEqual([]);
  });

  it("gives return windows RETURN_REMINDER_DAYS", () => {
    const window = deadline({ kind: "return", date: addDays(AS_OF, RETURN_REMINDER_DAYS) });
    const other = deadline({ date: addDays(AS_OF, RETURN_REMINDER_DAYS) });
    expect(deadlineAlerts([window, other], AS_OF).map((a) => a.key)).toEqual([window.key]);
  });

  it("leaves renewals and payments to their own alerts", () => {
    const renewal = deadline({ kind: "renewal", date: addDays(AS_OF, 1) });
    const payment = deadline({ kind: "payment", date: addDays(AS_OF, 1) });
    const trial = deadline({ kind: "trial", date: addDays(AS_OF, 1) });
    expect(deadlineAlerts([renewal, payment, trial], AS_OF).map((a) => a.key)).toEqual([trial.key]);
  });
});
