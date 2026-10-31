import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { categorizeByRules } from "@/categorize/rules";
import { readCsvFile } from "./csv-source";

// Fixtures are made-up transactions in each bank's export layout (headers checked against
// open-source importers for that bank), not real data. Positive amounts are money out.
function read(name: string) {
  const text = readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
  const result = readCsvFile({ name, text });
  if (!result.ok) throw new Error(result.error);
  return result;
}

const amounts = (result: ReturnType<typeof read>) =>
  result.transactions.map((t) => [t.date, t.amountCents]);

describe("Bank of America checking", () => {
  const result = read("bofa-checking.csv");

  it("finds the header under the summary lines", () => {
    expect(result.format.id).toBe("bofa_checking");
  });

  it("leaves out the beginning balance quietly and reads money out as positive", () => {
    expect(result.skipped).toEqual([]);
    expect(amounts(result)).toEqual([
      ["2026-09-02", 1549],
      ["2026-09-05", -320000],
      ["2026-09-10", 1200],
      ["2026-09-15", 100415],
    ]);
    expect(result.transactions[0].merchantName).toBe("Netflix");
  });
});

describe("Bank of America credit card", () => {
  const result = read("bofa-credit-card.csv");

  it("is detected and reads purchases as money out, the payment as money in", () => {
    expect(result.format.id).toBe("bofa_credit_card");
    expect(amounts(result)).toEqual([
      ["2026-09-28", 1199],
      ["2026-09-25", 8621],
      ["2026-09-20", -100415],
      ["2026-09-18", 3117],
    ]);
    expect(result.transactions[0].description).toBe("SPOTIFY USA");
  });
});

describe("Wells Fargo (no header row)", () => {
  const result = read("wells-fargo.csv");

  it("is detected from the first row's shape and keeps every row", () => {
    expect(result.format.id).toBe("wells_fargo");
    expect(result.skipped).toEqual([]);
    expect(amounts(result)).toEqual([
      ["2026-09-29", 1549],
      ["2026-09-26", -250000],
      ["2026-09-20", 12000],
      ["2026-09-15", 1000],
      ["2026-09-12", 6480],
    ]);
    expect(result.transactions[3].description).toBe("MONTHLY SERVICE FEE");
  });
});

describe("Capital One credit card", () => {
  const result = read("capital-one-credit-card.csv");

  it("reads ISO dates, Debit as money out and Credit as money in", () => {
    expect(result.format.id).toBe("capital_one_credit_card");
    expect(amounts(result)).toEqual([
      ["2026-09-28", 1799],
      ["2026-09-25", 4820],
      ["2026-09-20", -65000],
      ["2026-09-19", -2345],
      ["2026-09-15", 2703],
    ]);
    expect(result.transactions[0].hints).toEqual({ bankCategory: "Entertainment" });
  });
});

describe("Capital One 360", () => {
  const result = read("capital-one-360.csv");

  it("reads two-digit years and signs the amount by its type", () => {
    expect(result.format.id).toBe("capital_one_360");
    expect(amounts(result)).toEqual([
      ["2026-09-28", 2499],
      ["2026-09-26", -250000],
      ["2026-09-30", -21],
      ["2026-09-20", 65000],
    ]);
    expect(result.transactions[0].hints).toEqual({ bankType: "Debit" });
  });
});

describe("Citi credit card", () => {
  const result = read("citi-credit-card.csv");

  it("reads Debit as money out and the minus-signed Credit as money in", () => {
    expect(result.format.id).toBe("citi_credit_card");
    expect(amounts(result)).toEqual([
      ["2026-09-27", 1399],
      ["2026-09-22", 5412],
      ["2026-09-20", -50000],
      ["2026-09-18", -1999],
      ["2026-09-15", 3000],
    ]);
  });
});

describe("Citi pending rows", () => {
  it("are left out until they clear, so they're never counted twice", () => {
    const result = readCsvFile({
      name: "citi.csv",
      text:
        "Status,Date,Description,Debit,Credit\n" +
        "Pending,09/28/2026,UBER EATS,18.40,\n" +
        "Cleared,09/27/2026,DISNEY PLUS,13.99,\n",
    });
    expect(result.ok && result.transactions.map((t) => t.description)).toEqual(["DISNEY PLUS"]);
    expect(result.ok && result.skipped).toEqual([]);
  });
});

