import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { categorizeByRules } from "@/categorize/rules";
import {
  guessSign,
  mappingChoices,
  mappingFromForm,
  parseAmount,
  type ColumnMapping,
} from "./column-mapping";
import { readCsvFile } from "./csv-source";
import { parseCsv } from "./parse-csv";

function fixture(name: string) {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

const form = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

const signed = (
  moneyOut: "negative" | "positive",
  over: Partial<ColumnMapping> = {},
): ColumnMapping => ({
  hasHeader: true,
  date: 0,
  description: 1,
  amount: { kind: "signed", column: 2, moneyOut },
  ...over,
});

const read = (name: string, mapping?: ColumnMapping) =>
  readCsvFile({ name, text: fixture(name), ...(mapping ? { mapping } : {}) });

const rows = (result: ReturnType<typeof readCsvFile>) =>
  result.ok ? result.transactions.map((t) => [t.date, t.amountCents]) : result.error;

describe("an unknown layout", () => {
  it("fails with the columns to pick from and first guesses", () => {
    const result = read("unknown-bank.csv");
    expect(result).toMatchObject({ ok: false, reason: "unknown_format" });
    if (result.ok) return;
    expect(result.choices).toMatchObject({
      columns: ["Date (10/01/2026)", "Payee (Somewhere)", "Debit (5.00)", "Credit"],
      hasHeader: true,
      guess: { date: 0, description: 1, amount: null, debit: 2, credit: 3 },
      // 10/14 settles it: month first.
      dateOrders: { 0: "mdy" },
    });
  });

  it("reads with the columns the person picked: money out and money in", () => {
    const mapping: ColumnMapping = {
      hasHeader: true,
      date: 0,
      description: 1,
      amount: { kind: "split", debit: 2, credit: 3 },
    };
    const result = read("unknown-bank.csv", mapping);
    expect(result.ok && result.format).toEqual({ id: "custom", label: "Columns you picked" });
    expect(rows(result)).toEqual([
      ["2026-10-01", 500],
      ["2026-10-14", -10000],
    ]);
  });

  it("reads one signed amount column, with ISO dates, either sign for money out", () => {
    expect(rows(read("custom-signed.csv", signed("negative")))).toEqual([
      ["2026-09-27", 450],
      ["2026-09-26", -150000],
      ["2026-09-25", 3000],
    ]);
    const positive = read("custom-signed.csv", signed("positive"));
    expect(positive.ok && positive.transactions[0].amountCents).toBe(-450);
  });

  it("says in plain words what's wrong when the picked columns read no rows", () => {
    const result = read("custom-signed.csv", signed("negative", { date: 1, description: 0 }));
    expect(result).toMatchObject({
      ok: false,
      reason: "unknown_format",
      error:
        'None of the rows could be read with those columns. On line 2, "COFFEE PLACE" in the date column isn\'t a date Jane can read.',
    });
    expect(!result.ok && result.choices).toBeTruthy();
  });

  it("treats a first row with a date in it as data, not column names", () => {
    const choices = mappingChoices(parseCsv("2026-09-01,Coffee shop downtown,-4.50\n"));
    expect(choices).toMatchObject({
      columns: ["Column 1 (2026-09-01)", "Column 2 (Coffee shop downtown)", "Column 3 (-4.50)"],
      hasHeader: false,
      guess: { date: 0, description: 1, amount: 2, debit: null, credit: null },
    });
  });
});

describe("day or month first", () => {
  it("reads a day-first file from its 13th and 14th, never 05/09 as May 9", () => {
    const result = read("day-first.csv");
    expect(!result.ok && result.choices?.dateOrders).toEqual({ 0: "dmy" });
    expect(!result.ok && result.choices?.signs[2]?.moneyOut).toBe("negative");
    expect(rows(read("day-first.csv", signed("negative")))).toEqual([
      ["2026-09-14", 2340],
      ["2026-09-13", -210000],
      ["2026-09-05", 1099],
    ]);
  });

  it("asks when the dates can't tell, and reads them once told", () => {
    const result = read("ambiguous-dates.csv");
    expect(!result.ok && result.choices?.dateOrders).toEqual({ 0: "unknown" });
    expect(read("ambiguous-dates.csv", signed("negative"))).toMatchObject({
      ok: false,
      error:
        "Jane can't tell from this file whether 05/09/2026 is month first or day first. Say how the dates are written.",
    });
    expect(rows(read("ambiguous-dates.csv", signed("negative", { dateOrder: "dmy" })))).toEqual([
      ["2026-09-05", 450],
      ["2026-09-06", 1200],
    ]);
    expect(rows(read("ambiguous-dates.csv", signed("negative", { dateOrder: "mdy" })))).toEqual([
      ["2026-05-09", 450],
      ["2026-06-09", 1200],
    ]);
  });
});

describe("which sign is spending", () => {
  it("guesses positive for a file where spending is positive, and says why", () => {
    const result = read("spending-positive.csv");
    expect(!result.ok && result.choices?.signs[2]).toEqual({
      moneyOut: "positive",
      why: 'From rows like "WHOLE FOODS MARKET"',
    });
  });

  it("goes by most rows when no merchant says, and asks when it's even", () => {
    const table = (amounts: string[]) => amounts.map((a) => ["2026-09-01", "THING", a]);
    expect(guessSign(table(["-1.00", "-2.00", "3.00"]), 2, 1)).toEqual({
      moneyOut: "negative",
      why: "Most rows are negative",
    });
    expect(guessSign(table(["1.00", "2.00", "-3.00"]), 2, 1)).toEqual({
      moneyOut: "positive",
      why: "Most rows are positive",
    });
    expect(guessSign(table(["1.00", "-2.00"]), 2, 1)).toEqual({
      moneyOut: null,
      why: "The rows don't say which",
    });
  });

  it("lets pay going in outweigh most rows", () => {
    const table = [
      ["2026-09-01", "ACME CORP PAYROLL", "-2500.00"],
      ["2026-09-02", "THING", "-1.00"],
      ["2026-09-03", "OTHER THING", "-2.00"],
    ];
    expect(guessSign(table, 2, 1).moneyOut).toBe("positive");
  });
});

describe("semicolons, decimal commas and written-out dates", () => {
  it("reads a semicolon file with dates like Sep 5, 2026", () => {
    const result = read("semicolons.csv");
    expect(result).toMatchObject({ ok: false, reason: "unknown_format" });
    if (result.ok) return;
    expect(result.choices).toMatchObject({
      columns: ["Datum (Sep 5, 2026)", "Beschreibung (REWE MARKT)", "Betrag (-23,40)"],
      guess: { date: 0, description: 1, amount: 2 },
      signs: { 2: { moneyOut: "negative" } },
    });
    expect(rows(read("semicolons.csv", signed("negative")))).toEqual([
      ["2026-09-05", 2340],
      ["2026-09-03", -210000],
      ["2026-09-01", 95000],
    ]);
  });

  it("parses amounts with currency signs and decimal commas", () => {
    expect(parseAmount("€12,50")).toBe(1250);
    expect(parseAmount("1.234,56")).toBe(123456);
    expect(parseAmount("-23,40")).toBe(-2340);
    expect(parseAmount("12.50 USD")).toBe(1250);
    expect(parseAmount("1,234.56")).toBe(123456);
    expect(parseAmount("twelve")).toBeNull();
  });
});

describe("a running balance column", () => {
  it('is guessed when it says "Running Total", beside money out in parentheses', () => {
    const text =
      "Posted On,Memo,Amount,Running Total\n" +
      '2026-10-12,"GEICO AUTO PAYMENT",(142.50),"1,057.50"\n' +
      '2026-10-05,"SHARE TRANSFER FROM CHECKING",200.00,"1,200.00"\n';
    const first = readCsvFile({ name: "export (3).csv", text });
    expect(!first.ok && first.choices?.guess).toMatchObject({
      date: 0,
      description: 1,
      amount: 2,
      balance: 3,
    });
  });

  const text =
    "Date,Description,Withdrawal,Deposit,Balance\n" +
    "10/14/2026,COFFEE,4.50,,995.50\n" +
    "10/13/2026,PAYCHECK,,500.00,1000.00\n";

  it("is guessed from its name, and its balances kept with the rows", () => {
    const first = readCsvFile({ name: "golden1-export.csv", text });
    expect(!first.ok && first.choices?.guess).toMatchObject({ debit: 2, credit: 3, balance: 4 });
    const read = readCsvFile({
      name: "golden1-export.csv",
      text,
      mapping: {
        hasHeader: true,
        date: 0,
        description: 1,
        amount: { kind: "split", debit: 2, credit: 3 },
        balance: 4,
      },
    });
    expect(read.ok && read.balances).toEqual([
      { date: "2026-10-13", balanceCents: 100000 },
      { date: "2026-10-14", balanceCents: 99550 },
    ]);
    // A layout Jane doesn't know: the new account is named from the file.
    expect(read.ok && read.account).toEqual({ name: "Golden1", kind: "checking" });
  });
});

describe("mappingFromForm", () => {
  it("is null when the picker wasn't shown for that file", () => {
    expect(mappingFromForm(form({}), 0)).toBeNull();
  });

  it("reads a signed amount, the date order and the header switch", () => {
    expect(
      mappingFromForm(
        form({
          "map.1.date": "0",
          "map.1.dates": "dmy",
          "map.1.description": "1",
          "map.1.amount": "2",
          "map.1.out": "positive",
          "map.1.header": "1",
        }),
        1,
      ),
    ).toEqual({
      hasHeader: true,
      date: 0,
      dateOrder: "dmy",
      description: 1,
      amount: { kind: "signed", column: 2, moneyOut: "positive" },
    });
  });

  it("reads an optional running balance column", () => {
    expect(
      mappingFromForm(
        form({
          "map.0.date": "0",
          "map.0.description": "1",
          "map.0.debit": "2",
          "map.0.credit": "3",
          "map.0.balance": "4",
        }),
        0,
      ),
    ).toMatchObject({ balance: 4 });
  });

  it("reads money out and money in columns when there's no amount column", () => {
    expect(
      mappingFromForm(
        form({
          "map.0.date": "0",
          "map.0.description": "1",
          "map.0.amount": "",
          "map.0.debit": "2",
          "map.0.credit": "3",
        }),
        0,
      ),
    ).toEqual({
      hasHeader: false,
      date: 0,
      description: 1,
      amount: { kind: "split", debit: 2, credit: 3 },
    });
  });

  it("says what's missing, including which sign is spending", () => {
    expect(mappingFromForm(form({ "map.0.date": "" }), 0)).toBe("Pick the date column.");
    expect(mappingFromForm(form({ "map.0.date": "0" }), 0)).toBe("Pick the description column.");
    expect(
      mappingFromForm(form({ "map.0.date": "0", "map.0.description": "1", "map.0.debit": "2" }), 0),
    ).toBe("Pick the amount column, or both the money out and money in columns.");
    expect(
      mappingFromForm(
        form({ "map.0.date": "0", "map.0.description": "1", "map.0.amount": "2", "map.0.out": "" }),
        0,
      ),
    ).toBe("Say whether money you spent shows as a negative or a positive number.");
    expect(mappingFromForm(form({ "map.0.date": "-1", "map.0.description": "1" }), 0)).toBe(
      "Pick the date column.",
    );
  });
});

// Founder decision 10-30: banks that put the sign in a column of its own (Navy Federal; DR/CR at
// other credit unions; Debit/Credit, +/-). Made-up files, one per layout.
describe("the sign in a column of its own", () => {
  const marked = (marker: number, out: string): ColumnMapping => ({
    hasHeader: true,
    date: 0,
    description: 1,
    amount: { kind: "marked", column: 2, marker, out },
  });
  const expected = [
    ["2026-10-02", 4210],
    ["2026-10-01", -180000],
    ["2026-09-30", 6125],
  ];

  it.each([
    ["sign-debit-credit.csv", "Debit"],
    ["sign-dr-cr.csv", "DR"],
    ["sign-plus-minus.csv", "-"],
  ])("finds the marker column in %s, guesses it, and reads the rows by it", (file, out) => {
    const result = read(file);
    expect(result).toMatchObject({ ok: false, reason: "unknown_format" });
    if (result.ok) return;
    expect(result.choices?.guess).toMatchObject({
      amount: 2,
      marker: 3,
      debit: null,
      credit: null,
    });
    expect(result.choices?.markers[3]).toEqual({ values: expect.any(Array), out });
    expect(rows(read(file, marked(3, out)))).toEqual(expected);
  });

  it("matches the marker whatever its case", () => {
    expect(rows(read("sign-debit-credit.csv", marked(3, "DEBIT")))).toEqual(expected);
  });

  it("offers a named column with its own codes, for the person to say which is money out", () => {
    const result = read("sign-own-codes.csv");
    if (result.ok) throw new Error("read without a mapping");
    expect(result.choices?.markers[3]).toEqual({ values: ["W", "P"], out: null });
    // Not recognized, so no guess: the amounts' own sign stays the default.
    expect(result.choices?.guess.marker).toBeNull();
    expect(rows(read("sign-own-codes.csv", marked(3, "W")))).toEqual(expected);
  });

  it("never takes a column of amounts or a signed amount for a marker", () => {
    const choices = mappingChoices(parseCsv(fixture("custom-signed.csv")));
    expect(choices.markers).toEqual({});
    expect(choices.guess.marker).toBeNull();
  });

  it("says when a row's marker is empty", () => {
    const text = "Date,Memo,Amount,Debit/Credit\n2026-10-02,CORNER MARKET,42.10,\n";
    const result = readCsvFile({ name: "x.csv", text, mapping: marked(3, "Debit") });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/The column saying which way it went is empty/);
  });

  it("is read from the form, and asks for what's missing", () => {
    const base = { "map.0.date": "0", "map.0.description": "1", "map.0.amount": "2" };
    expect(
      mappingFromForm(
        form({
          ...base,
          "map.0.header": "1",
          "map.0.out": "marked",
          "map.0.marker": "3",
          "map.0.markout": " DR ",
        }),
        0,
      ),
    ).toEqual({
      hasHeader: true,
      date: 0,
      description: 1,
      amount: { kind: "marked", column: 2, marker: 3, out: "DR" },
    });
    expect(mappingFromForm(form({ ...base, "map.0.out": "marked" }), 0)).toBe(
      "Pick the column that says which way each amount went.",
    );
    expect(mappingFromForm(form({ ...base, "map.0.out": "marked", "map.0.marker": "3" }), 0)).toBe(
      "Say which value in that column means money out.",
    );
  });

  it("keeps Navy Federal's own layout, read without the picker", () => {
    const result = read("navy-federal.csv");
    expect(result.ok && result.format.id).toBe("navy_federal");
  });
});

