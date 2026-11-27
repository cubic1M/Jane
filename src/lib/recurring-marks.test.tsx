import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} data-repeat-mark={(rest as Record<string, string>)["data-repeat-mark"]}>
      {children}
    </a>
  ),
}));

import { RepeatMark } from "@/components/repeat-mark";
import { Rows } from "@/app/subscriptions/rows";
import type { RecurringCharge } from "@/detection/subscriptions";
import { chargeAnchor, markOf, recurringMarks } from "./recurring-marks";

const charge = (over: Partial<RecurringCharge>): RecurringCharge => ({
  key: "merchant:netflix",
  merchantKey: "netflix",
  merchant: "Netflix",
  accountId: "a1",
  transactionIds: ["n1", "n2", "n3"],
  firstChargeDate: "2026-08-14",
  lastChargeDate: "2026-10-14",
  frequency: "MONTHLY",
  lastAmountCents: 1549,
  lastDate: "2026-10-14",
  nextDate: "2026-11-14",
  annualCostCents: 18588,
  subscription: true,
  maybeSubscription: false,
  ...over,
});

const netflix = charge({});
const rent = charge({
  key: "merchant:essex",
  merchantKey: "essex",
  merchant: "Essex Property Trust",
  transactionIds: ["r1", "r2", "r3"],
  firstChargeDate: "2026-08-01",
  lastChargeDate: "2026-10-01",
  lastAmountCents: 240000,
  annualCostCents: 2880000,
  subscription: false,
  rent: true,
});

describe("recurring marks", () => {
  it("marks a subscription and a regular bill with their own word and rhythm", () => {
    expect(markOf(netflix).label).toBe("Subscription · monthly");
    expect(markOf(rent).label).toBe("Repeats monthly");
    expect(markOf(charge({ frequency: "ANNUALLY", subscription: false })).label).toBe(
      "Repeats yearly",
    );
  });

  it("marks the stream's own transactions and leaves one-offs alone", () => {
    const marks = recurringMarks([netflix, rent]);
    const row = (id: string, name: string) => ({
      id,
      accountId: "a1",
      merchantName: name,
      description: name,
    });
    expect(marks.forTransaction(row("n2", "Netflix"))?.kind).toBe("subscription");
    expect(marks.forTransaction(row("r1", "Essex Property Trust"))?.kind).toBe("bill");
    // A coffee, and a Netflix gift card bought once: same merchant, not in the stream.
    expect(marks.forTransaction(row("c1", "Blue Bottle Coffee"))).toBeNull();
    expect(marks.forTransaction({ ...row("n9", "Netflix"), date: "2026-09-20" })).toBeNull();
  });

  it("marks a payment of a current charge from before or after the days the stream was read", () => {
    const marks = recurringMarks([netflix]);
    const row = (id: string, date: string, accountId = "a1") => ({
      id,
      accountId,
      merchantName: "Netflix",
      description: "Netflix",
      date,
    });
    // A year older than the lookback, and tomorrow in the person's own day.
    expect(marks.forTransaction(row("old", "2025-10-14"))?.kind).toBe("subscription");
    expect(marks.forTransaction(row("next", "2026-11-14"))?.kind).toBe("subscription");
    // Inside the days of another plan's run on the same card: a one-off.
    const other = charge({
      key: "merchant:netflix@2000",
      transactionIds: ["m1"],
      firstChargeDate: "2026-09-14",
      lastChargeDate: "2026-11-14",
    });
    const two = recurringMarks([netflix, other]);
    expect(two.forTransaction(row("gone", "2026-09-20"))).toBeNull();
    // Another account's Netflix is not this charge.
    expect(marks.forTransaction(row("old2", "2025-10-14", "a2"))).toBeNull();
  });

  it("says a merchant with two charges has two, with their sum, and links to the first", () => {
    const second = charge({
      key: "merchant:aaa@12100",
      merchantKey: "aaa",
      merchant: "AAA",
      lastAmountCents: 12100,
      subscription: false,
    });
    const first = charge({
      key: "merchant:aaa",
      merchantKey: "aaa",
      merchant: "AAA",
      lastAmountCents: 16400,
      subscription: false,
      transactionIds: ["x1"],
    });
    const mark = recurringMarks([first, { ...second, transactionIds: ["x2"] }]).forMerchant("AAA")!;
    expect(mark.label).toBe("2 repeating charges");
    expect(mark.amountCents).toBe(28500);
    expect(mark.per).toBe("a month");
    expect(mark.href).toBe(markOf(first).href);
    const html = renderToStaticMarkup(<RepeatMark mark={mark} withAmount />);
    expect(html).toContain("2 repeating charges");
    expect(html).toContain("$285.00 a month");
    // Different rhythms: no sum.
    const mixed = recurringMarks([first, { ...second, frequency: "ANNUALLY" }]).forMerchant("AAA")!;
    expect(mixed.amountCents).toBeNull();
  });

  it("finds a stream with no transactions of ours by merchant and account, and only then", () => {
    const plaid = charge({ transactionIds: [], firstChargeDate: null, lastChargeDate: null });
    const marks = recurringMarks([plaid]);
    const row = { id: "x", merchantName: "Netflix", description: "NETFLIX.COM" };
    expect(marks.forTransaction({ ...row, accountId: "a1" })?.kind).toBe("subscription");
    expect(marks.forTransaction({ ...row, accountId: "a2" })).toBeNull();
  });

  it("marks a merchant row by its merchant", () => {
    const marks = recurringMarks([netflix, rent]);
    expect(marks.forMerchant("Netflix")?.label).toBe("Subscription · monthly");
    expect(marks.forMerchant("Blue Bottle Coffee")).toBeNull();
  });

  it("links to a row that exists on /subscriptions", () => {
    const mark = markOf(netflix);
    const html = renderToStaticMarkup(
      <Rows rows={[netflix, rent]} cards={new Map<string, string>()} />,
    );
    const fragment = decodeURIComponent(mark.href.split("#")[1]!);
    expect(fragment).toBe(chargeAnchor(netflix.key));
    expect(html).toContain(`id="${fragment}"`);
    expect(html).toContain(`id="${chargeAnchor(rent.key)}"`);
  });

  it("reads the mark aloud and hides its amount where figures are hidden", () => {
    const mark = markOf(netflix);
    const shown = renderToStaticMarkup(<RepeatMark mark={mark} withAmount />);
    expect(shown).toContain("Subscription · monthly");
    expect(shown).toContain("$15.49");
    expect(shown).toContain('aria-hidden="true"');
    const hidden = renderToStaticMarkup(<RepeatMark mark={mark} withAmount hidden />);
    expect(hidden).not.toContain("$15.49");
    expect(hidden).toContain("Hidden");
    // Without room for an amount (a charge's own row shows it), none is added.
    expect(renderToStaticMarkup(<RepeatMark mark={mark} />)).not.toContain("$");
  });
});