describe("American Express (with additional details)", () => {
  const result = read("amex.csv");

  it("reads charges as money out, even with line breaks inside quoted fields", () => {
    expect(result.format.id).toBe("amex");
    expect(result.skipped).toEqual([]);
    expect(amounts(result)).toEqual([
      ["2026-09-27", 425],
      ["2026-09-22", 3218],
      ["2026-09-20", -75000],
      ["2026-09-15", 25000],
    ]);
    expect(result.transactions[1].hints).toEqual({ bankCategory: "Restaurant-Restaurant" });
  });

  it("works without the additional details too", () => {
    const basic = readCsvFile({
      name: "amex-basic.csv",
      text: "Date,Description,Card Member,Account #,Amount\n09/27/2026,AplPay NYTIMES,SAM EXAMPLE,-12345,4.25\n",
    });
    expect(basic.ok && basic.transactions.map((t) => t.amountCents)).toEqual([425]);
  });
});

describe("Discover card", () => {
  const result = read("discover-credit-card.csv");

  it("uses the post date and reads purchases as money out", () => {
    expect(result.format.id).toBe("discover_credit_card");
    expect(amounts(result)).toEqual([
      ["2026-09-28", 799],
      ["2026-09-24", 6140],
      ["2026-09-20", -40000],
      ["2026-09-19", -1250],
    ]);
    expect(result.transactions[0].hints).toEqual({ bankCategory: "Services" });
  });
});

describe("Apple Card", () => {
  const result = read("apple-card.csv");

  it("uses the clearing date; purchases are money out, the payment and a return money in", () => {
    expect(result.format.id).toBe("apple_card");
    expect(result.account).toMatchObject({ kind: "credit_card" });
    expect(amounts(result)).toEqual([
      ["2026-09-29", 2345],
      ["2026-09-25", -50000],
      ["2026-09-21", 1549],
      ["2026-09-13", -3000],
    ]);
    expect(result.transactions[0].hints).toEqual({
      bankCategory: "Restaurants",
      bankType: "Purchase",
    });
  });

  // Debugger 10-31: "SPOTIFY P2D3F STOCKHOLM" read as "Review your Spotify Stockholm
  // subscription", though Apple's own Merchant column says "Spotify".
  it("names the merchant from Apple's Merchant column", () => {
    const file = readCsvFile({
      name: "apple.csv",
      text: "Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By\n09/09/2026,09/10/2026,SPOTIFY P2D3F STOCKHOLM,Spotify,Other,Purchase,16.99,Leo Example\n",
    });
    expect(file.ok && file.transactions.map((t) => t.merchantName)).toEqual(["Spotify"]);
  });

  it("works without the Purchased By column", () => {
    const older = readCsvFile({
      name: "apple-older.csv",
      text: "Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)\n09/02/2026,09/03/2026,APPLE.COM/BILL,Apple Services,Other,Purchase,2.99\n",
    });
    expect(older.ok && older.transactions.map((t) => [t.date, t.amountCents])).toEqual([
      ["2026-09-03", 299],
    ]);
  });
});

describe("U.S. Bank", () => {
  const result = read("us-bank.csv");

  it("reads the name as the description and money out as positive", () => {
    expect(result.format.id).toBe("us_bank");
    expect(amounts(result)).toEqual([
      ["2026-09-29", 1549],
      ["2026-09-26", -250000],
      ["2026-09-20", 12000],
    ]);
    expect(result.transactions[0].description).toBe("NETFLIX.COM");
  });

  it("reads older exports: M/D/YYYY dates and four decimal places", () => {
    const older = readCsvFile({
      name: "us-bank-older.csv",
      text: '"Date","Transaction","Name","Memo","Amount"\n"9/2/2026","DEBIT","SHELL OIL 57444","Download from usbank.com.","-41.2350"\n"9/1/2026","CREDIT","ACME CORP PAYROLL","Download from usbank.com.","2500.0000"\n',
    });
    expect(older.ok && older.transactions.map((t) => [t.date, t.amountCents])).toEqual([
      ["2026-09-02", 4124],
      ["2026-09-01", -250000],
    ]);
  });
});

describe("Ally Bank", () => {
  const result = read("ally.csv");

  it("reads the spaced header, ISO dates and signed amounts", () => {
    expect(result.format.id).toBe("ally");
    expect(result.account).toMatchObject({ kind: "savings" });
    expect(result.skipped).toEqual([]);
    expect(amounts(result)).toEqual([
      ["2026-09-29", 1549],
      ["2026-09-26", -250000],
      ["2026-09-30", -411],
    ]);
    expect(result.transactions[2].description).toBe("Interest Paid");
  });
});

// Night QA 10-30: every amount positive, the way it went in its own column.
describe("Navy Federal Credit Union", () => {
  const result = read("navy-federal.csv");

  it("reads the posting date and signs each amount by its credit or debit indicator", () => {
    expect(result.format.id).toBe("navy_federal");
    expect(result.account).toMatchObject({ kind: "checking" });
    expect(result.skipped).toEqual([]);
    expect(amounts(result)).toEqual([
      ["2026-10-02", 7392],
      ["2026-10-01", 139500],
      ["2026-09-30", -241000],
    ]);
  });
});

