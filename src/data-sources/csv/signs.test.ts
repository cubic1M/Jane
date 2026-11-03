import { describe, expect, it } from "vitest";
import { readCsvFile } from "./csv-source";

// Every bank's layout, one row each way, because a sign read backwards turns pay into spending and
// every figure with it. Positive is money out, whatever the bank writes. Stryker showed the money-in
// side of some layouts could flip with no test noticing (Navy Federal's did).

type Layout = { bank: string; out: string[]; into: string[]; header: string };

const LAYOUTS: Layout[] = [
  {
    bank: "Chase checking",
    header: "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
    out: ["DEBIT,10/02/2026,SHOP,-12.50,MISC,987.50,"],
    into: ["CREDIT,10/03/2026,PAY,100.00,MISC,1087.50,"],
  },
  {
    bank: "Chase card",
    header: "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
    out: ["10/01/2026,10/02/2026,SHOP,Shopping,Sale,-12.50,"],
    into: ["10/03/2026,10/03/2026,BACK,,Return,100.00,"],
  },
  {
    bank: "Bank of America checking",
    header: "Date,Description,Amount,Running Bal.",
    out: ['10/02/2026,SHOP,"-12.50","987.50"'],
    into: ['10/03/2026,PAY,"100.00","1,087.50"'],
  },
  {
    bank: "Bank of America card",
    header: "Posted Date,Reference Number,Payee,Address,Amount",
    out: ["10/02/2026,1,SHOP,CITY,-12.50"],
    into: ["10/03/2026,2,BACK,CITY,100.00"],
  },
  {
    bank: "Capital One card",
    header: "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
    out: ["2026-10-01,2026-10-02,1234,SHOP,Other,12.50,"],
    into: ["2026-10-03,2026-10-03,1234,BACK,Other,,100.00"],
  },
  {
    bank: "Capital One 360",
    header:
      "Account Number,Transaction Description,Transaction Date,Transaction Type,Transaction Amount,Balance",
    out: ["1234,SHOP,10/02/26,Debit,12.50,987.50"],
    into: ["1234,PAY,10/03/26,Credit,100.00,1087.50"],
  },
  {
    bank: "Citi card",
    header: "Status,Date,Description,Debit,Credit",
    out: ["Cleared,10/02/2026,SHOP,12.50,"],
    into: ["Cleared,10/03/2026,BACK,,-100.00"],
  },
  {
    bank: "American Express",
    header: "Date,Description,Card Member,Account #,Amount",
    out: ["10/02/2026,SHOP,SAM,-1000,12.50"],
    into: ["10/03/2026,BACK,SAM,-1000,-100.00"],
  },
  {
    bank: "Discover",
    header: "Trans. Date,Post Date,Description,Amount,Category",
    out: ["10/01/2026,10/02/2026,SHOP,12.50,Other"],
    into: ["10/03/2026,10/03/2026,BACK,-100.00,Other"],
  },
  {
    bank: "Apple Card",
    header: "Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)",
    out: ["10/01/2026,10/02/2026,SHOP,Shop,Other,Purchase,12.50"],
    into: ["10/03/2026,10/03/2026,BACK,Shop,Other,Return,-100.00"],
  },
  {
    bank: "U.S. Bank",
    header: "Date,Transaction,Name,Memo,Amount",
    out: ["2026-10-02,DEBIT,SHOP,x,-12.50"],
    into: ["2026-10-03,CREDIT,PAY,x,100.00"],
  },
  {
    bank: "Ally",
    header: "Date, Time, Amount, Type, Description",
    out: ["2026-10-02, 09:00, -12.50, Withdrawal, SHOP"],
    into: ["2026-10-03, 09:00, 100.00, Deposit, PAY"],
  },
  {
    bank: "Schwab",
    header: "Date,Status,Type,CheckNumber,Description,Withdrawal,Deposit,RunningBalance",
    out: ["10/02/2026,Posted,ATM,,SHOP,12.50,,987.50"],
    into: ["10/03/2026,Posted,ACH,,PAY,,100.00,1087.50"],
  },
  {
    bank: "Navy Federal",
    header: "Posting Date,Transaction Date,Amount,Credit Debit Indicator,type,Description",
    out: ["10/02/2026,10/01/2026,12.50,Debit,Card,SHOP"],
    into: ["10/03/2026,10/03/2026,100.00,Credit,ACH,PAY"],
  },
  {
    bank: "USAA",
    header: "Date,Description,Original Description,Category,Amount,Status",
    out: ["2026-10-02,SHOP,SHOP 1,Other,-12.50,Posted"],
    into: ["2026-10-03,PAY,PAY 1,Paycheck,100.00,Posted"],
  },
  {
    bank: "PayPal",
    header: "Date,Time,TimeZone,Name,Type,Status,Currency,Gross,Fee,Net",
    out: ["10/02/2026,09:00,PST,SHOP,Payment,Completed,USD,-12.50,0,-12.50"],
    into: ["10/03/2026,09:00,PST,PAY,Payment,Completed,USD,100.00,0,100.00"],
  },
  {
    bank: "Cash App",
    header: "Transaction ID,Date,Transaction Type,Net Amount,Status,Notes,Name of sender/receiver",
    out: ["a,2026-10-02 09:00:00 EDT,Cash Card,-$12.50,Complete,,SHOP"],
    into: ["b,2026-10-03 09:00:00 EDT,P2P,$100.00,Complete,,PAY"],
  },
];