// Debugger 11-01: a Barclays card file starts with the bank's name, the account number and the
// balance, a blank line, then the column names. The picker offered "Barclays Bank Delaware" as
// the only column, so the file couldn't be imported. Lines above the table, narrower than its
// rows, aren't the column names.
describe("bank details above the column names", () => {
  it("offers the table's columns, not the bank's name", () => {
    const result = read("preamble-barclays.csv");
    expect(result).toMatchObject({ ok: false, reason: "unknown_format" });
    if (result.ok) return;
    expect(result.choices).toMatchObject({
      columns: [
        "Transaction Date (10/28/2026)",
        "Description (UBER   *TRIP)",
        "Category (DEBIT)",
        "Amount (-28.91)",
      ],
      hasHeader: true,
      guess: { date: 0, description: 1, amount: 3 },
    });
  });

  it("reads the rows with the columns picked", () => {
    const result = read(
      "preamble-barclays.csv",
      signed("negative", { amount: { kind: "signed", column: 3, moneyOut: "negative" } }),
    );
    expect(rows(result)).toEqual([
      ["2026-10-28", 2891],
      ["2026-10-26", -40_000],
      ["2026-10-21", 2700],
      ["2026-09-01", 9900],
    ]);
    // The bank's details aren't rows that failed to read.
    expect(result.ok && result.skipped).toEqual([]);
  });
});

