import { describe, expect, it } from "vitest";
import { CHECKING, input, tx } from "@/detection/__fixtures__/build";
import { expectedIncome, forecastAccounts } from "@/detection/forecast";
import type { DetectionInput } from "@/detection/types";
import { addDays } from "@/detection/units";
import { safeToSpend } from "./safe-to-spend";

// Pay due today counts as bills due today do (phone debugger, 11-20, Plaid sandbox): Blue Bottle pays
// $1,650 every two weeks, last on Nov 6, so on Nov 20 before the deposit posts Home said "Safe to
// spend until Dec 4: $1,150" without that day's $1,650. Across one payday: the day before, the payday
// before and after its deposit, the day after with none, and the day the wait runs out.

const PAY = 165_000;
const blueBottle = (date: string) =>
  tx({
    date,
    amountCents: -PAY,
    description: "BLUE BOTTLE COFFEE PAYROLL",
    merchantName: "Blue Bottle",
    pfcPrimary: "INCOME",
    pfcDetailed: "INCOME_SALARY",
  });
// Every two weeks through Nov 6 (Fridays).
const paid = Array.from({ length: 8 }, (_, i) => blueBottle(addDays("2026-11-06", -14 * i)));
const verizon = ["2026-08-25", "2026-09-25", "2026-10-25"].map((date) =>
  tx({ date, amountCents: 8_000, description: "VERIZON WIRELESS", merchantName: "Verizon" }),
);

const BALANCE = 50_000;
const linked = (asOf: string, more: ReturnType<typeof tx>[] = []): DetectionInput =>
  input({
    asOf,
    accounts: [{ ...CHECKING, currentBalanceCents: BALANCE }],
    transactions: [...paid, ...verizon, ...more],
  });

const payDates = (data: DetectionInput) =>
  expectedIncome(data, addDays(data.asOf, 20)).map((p) => [p.merchant, p.date]);
const safe = (data: DetectionInput) => safeToSpend(data, { budgetsLeftCents: 0, goalsCents: 0 });

describe("a linked bank across a payday", () => {
  it("the day before: payday is tomorrow, and safe to spend runs until it", () => {
    const data = linked("2026-11-19");
    expect(payDates(data)).toEqual([
      ["Blue Bottle", "2026-11-20"],
      ["Blue Bottle", "2026-12-04"],
    ]);
    expect(safe(data)).toMatchObject({ payday: "2026-11-20", payDue: [], safeCents: BALANCE });
  });

  it("on payday before the deposit: the pay counts today, and safe to spend runs to the next", () => {
    const data = linked("2026-11-20");
    expect(payDates(data)).toEqual([
      ["Blue Bottle", "2026-11-20"],
      ["Blue Bottle", "2026-12-04"],
    ]);
    expect(safe(data)).toMatchObject({
      payday: "2026-12-04",
      payDue: [{ employer: "Blue Bottle", cents: PAY, dueOn: "2026-11-20" }],
      payMissed: [],
      billsCents: 8_000,
      safeCents: BALANCE + PAY - 8_000,
    });
    const [account] = forecastAccounts(data, 30);
    expect(account!.days[0]).toEqual({ date: "2026-11-20", balanceCents: BALANCE + PAY });
  });

  it("on payday after the deposit: it isn't counted twice", () => {
    const data = linked("2026-11-20", [blueBottle("2026-11-20")]);
    expect(payDates(data)).toEqual([["Blue Bottle", "2026-12-04"]]);
    expect(safe(data)).toMatchObject({
      payday: "2026-12-04",
      payDue: [],
      safeCents: BALANCE - 8_000,
    });
  });

  it("a deposit that posts the day before payday isn't expected again on payday", () => {
    const data = linked("2026-11-19", [blueBottle("2026-11-19")]);
    expect(payDates(data)).toEqual([["Blue Bottle", "2026-12-04"]]);
    expect(safe(data)).toMatchObject({ payday: "2026-12-04", payDue: [] });
  });

  it("the day after with no deposit: still expected, as late pay due yesterday", () => {
    const data = linked("2026-11-21");
    expect(payDates(data)).toEqual([
      ["Blue Bottle", "2026-11-21"],
      ["Blue Bottle", "2026-12-04"],
    ]);
    expect(safe(data)).toMatchObject({
      payday: "2026-12-04",
      payDue: [{ employer: "Blue Bottle", cents: PAY, dueOn: "2026-11-20" }],
      payMissed: [],
      safeCents: BALANCE + PAY - 8_000,
    });
  });

  it("the day the wait runs out: no longer counted, and said as missed", () => {
    const data = linked("2026-11-22");
    expect(payDates(data)).toEqual([["Blue Bottle", "2026-12-04"]]);
    expect(safe(data)).toMatchObject({
      payday: "2026-12-04",
      payDue: [],
      payMissed: [{ employer: "Blue Bottle", cents: PAY, dueOn: "2026-11-20" }],
      safeCents: BALANCE - 8_000,
    });
  });

  it("a late deposit ends the missed line", () => {
    const data = linked("2026-11-22", [blueBottle("2026-11-21")]);
    expect(safe(data)).toMatchObject({ payDue: [], payMissed: [] });
  });
});

// An upload: the statement's balance on its day, walked forward to today (#1099).
const uploaded = (asOf: string, statementEnds: string): DetectionInput =>
  input({
    asOf,
    accounts: [{ ...CHECKING, currentBalanceCents: BALANCE, balanceAsOf: statementEnds }],
    transactions: [...paid, ...verizon],
  });

describe("an upload across a payday", () => {
  it("on payday: today's pay counts once, after the walk to today", () => {
    const data = uploaded("2026-11-20", "2026-11-12");
    const [account] = forecastAccounts(data, 30);
    expect(account!.todayCents).toBe(BALANCE);
    expect(account!.days[0]).toEqual({ date: "2026-11-20", balanceCents: BALANCE + PAY });
    expect(safe(data)).toMatchObject({
      payday: "2026-12-04",
      payDue: [{ employer: "Blue Bottle", cents: PAY, dueOn: "2026-11-20" }],
      safeCents: BALANCE + PAY - 8_000,
    });
  });

  it("the day after: the walk counts the payday, so the forecast doesn't again", () => {
    const data = uploaded("2026-11-21", "2026-11-12");
    const [account] = forecastAccounts(data, 14);
    expect(account!.todayCents).toBe(BALANCE + PAY);
    expect(account!.income.map((p) => p.date)).toEqual(["2026-12-04"]);
    expect(safe(data)).toMatchObject({ payDue: [], payMissed: [] });
  });

  it("past the wait: a statement that ends before payday never calls the pay missed", () => {
    const data = uploaded("2026-11-23", "2026-11-12");
    expect(safe(data)).toMatchObject({ payDue: [], payMissed: [] });
  });

  it("a statement through payday with no deposit: late, then missed, as a linked bank", () => {
    expect(safe(uploaded("2026-11-21", "2026-11-21"))).toMatchObject({
      payDue: [{ employer: "Blue Bottle", cents: PAY, dueOn: "2026-11-20" }],
    });
    expect(safe(uploaded("2026-11-22", "2026-11-22"))).toMatchObject({
      payDue: [],
      payMissed: [{ employer: "Blue Bottle", cents: PAY, dueOn: "2026-11-20" }],
    });
  });
});