describe("Schwab Bank checking", () => {
  const result = read("schwab-bank.csv");

  it("leaves pending rows out, reads the posted date and keeps the running balance", () => {
    expect(result.format.id).toBe("schwab_bank");
    expect(result.skipped).toEqual([]);
    expect(amounts(result)).toEqual([
      ["2026-09-29", 1549],
      ["2026-09-26", -250000],
      ["2026-09-20", 12000],
      ["2026-09-15", -300],
    ]);
    expect(result.balances).toContainEqual({ date: "2026-09-29", balanceCents: 432110 });
  });

  it("works on older exports without a Status column", () => {
    const older = readCsvFile({
      name: "schwab-older.csv",
      text: '"Date","Type","CheckNumber","Description","Withdrawal","Deposit","RunningBalance"\n"09/02/2026","ACH","","NETFLIX.COM","$15.49","","$100.00"\n',
    });
    expect(older.ok && older.transactions.map((t) => t.amountCents)).toEqual([1549]);
  });
});

describe("Venmo", () => {
  const result = read("venmo.csv");

  it("finds the header under the title, reads signed amounts and names who and what", () => {
    expect(result.format.id).toBe("venmo");
    expect(result.account).toEqual({ name: "Venmo", kind: "payment_app" });
    // The balance lines and the disclaimer go quietly; the pending charge waits.
    expect(result.skipped).toEqual([]);
    expect(result.transactions.map((t) => [t.date, t.amountCents, t.description])).toEqual([
      ["2026-09-03", 3250, "Alex Kim: Dinner 🍕"],
      ["2026-09-05", 120000, "Oak Ridge Apts: September rent"],
      ["2026-09-12", -4500, "Jordan Lee: Concert tickets"],
      ["2026-09-20", 5000, "Transfer to bank"],
    ]);
  });

  // Debugger 10-30: Venmo's Type is "Payment" for every person-to-person payment, and a bank's
  // "Payment" type means paying a card. Roommates paying back their rent shares, and a dinner
  // sent to a friend, became card payments: out of spending and income both.
  it("never makes a payment between people a card payment", () => {
    const categories = result.transactions.map(
      (t) =>
        categorizeByRules({
          description: t.description,
          amountCents: t.amountCents,
          hints: t.hints,
        })?.detailed ?? null,
    );
    expect(categories).not.toContain("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
    // Rent by Venmo is still rent.
    expect(categories[1]).toBe("RENT_AND_UTILITIES_RENT");
  });

  it("reads the newer layout (Transaction ID, Date)", () => {
    const newer = readCsvFile({
      name: "venmo-newer.csv",
      text: "Transaction ID,Date,Time (UTC),Type,Status,Note,From,Donor email,To,Amount (total)\n9001,2026-10-02,18:00:00,Payment,Complete,Groceries,Sam Example,,Alex Kim,- $18.25\n",
    });
    expect(newer.ok && newer.transactions.map((t) => [t.date, t.amountCents])).toEqual([
      ["2026-10-02", 1825],
    ]);
  });
});

describe("PayPal", () => {
  const result = read("paypal.csv");

  it("keeps payments from the PayPal balance and leaves out what a card paid for", () => {
    expect(result.format.id).toBe("paypal");
    expect(result.account).toEqual({ name: "PayPal", kind: "payment_app" });
    expect(result.transactions.map((t) => [t.date, t.amountCents, t.description])).toEqual([
      ["2026-09-02", 1199, "Spotify USA"],
      ["2026-09-15", -2500, "Jamie Rivera"],
      ["2026-09-28", 6301, "Transfer to bank"],
    ]);
    // The card deposit and the Etsy payment it paid for; the euro payment. Pending: quietly.
    expect(result.skipped.map((s) => s.reason)).toEqual([
      "In EUR, not US dollars",
      "Paid by card or bank: that statement has it",
      "Paid by card or bank: that statement has it",
    ]);
    expect(result.balances).toContainEqual({ date: "2026-09-28", balanceCents: 0 });
  });

  it("keeps a bank deposit into PayPal that paid for nothing that day", () => {
    const topUp = readCsvFile({
      name: "paypal-topup.csv",
      text: '"Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net"\n"09/01/2026","09:00:00","PDT","","Bank Deposit to PP Account","Completed","USD","100.00","0.00","100.00"\n',
    });
    expect(topUp.ok && topUp.transactions.map((t) => [t.amountCents, t.description])).toEqual([
      [-10000, "Transfer from bank"],
    ]);
  });
});