// Debugger 11-02: a Fidelity cash account's file has "Brokerage" above the column names and two
// lines of small print after the rows; the small print read as "2 rows will be skipped".
describe("a title above the table and small print below it", () => {
  it("offers the table's columns and reads only its rows", () => {
    const result = read("preamble-fidelity-cash.csv");
    if (result.ok) throw new Error("expected the picker");
    expect(result.choices?.columns.slice(0, 2)).toEqual([
      "Run Date (10/28/2026)",
      "Action (DEBIT CARD PURCHASE NETF)",
    ]);
    const mapped = read(
      "preamble-fidelity-cash.csv",
      signed("negative", {
        description: 1,
        amount: { kind: "signed", column: 10, moneyOut: "negative" },
      }),
    );
    expect(rows(mapped)).toEqual([
      ["2026-10-28", 1549],
      ["2026-10-25", -250_000],
    ]);
    expect(mapped.ok && mapped.skipped).toEqual([]);
  });
});

// Debugger 11-02: in a Fidelity cash account's file the "Description" column says "No Description"
// on every row; the words are under "Action". The picker guessed Description, so the sign guess
// had nothing to read and $1,369 of deposits read as spending.
describe("a description column that says the same on every row", () => {
  it("guesses the column with the words instead, and reads the sign from them", () => {
    const result = read("preamble-fidelity-cash.csv");
    if (result.ok) throw new Error("expected the picker");
    expect(result.choices?.guess.description).toBe(1);
    expect(result.choices?.signs[10]?.moneyOut).toBe("negative");
  });
});

