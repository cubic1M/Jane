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
    expect(marks.forTransaction(row("n9", "Netflix"))).toBeNull();
  });

  it("finds a stream with no transactions of ours by merchant and account, and only then", () => {
    const plaid = charge({ transactionIds: [] });
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
