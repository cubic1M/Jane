import { describe, expect, it, vi } from "vitest";
import { MONTH_CLOSE_EMAIL_LINES } from "@/config/month-close";
import type { LedgerEntry } from "@/lib/ledger";
import { booksLines, closeSections, closeSubject } from "./month-close-email";
import { renderMonthlyReportEmail } from "./monthly-report";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn(), getCurrentUser: vi.fn() }));

const entry = (over: Partial<LedgerEntry>): LedgerEntry =>
  ({
    title: "Cancel Hulu",
    cents: 21_588,
    yearly: true,
    state: "said_yes",
    ...over,
  }) as LedgerEntry;
const report = {
  month: "2026-09",
  saved: { totalCents: 0, monthCents: 0 },
  earnedCents: 0,
  paidDownCents: 0,
  moved: { cents: 0, count: 0 },
  next: null,
  health: null,
  receipts: [],
};
const change = {
  key: "c",
  kind: "price_rise" as const,
  date: "2026-09-03",
  title: "Netflix",
  amountCents: 1_799,
  usualCents: 1_549,
  sure: "84%",
};

describe("the month close's parts", () => {
  it("says the books added up, or how many things didn't, and any charge to confirm", () => {
    expect(booksLines({ booksOpen: 0 }, 0)).toEqual(["Everything added up."]);
    expect(booksLines({ booksOpen: 2 }, 1)).toEqual([
      "2 things didn't add up, so the figures that rely on them are marked.",
      "1 charge to confirm before the month can close.",
    ]);
  });

  it("lists what changed, what's fixed and what's still open, with how sure", () => {
    const [books, changed, fixed, open] = closeSections(
      {
        changed: [change],
        verified: [entry({ state: "verified", title: "Hulu" })],
        open: [entry({ confidencePercent: 90 })],
      },
      ["Everything added up."],
    );
    expect(books.heading).toBe("Books");
    expect(changed).toEqual({
      heading: "What changed",
      lines: ["Price went up: Netflix ($17.99, usually $15.49; 84% sure)"],
    });
    expect(fixed.lines).toEqual(["Hulu: $215.88/yr, shown in your transactions"]);
    expect(open.lines).toEqual(["You said yes: Cancel Hulu (about $215.88/yr); 90% sure"]);
  });

  it("says so when a part is empty, and caps a long list", () => {
    const empty = closeSections({ changed: [], verified: [], open: [] }, ["Everything added up."]);
    expect(empty.map((s) => s.lines[0])).toEqual([
      "Everything added up.",
      "Nothing new.",
      "Nothing newly verified.",
      "Nothing left open.",
    ]);
    const many = Array.from({ length: MONTH_CLOSE_EMAIL_LINES + 3 }, () => entry({}));
    const [, , , open] = closeSections({ changed: [], verified: [], open: many }, []);
    expect(open.lines).toHaveLength(MONTH_CLOSE_EMAIL_LINES + 1);
    expect(open.lines.at(-1)).toBe("And 3 more.");
  });
});

it("goes out as one email, the close above the numbers, with the unsubscribe link", () => {
  const close = {
    month: "2026-09",
    reach: "Your statements end Sep 12, so this close only covers up to then.",
    sections: closeSections({ changed: [], verified: [], open: [] }, ["Everything added up."]),
  };
  const mail = renderMonthlyReportEmail(
    report as never,
    { base: "https://jane.test", unsubscribe: "https://jane.test/unsubscribe?token=t" },
    close,
  );
  expect(mail.subject).toBe(closeSubject("2026-09"));
  expect(mail.text).toContain(close.reach);
  expect(mail.text.indexOf("Books:")).toBeLessThan(mail.text.indexOf("The month's numbers:"));
  expect(mail.text).toContain("https://jane.test/close/2026-09");
  expect(mail.text).toContain("Unsubscribe: https://jane.test/unsubscribe?token=t");
  expect(mail.html).toContain("What's fixed");
});