// Debugger 11-02: a Huntington file has Payee Name and Memo. Reading only the payee lost
// "OVERDRAFT FEE" and "PAYROLL": no fee card, and the person's pay wasn't income.
describe("a payee column beside a memo", () => {
  const text = [
    "Date,Reference Number,Payee Name,Memo,Amount,Category Name",
    "10/17/2026,9107,BRIGHTLINE INC,PAYROLL,2840.50,",
    "10/10/2026,9110,HUNTINGTON,SERVICE CHARGE,-12.00,",
    "10/08/2026,9108,SPOTIFY,POS,-11.99,",
    "10/05/2026,9105,NETFLIX.COM,NETFLIX.COM,-15.49,",
    "10/03/2026,9103,DISCOVER,E-PAYMENT,-300.00,",
    "10/02/2026,9102,CORNER CAFE,,-6.50,",
  ].join("\n");
  const picked = (description: number, extra: Partial<ColumnMapping> = {}): ColumnMapping => ({
    hasHeader: true,
    date: 0,
    description,
    amount: { kind: "signed", column: 4, moneyOut: "negative" },
    ...extra,
  });
  const descriptions = (mapping: ColumnMapping) => {
    const result = readCsvFile({ name: "huntington.csv", text, mapping });
    if (!result.ok) throw new Error(result.error);
    return result.transactions.map((t) => t.description);
  };

  it("reads both, once when they say the same, and just the payee when the memo is empty", () => {
    expect(descriptions(picked(2))).toEqual([
      "BRIGHTLINE INC PAYROLL",
      "HUNTINGTON SERVICE CHARGE",
      "SPOTIFY",
      "NETFLIX.COM",
      "DISCOVER E-PAYMENT",
      "CORNER CAFE",
    ]);
  });

  // Seen in the app: "Review your Skyline Chili Pos subscription".
  it.each(["POS", "pos", "Debit", "DEBIT CARD", "Purchase", "CHECK CARD", "WEB PMT", "ACH"])(
    "adds nothing from a memo that only says how it was paid: %s",
    (memo) => {
      const result = readCsvFile({
        name: "memo.csv",
        text: `Date,Payee Name,Memo,Amount\n10/17/2026,SKYLINE CHILI,${memo},-11.99\n`,
        mapping: {
          hasHeader: true,
          date: 0,
          description: 1,
          amount: { kind: "signed", column: 3, moneyOut: "negative" },
        },
      });
      if (!result.ok) throw new Error(result.error);
      expect(result.transactions[0].description).toBe("SKYLINE CHILI");
    },
  );

  it("finds the pay, the fee and the card payment that the memo says", () => {
    const result = readCsvFile({ name: "huntington.csv", text, mapping: picked(2) });
    if (!result.ok) throw new Error(result.error);
    const category = (i: number) =>
      categorizeByRules({
        description: result.transactions[i].description,
        amountCents: result.transactions[i].amountCents,
        hints: {},
      })?.detailed;
    expect(category(0)).toBe("INCOME_SALARY");
    expect(category(1)).toBe("BANK_FEES_OTHER_BANK_FEES");
    expect(category(4)).toBe("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
  });

  it("leaves a person's own pick alone when they chose the memo as the description", () => {
    expect(descriptions(picked(3)).slice(0, 2)).toEqual(["PAYROLL", "SERVICE CHARGE"]);
  });

  it("doesn't add a column the person picked for something else", () => {
    const noHeader = readCsvFile({
      name: "plain.csv",
      text: "10/17/2026,BRIGHTLINE INC,PAYROLL,2840.50\n",
      mapping: {
        hasHeader: false,
        date: 0,
        description: 1,
        amount: { kind: "signed", column: 3, moneyOut: "negative" },
      },
    });
    if (!noHeader.ok) throw new Error(noHeader.error);
    expect(noHeader.transactions[0].description).toBe("BRIGHTLINE INC");
  });
});

// Debugger 11-02: the first guess silently lost money. A person sees it to check, but nothing
// says it's wrong: YNAB's Inflow was left out ($24,103 of pay read $0.00), a credit union's
// Amount Credit too (8 paychecks skipped), and Rocket Money's rows were named "Checking".
describe("the first guess, on layouts from budgeting apps and credit unions", () => {
  const guessOf = (text: string) => mappingChoices(parseCsv(text)).guess;

  it("takes Outflow and Inflow as money out and in (YNAB)", () => {
    const guess = guessOf(
      [
        '"Account","Flag","Date","Payee","Category","Memo","Outflow","Inflow","Cleared"',
        '"Checking","","10/28/2026","Maple Court","Rent","rent","$1,425.00","$0.00","Cleared"',
        '"Checking","","10/17/2026","Northwind Labs","Pay","","$0.00","$2,610.25","Cleared"',
      ].join("\n"),
    );
    expect(guess).toMatchObject({ date: 2, description: 3, amount: null, debit: 6, credit: 7 });
    const result = readCsvFile({
      name: "ynab.csv",
      text: [
        "Account,Date,Payee,Memo,Outflow,Inflow",
        'Checking,10/28/2026,Maple Court,rent,"$1,425.00",$0.00',
        "Checking,10/17/2026,Northwind Labs,,$0.00,$2610.25",
      ].join("\n"),
      mapping: {
        hasHeader: true,
        date: 1,
        description: 2,
        amount: { kind: "split", debit: 4, credit: 5 },
      },
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.transactions.map((t) => [t.description, t.amountCents])).toEqual([
      ["Maple Court rent", 142_500],
      ["Northwind Labs", -261_025],
    ]);
  });

  const creditUnion = [
    "Transaction Number,Date,Description,Memo,Amount Debit,Amount Credit,Balance,Check Number,Fees",
    "2026001,10/28/2026,Withdrawal ACH,MAPLE COURT APTS RENT,-1425.00,,3000.00,,0.00",
    "2026002,10/17/2026,Deposit ACH,NORTHWIND LABS PAYROLL,,2610.25,4425.00,,0.00",
    "2026003,10/11/2026,Withdrawal ACH,XCEL ENERGY PAYMENT,-92.40,,1814.75,,0.00",
    "2026004,10/09/2026,Withdrawal ACH,STATE FARM INSURANCE,-141.50,,1907.15,,0.00",
    "2026005,10/05/2026,Deposit ACH,NORTHWIND LABS PAYROLL,,2610.25,2048.65,,0.00",
    "2026006,10/01/2026,Withdrawal ACH,CHASE CREDIT CRD EPAY,-600.00,,-561.60,,0.00",
    "2026007,09/28/2026,Withdrawal ACH,ONLINE TRANSFER TO SAV,-200.00,,38.40,,0.00",
  ].join("\n");

  it("takes Amount Debit and Amount Credit as two columns, not one amount", () => {
    expect(guessOf(creditUnion)).toMatchObject({ amount: null, debit: 4, credit: 5, balance: 6 });
  });

  it("reads the memo when the description only says Withdrawal or Deposit", () => {
    expect(guessOf(creditUnion).description).toBe(3);
  });

  it("leaves a description that names things, beside a memo that does too", () => {
    expect(
      guessOf(
        [
          "Date,Description,Memo,Amount",
          "10/28/2026,MAPLE COURT,a,-1.00",
          "10/17/2026,NORTHWIND LABS,b,2.00",
          "10/16/2026,XCEL ENERGY,c,-3.00",
          "10/15/2026,STATE FARM,d,-4.00",
        ].join("\n"),
      ).description,
    ).toBe(1);
  });

  it("doesn't name rows after the account (Rocket Money)", () => {
    const guess = guessOf(
      [
        "Date,Original Date,Account Type,Account Name,Account Number,Institution Name,Name,Custom Name,Amount,Description,Category,Note",
        "2026-10-28,2026-10-28,Cash,Checking,8812,First Bank,Maple Court,,1425.00,ACH MAPLE COURT APTS RENT,Rent,",
        "2026-10-27,2026-10-27,Credit Card,Visa,4411,First Bank,Netflix,,22.99,NETFLIX.COM,Fun,",
      ].join("\n"),
    );
    expect(guess.description).toBe(9);
    expect(guess.amount).toBe(8);
  });

  it("prefers the bank's own line to an app's tidied name (Monarch, Mint)", () => {
    const monarch = guessOf(
      [
        "Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags",
        "2026-10-17,Northwind Labs,Paychecks,Checking,NORTHWIND LABS PAYROLL PPD,,2610.25,",
        "2026-10-05,Netflix,Fun,Visa,NETFLIX.COM,,-22.99,",
      ].join("\n"),
    );
    expect(monarch.description).toBe(4);
    const mint = guessOf(
      [
        "Date,Description,Original Description,Amount,Transaction Type,Category,Account Name,Labels,Notes",
        "10/17/2026,Northwind Labs,NORTHWIND LABS PAYROLL,2610.25,credit,Paycheck,Checking,,",
        "10/05/2026,Netflix,NETFLIX.COM,22.99,debit,Movies,Visa,,",
      ].join("\n"),
    );
    expect(mint.description).toBe(2);
  });

  it("still prefers a payee to the memo that comes first in the file", () => {
    expect(
      guessOf(
        ["Date,Memo,Payee,Amount", "10/17/2026,x,NORTHWIND,2.00", "10/16/2026,y,XCEL,-1.00"].join(
          "\n",
        ),
      ).description,
    ).toBe(2);
  });
});

// Debugger 11-02: "1,250.00-" and "12.50 DR" weren't amounts, so 36 of 40 rows were skipped, and
// a file with every row marked couldn't be imported at all.
describe("an amount with its sign after it", () => {
  it.each([
    ["1,250.00-", -125_000],
    ["29.99-", -2_999],
    ["29.99 -", -2_999],
    ["3,210.75+", 321_075],
    ["12.50 DR", -1_250],
    ["12.50DR", -1_250],
    ["12.50 dr", -1_250],
    ["3,210.75 CR", 321_075],
    ["3,210.75cr", 321_075],
    ["$12.50 DR", -1_250],
    ["$12.50-", -1_250],
    ["1.234,56-", -123_456],
    ["12.50", 1_250],
    ["-12.50", -1_250],
  ])("reads %s", (text, cents) => {
    expect(parseAmount(text)).toBe(cents);
  });

  it.each(["CR", "DR", "-", "+", "ABC-", "DRCR", "12.50 XX", "12-50", "4411-22"])(
    "isn't an amount: %s",
    (text) => {
      expect(parseAmount(text)).toBeNull();
    },
  );

  const file = (amounts: string[]) =>
    readCsvFile({
      name: "marked.csv",
      text: [
        "Date,Description,Amount",
        `10/27/2026,DELTA AIR LINES,"${amounts[0]}"`,
        `10/17/2026,LUMEN WORKS PAYROLL,"${amounts[1]}"`,
        `10/14/2026,KROGER 0442,"${amounts[2]}"`,
      ].join("\n"),
      mapping: {
        hasHeader: true,
        date: 0,
        description: 1,
        amount: { kind: "signed", column: 2, moneyOut: "negative" },
      },
    });

  it.each([
    ["minus after", ["1,250.00-", "3,210.75", "84.25-"]],
    ["DR and CR", ["1,250.00 DR", "3,210.75 CR", "84.25 DR"]],
  ])("keeps every row with money the right way round: %s", (_, amounts) => {
    const result = file(amounts);
    if (!result.ok) throw new Error(result.error);
    expect(result.skipped).toEqual([]);
    expect(result.transactions.map((t) => t.amountCents)).toEqual([125_000, -321_075, 8_425]);
  });

  it("guesses the sign for a file written this way", () => {
    const { signs } = mappingChoices(
      parseCsv(
        [
          "Date,Description,Amount",
          "10/27/2026,DELTA AIR LINES,1250.00 DR",
          "10/17/2026,LUMEN WORKS PAYROLL,3210.75 CR",
          "10/14/2026,KROGER 0442,84.25 DR",
        ].join("\n"),
      ),
    );
    expect(signs[2].moneyOut).toBe("negative");
  });
});
