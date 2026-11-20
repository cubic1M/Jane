import { describe, expect, it } from "vitest";
import { normalizeLiabilities } from "@/data-sources/plaid/liabilities";
import { yearInterest } from "@/planning/lender-interest";
import { demoLiabilities } from "./demo-bank";

// Debug 2, 11-20: the demo bank's student loan reported a fixed $805.50 of interest so far, with no
// payment date, so synced each day its year paced by the read day shrank a little each day. Its
// loans now carry their last payment, and a year to date of that many payments: the year holds
// still between payments, and a new year starts at nothing.

const DEMO = { seed: "abc123", anchor: "2026-10-18" };
const student = (today: string) =>
  normalizeLiabilities(demoLiabilities(DEMO, today)).find((l) => l.kind === "student")!;
const year = (today: string) => {
  const l = student(today);
  return yearInterest(
    [
      {
        ytdInterestPaidCents: l.ytdInterestPaidCents,
        readOn: today,
        lastPaymentDate: l.lastPaymentDate,
        balanceCents: 1_834_500,
        aprBps: l.aprBps,
      },
    ],
    Number(today.slice(0, 4)),
    today,
  );
};

describe("the demo bank's loan interest so far", () => {
  it("is as of the last payment, ten payments by Nov 20", () => {
    expect(student("2026-11-20")).toMatchObject({
      lastPaymentDate: "2026-10-28",
      ytdInterestPaidCents: 80_550,
    });
  });

  it("paces to the same year on every day between payments", () => {
    const days = ["2026-11-01", "2026-11-15", "2026-11-27"].map((d) => year(d)?.cents);
    expect(days).toEqual([96_660, 96_660, 96_660]);
  });

  it("starts a new year at nothing before its first payment", () => {
    expect(student("2027-01-10")).toMatchObject({
      lastPaymentDate: "2026-12-28",
      ytdInterestPaidCents: 0,
    });
  });
});
