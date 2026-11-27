import { describe, expect, it } from "vitest";
import { isHiddenPage } from "@/config/hidden-pages";
import { fromOldStatementsReply, type BillLine } from "./replies-old-bills";
import { savingsTransfersReply, sentByAppReply, type MoveLine } from "./replies-money-moves";
import { netWorthReply } from "./replies-networth";
import { moneyForTwoReply } from "./replies-two";
import { timelineReply } from "./replies-timeline";
import { whatIfReply } from "./replies-whatif";
import type { TimelineEntry } from "@/lib/timeline";
import type { ScenarioRun } from "@/planning/what-if";

// CodeRabbit part 2 (root-11): bills said "a month" only a month apart, savings transfers in and
// not out, averages over the months of history, and a known zero net worth.

const bill = (date: string, amountCents = 6_000): BillLine => ({
  date,
  amountCents,
  description: "XFINITY INTERNET",
  merchantName: "Xfinity",
  pfcDetailed: "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
});

describe("a bill from old statements", () => {
  it("says a month only for charges about a month apart", () => {
    const weekly = fromOldStatementsReply(
      "xfinity",
      [bill("2026-01-01"), bill("2026-01-08")],
      "2026-02-01",
    );
    expect(weekly!.body).not.toMatch(/a month/);
    const monthly = fromOldStatementsReply(
      "xfinity",
      [bill("2026-01-01"), bill("2026-02-01")],
      "2026-02-10",
    );
    expect(monthly!.body).toMatch(/\$60\.00 a month/);
  });
});

const move = (
  date: string,
  amountCents: number,
  description: string,
  pfc: string | null = null,
): MoveLine => ({
  date,
  amountCents,
  description,
  merchantName: null,
  pfcDetailed: pfc,
  accountId: "chk",
});

describe("money into savings", () => {
  const pay = move("2026-01-02", 250_000, "PAYROLL DEPOSIT", null);
  const lines = [
    move("2026-01-10", 10_000, "ONLINE TRANSFER TO ALLY BANK SAVINGS"),
    move("2026-02-10", 99_900, "ONLINE TRANSFER FROM SAVINGS TO CHECKING"),
    move("2026-03-10", 10_000, "ONLINE TRANSFER TO ALLY BANK SAVINGS"),
    move("2026-03-28", 7_700, "TRANSFER TO CHECKING FROM SAVINGS"),
    pay,
  ];

  it("leaves out transfers that came out of savings", () => {
    const body = savingsTransfersReply(lines).body;
    expect(body).toMatch(/\$200\.00 in 2 transfers/);
  });

  it("counts a transfer to a masked savings account", () => {
    const masked = [move("2026-01-10", 10_000, "TRANSFER TO ****1234 SAVINGS"), pay];
    expect(savingsTransfersReply(masked).body).toMatch(
      /^You move about \$100\.00 a month into savings/,
    );
  });

  it("averages over the months of history, the empty ones too", () => {
    // January to March: $200 over three months, not two.
    expect(savingsTransfersReply(lines).body).toMatch(/about \$66\.67 a month/);
  });

  it("averages what went out by an app over the same months", () => {
    const sent = [
      move("2026-01-05", 3_000, "VENMO PAYMENT"),
      move("2026-03-05", 3_000, "VENMO PAYMENT"),
      pay,
    ];
    expect(sentByAppReply("venmo", sent).body).toMatch(/about \$20\.00 a month/);
  });
});

describe("net worth with a balance known to be zero", () => {
  it("says $0.00 rather than that it cannot be worked out", () => {
    const body = netWorthReply({
      assetsCents: 0,
      debtsCents: 0,
      netCents: 0,
      cryptoCents: 0,
      missing: [],
      unbalanced: [],
      known: true,
    } as never).body;
    expect(body).toMatch(/Your net worth is \$0\.00/);
  });
});

describe("money for two, the timeline and what-if", () => {
  it("shows shares that add up to 100%", () => {
    const view = {
      rule: "income",
      myShareBps: 5050,
      partnerName: "Sam",
      chosen: true,
      owedToMeCents: 0,
      jointGoals: [],
      bigMoveCents: 50_000,
      bigMoves: [],
    } as never;
    expect(moneyForTwoReply(view).body).toContain("you pay 51%, Sam 49%");
  });

  it("leaves the person's own entries out of what Jane did", () => {
    const entry = (id: string, by: "jane" | "you"): TimelineEntry => ({
      id,
      at: new Date("2026-11-20T12:00:00Z"),
      sector: "bills",
      sectorLabel: "Bills",
      by,
      what: `Did ${id}`,
      why: "Because.",
      cents: null,
      undoHref: null,
    });
    const body = timelineReply(
      [entry("mine", "you"), entry("hers", "jane")],
      false,
      "2026-11-21",
    ).body;
    expect(body).toContain("Did hers");
    expect(body).not.toContain("Did mine");
    expect(timelineReply([entry("mine", "you")], false, "2026-11-21").body).toMatch(
      /haven't done anything/,
    );
  });

  // Walk 11-26: "See the details" opened Plans & goals, which has no what-if. While /what-if is
  // hidden the reply carries its plan in words and draws no link (the months it ran for ride on the
  // link when the page is shown: replies-whatif-link.test.ts).
  it("draws no details link while the what-if page is hidden", () => {
    const run = {
      scenario: "job_loss",
      label: "Losing your job",
      params: { months: 6, extraMonthlyCents: 0 },
      before: { lowestCents: 100_000 },
      sectors: {
        forecast: "Cash dips.",
        debt: "",
        taxes: "",
        investing: "",
        goals: [],
        insurance: [],
      },
      plan: [],
    } as unknown as ScenarioRun;
    expect(isHiddenPage("/what-if")).toBe(true);
    const links = whatIfReply(run).actions.map((a) => ("href" in a ? a.href : ""));
    expect(links.filter(Boolean)).toEqual([]);
  });
});
