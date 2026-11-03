import { describe, expect, it } from "vitest";
import { ONE_OFF_PAY } from "@/config/profile";
import { clientDeposits, employerExtras, regularPayers, type PayerRow } from "./regular-payers";

// Debugger 11-02: "NORTHWIND LABS" with no pay word in the line stayed uncategorized, and Claude
// is only asked what a typical purchase there is, so a person's pay wasn't income anywhere.
const biweekly = (name: string, cents: number, count = 8, from = "2026-07-03"): PayerRow[] =>
  Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.parse(`${from}T00:00:00Z`) + i * 14 * 86_400_000);
    return {
      id: `${name}-${i}`,
      date: day.toISOString().slice(0, 10),
      amountCents: -cents,
      merchantName: name,
    };
  });

describe("regular money in from one payer", () => {
  it("is income when it comes back at a steady cadence and a similar amount", () => {
    expect(regularPayers(biweekly("Northwind Labs", 261_025))).toHaveLength(8);
  });

  it("keeps monthly pay, four months of it", () => {
    const monthly = ["07", "08", "09", "10"].map((m, i) => ({
      id: `m${i}`,
      date: `2026-${m}-01`,
      amountCents: -410_000,
      merchantName: "City Of Oak Park",
    }));
    expect(regularPayers(monthly)).toHaveLength(4);
  });

  it("counts pay that varies a little", () => {
    const rows = biweekly("Northwind Labs", 200_000).map((r, i) => ({
      ...r,
      amountCents: r.amountCents - (i % 2) * 40_000,
    }));
    expect(regularPayers(rows)).toHaveLength(8);
  });

  it.each([
    ["too few", biweekly("Northwind Labs", 261_025, 3)],
    ["too small: a roommate's share of a bill", biweekly("Jo Park", 4_000)],
    ["an account of their own", biweekly("Ally Bank", 50_000)],
    ["a card company", biweekly("American Express", 50_000)],
    ["money moved from a broker", biweekly("Fidelity Investments", 50_000)],
    ["a payment app", biweekly("Venmo", 50_000)],
    // Debugger 11-02: "DEPOSIT FROM SANTANDER CHECKING" on a savings account, $3,000 of false pay.
    ["an account of their own, by its kind", biweekly("Santander Checking", 50_000)],
  ])("isn't income: %s", (_, rows) => {
    expect(regularPayers(rows)).toEqual([]);
  });

  describe("when the same money left another of their accounts", () => {
    const into = biweekly("Home Fund", 50_000).map((r) => ({ ...r, accountId: "savings" }));
    const out = (accountId: string, cents = 50_000, days = 0) =>
      into.map((r) => ({
        accountId,
        amountCents: cents,
        date: new Date(Date.parse(`${r.date}T00:00:00Z`) + days * 86_400_000)
          .toISOString()
          .slice(0, 10),
      }));

    it("isn't income: it's their own money moving", () => {
      expect(regularPayers(into, out("checking"))).toEqual([]);
      expect(regularPayers(into, out("checking", 50_000, 2))).toEqual([]);
    });

    it("is still income when pay leaves the account it came into, whole", () => {
      expect(regularPayers(into, out("savings"))).toHaveLength(8);
    });

    it("is still income when the amount or the days don't match", () => {
      expect(regularPayers(into, out("checking", 49_999))).toHaveLength(8);
      expect(regularPayers(into, out("checking", 50_000, 6))).toHaveLength(8);
    });

    it("is still income when only an odd one matches", () => {
      expect(regularPayers(into, out("checking").slice(0, 1))).toHaveLength(8);
    });
  });

  it("isn't income when the amounts are all over the place", () => {
    const amounts = [30_000, 900_000, 25_000, 700_000, 40_000, 1_200_000];
    const rows = biweekly("Acme Resale", 1, 6).map((r, i) => ({
      ...r,
      amountCents: -amounts[i],
    }));
    expect(regularPayers(rows)).toEqual([]);
  });

  it("isn't income when the days are all over the place", () => {
    const rows = ["2026-01-02", "2026-01-05", "2026-03-20", "2026-03-22", "2026-10-01"].map(
      (date, i) => ({ id: `r${i}`, date, amountCents: -50_000, merchantName: "Acme Resale" }),
    );
    expect(regularPayers(rows)).toEqual([]);
  });

  it("looks at each payer on its own, and skips rows with no name", () => {
    const rows = [
      ...biweekly("Northwind Labs", 261_025),
      ...biweekly("Jo Park", 4_000),
      { id: "x", date: "2026-07-01", amountCents: -90_000, merchantName: null },
    ];
    expect(regularPayers(rows).every((id) => id.startsWith("Northwind"))).toBe(true);
  });
});