const amountsOf = (layout: Layout, rows: string[]) => {
  const result = readCsvFile({
    name: "s.csv",
    text: [layout.header, ...rows].join("\n"),
  });
  if (!result.ok) throw new Error(`${layout.bank}: ${result.error}`);
  return result.transactions.map((t) => t.amountCents);
};

describe.each(LAYOUTS)("$bank", (layout) => {
  it("reads money out as positive and money in as negative", () => {
    expect(amountsOf(layout, [...layout.out, ...layout.into])).toEqual([1250, -10000]);
  });
});

describe("Wells Fargo, with no header", () => {
  it("reads money out as positive and money in as negative", () => {
    const result = readCsvFile({
      name: "wf.csv",
      text: ['"10/02/2026","-12.50","*","","SHOP"', '"10/03/2026","100.00","*","","PAY"'].join(
        "\n",
      ),
    });
    expect(result.ok && result.transactions.map((t) => t.amountCents)).toEqual([1250, -10000]);
  });
});

describe("Venmo", () => {
  it("reads money sent as positive and money received as negative", () => {
    const result = readCsvFile({
      name: "v.csv",
      text: [
        ",ID,Datetime,Type,Status,Note,From,To,Amount (total)",
        ",1,2026-10-02T09:00:00,Payment,Complete,lunch,Me,Sam,- $12.50",
        ",2,2026-10-03T09:00:00,Payment,Complete,rent,Sam,Me,+ $100.00",
      ].join("\n"),
    });
    expect(result.ok && result.transactions.map((t) => t.amountCents)).toEqual([1250, -10000]);
  });
});

describe("rows left out until they post", () => {
  it.each([
    ["Citi", LAYOUTS[6]!, "Pending,10/04/2026,HOLD,5.00,"],
    ["Schwab", LAYOUTS[12]!, "10/04/2026,Pending,ATM,,HOLD,5.00,,"],
    ["USAA", LAYOUTS[14]!, "2026-10-04,HOLD,HOLD 1,Other,-5.00,Pending"],
    ["PayPal", LAYOUTS[15]!, "10/04/2026,09:00,PST,HOLD,Payment,Pending,USD,-5.00,0,-5.00"],
    ["Cash App", LAYOUTS[16]!, "c,2026-10-04 09:00:00 EDT,P2P,-$5.00,Failed,,HOLD"],
  ])("%s", (_name, layout, pending) => {
    expect(amountsOf(layout, [...layout.out, pending])).toEqual([1250]);
  });
});