// Debugger 11-02: an agency paid by clients at no regular time had $20,650 of invoices with no
// category, so none of it was income (#1216 stopped them being refunds, and they stopped there).
describe("clients who pay at uneven times", () => {
  const row = (name: string, date: string, cents: number, i = 0): PayerRow => ({
    id: `${name}-${date}-${i}`,
    date,
    amountCents: -cents,
    merchantName: name,
  });
  const clients = [
    row("Bright Path Clinic", "2026-07-03", 610_000),
    row("Bright Path Clinic", "2026-09-25", 740_000),
    row("Halcyon Coffee", "2026-05-29", 420_000),
    row("Halcyon Coffee", "2026-08-27", 295_000),
  ];

  it("are income, at any size or time", () => {
    expect(clientDeposits(clients).sort()).toEqual(clients.map((c) => c.id).sort());
  });

  it("leave out a payer who only paid once", () => {
    const once = row("Estate Of M Holloway", "2026-07-10", 8_500_000);
    const oneTime = row("Sunrise Lawn Care", "2026-06-10", 90_000);
    expect(clientDeposits([...clients, once, oneTime])).not.toContain(once.id);
    expect(clientDeposits([...clients, once, oneTime])).not.toContain(oneTime.id);
  });

  it("leave out small deposits: a refund or a share of a bill", () => {
    const small = [
      row("Bright Path Clinic", "2026-05-03", 4_000),
      row("Halcyon Coffee", "2026-06-03", 4_000),
      row("Bright Path Clinic", "2026-07-03", 4_000),
      row("Halcyon Coffee", "2026-08-03", 4_000),
    ];
    expect(clientDeposits(small)).toEqual([]);
  });

  it("need more than a couple of deposits: two from a relative isn't a business", () => {
    expect(
      clientDeposits([
        row("Aunt Marie", "2026-06-03", 200_000),
        row("Aunt Marie", "2026-09-03", 200_000),
      ]),
    ).toEqual([]);
  });

  it("need several months: a burst isn't a business", () => {
    expect(
      clientDeposits([
        row("Bright Path Clinic", "2026-07-03", 610_000),
        row("Bright Path Clinic", "2026-07-20", 610_000),
        row("Halcyon Coffee", "2026-07-05", 420_000),
        row("Halcyon Coffee", "2026-08-02", 420_000),
      ]),
    ).toEqual([]);
  });

  it.each([
    "Fedloan Direct Loan Disbursement",
    "Sofi Personal Loan",
    "State Farm Claim Refund",
    "IRS Treas Tax Ref",
    "Chicago Title Escrow",
    "Estate Of M Holloway",
    "Ally Bank",
    "Fidelity Investments",
    "Venmo",
    // Measured across 241 made-up people (debugger 11-02): a budgeting app's card payments, and
    // near misses that only escaped for being split between people.
    "Visa",
    "Mastercard",
    "Payment Received Thank You",
    "Riley Roommate Rent",
  ])("leave out %s", (name) => {
    const rows = [
      row(name, "2026-05-03", 300_000),
      row(name, "2026-08-03", 300_000),
      row("Bright Path Clinic", "2026-06-03", 300_000),
      row("Bright Path Clinic", "2026-09-03", 300_000),
    ];
    expect(clientDeposits(rows)).toEqual([]);
  });

  it("count one steady client who pays a lot, across months", () => {
    const rows = ["2026-05-03", "2026-06-20", "2026-08-03", "2026-09-29"].map((d) =>
      row("Square Inc", d, 310_000),
    );
    expect(clientDeposits(rows)).toHaveLength(4);
  });

  it("leave out money that left another of their accounts", () => {
    const rows = clients.map((c) => ({ ...c, accountId: "checking" }));
    const out = rows.map((r) => ({
      accountId: "savings",
      date: r.date,
      amountCents: -r.amountCents,
    }));
    expect(clientDeposits(rows, out)).toEqual([]);
  });
});

// Debugger 11-03: a $12,000 bonus from the person's own employer matched nothing, so the biggest
// deposit of their year wasn't income on any page.
describe("extra pay from the person's own employer", () => {
  const row = (id: string, merchantName: string | null, description: string) => ({
    id,
    merchantName,
    description,
  });
  const salaried = ["Northwind Robotics Payroll"];

  it("is pay when the name matches and the line says what it is", () => {
    expect(
      employerExtras(
        [
          row("a", "Northwind Robotics Bonus", "NORTHWIND ROBOTICS BONUS PPD ID: 9000123"),
          row("b", "Northwind Robotics Commission", "NORTHWIND ROBOTICS COMMISSION"),
        ],
        salaried,
      ),
    ).toEqual(["a", "b"]);
  });

  it("leaves a bank's bonus, another company's, and the employer's other deposits", () => {
    expect(
      employerExtras(
        [
          row("a", "Chase Checking Bonus", "CHASE CHECKING BONUS"),
          row("b", "Acme Bonus", "ACME BONUS"),
          row("c", "Northwind Robotics Refund", "NORTHWIND ROBOTICS REFUND"),
          row("d", null, "BONUS"),
        ],
        salaried,
      ),
    ).toEqual([]);
  });

  it("finds nothing with no employer to match", () => {
    expect(employerExtras([row("a", "Northwind Robotics Bonus", "X BONUS")], [])).toEqual([]);
  });
});

describe("pay that comes once", () => {
  it("includes a bonus, so one doesn't lift what comes in each month", () => {
    expect(ONE_OFF_PAY.test("NORTHWIND ROBOTICS BONUS PPD ID: 9000123")).toBe(true);
    expect(ONE_OFF_PAY.test("ACME CORP SEVERANCE")).toBe(true);
    expect(ONE_OFF_PAY.test("NORTHWIND ROBOTICS PAYROLL")).toBe(false);
  });
});
