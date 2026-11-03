import { describe, expect, it } from "vitest";
import { readCsvFile, type CsvFile } from "./csv-source";
import { CSV_SETS, readFixtures } from "@/accuracy/csv/report";
import { closingBalances, controlTotals, statedTotals } from "./control-totals";
import { parseCsv } from "./parse-csv";

function read(
  text: string,
  name = "statement.csv",
  extra: Partial<CsvFile> = {},
  kind?: "credit_card" | "checking",
) {
  const result = readCsvFile({ name, text, ...extra }, kind);
  if (!result.ok) throw new Error(result.error);
  return result;
}
const codes = (r: ReturnType<typeof read>) => r.control.warnings.map((w) => w.code);

const CHASE_HEADER = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #";
const chase = (rows: [string, string, string, string][]) =>
  [
    CHASE_HEADER,
    ...rows.map(
      ([date, what, amount, balance]) =>
        `${Number(amount) < 0 ? "DEBIT" : "CREDIT"},${date},${what},${amount},MISC,${balance},`,
    ),
  ].join("\n");

const CHASE_NEWEST_FIRST: [string, string, string, string][] = [
  ["10/05/2026", "COFFEE", "-5.00", "1395.00"],
  ["10/04/2026", "PAY", "500.00", "1400.00"],
  ["10/03/2026", "GROCER", "-80.00", "900.00"],
  ["10/02/2026", "RENT", "-20.00", "980.00"],
];

const bofa = ({
  begin = "1,000.00",
  end = "1,300.00",
  credits = "500.00",
  debits = "-200.00",
  rows = [
    `10/02/2026,RENT,"-150.00","850.00"`,
    `10/03/2026,GROCER,"-50.00","800.00"`,
    `10/04/2026,PAY,"500.00","1,300.00"`,
  ],
}: {
  begin?: string;
  end?: string;
  credits?: string;
  debits?: string;
  rows?: string[];
} = {}) =>
  [
    "Description,,Summary Amt.",
    `Beginning balance as of 10/01/2026,,"${begin}"`,
    `Total credits,,"${credits}"`,
    `Total debits,,"${debits}"`,
    `Ending balance as of 10/04/2026,,"${end}"`,
    "",
    "Date,Description,Amount,Running Bal.",
    `10/01/2026,Beginning balance as of 10/01/2026,,"${begin}"`,
    ...rows,
  ].join("\n");

describe("a statement that adds up", () => {
  it("says nothing, newest first", () => {
    const r = read(chase(CHASE_NEWEST_FIRST));
    expect(r.control.warnings).toEqual([]);
    expect(r.control.balanceWay).toBe("down");
    expect(r.balances?.at(-1)).toEqual({ date: "2026-10-05", balanceCents: 139500 });
  });

  it("says nothing, oldest first", () => {
    expect(read(chase([...CHASE_NEWEST_FIRST].reverse())).control.warnings).toEqual([]);
  });

  it("says nothing with days newest first and rows oldest first within a day", () => {
    const r = read(
      chase(
        [
          ["10/04/2026", "A", "-10.00", "990.00"],
          ["10/04/2026", "B", "-20.00", "970.00"],
          ["10/03/2026", "C", "-30.00", "1000.00"],
          ["10/03/2026", "D", "-40.00", "1000.00"],
        ].slice(0, 3) as [string, string, string, string][],
      ),
    );
    expect(r.control.warnings).toEqual([]);
    expect(r.balances?.at(-1)?.balanceCents).toBe(97000);
  });

  it("says nothing when the bank prints a balance only at the day's end", () => {
    const r = read(
      chase([
        ["10/02/2026", "A", "-10.00", "990.00"],
        ["10/03/2026", "B", "-20.00", ""],
        ["10/03/2026", "C", "-30.00", "940.00"],
        ["10/04/2026", "D", "-1.00", "939.00"],
      ]),
    );
    expect(r.control.warnings).toEqual([]);
  });

  it("says nothing when a pending row has no balance and hasn't moved it", () => {
    const r = read(
      chase([
        ["10/04/2026", "HOLD", "-99.00", ""],
        ["10/04/2026", "A", "-1.00", "939.00"],
        ["10/03/2026", "B", "-1.00", "940.00"],
        ["10/02/2026", "C", "-1.00", "941.00"],
      ]),
    );
    expect(r.control.warnings).toEqual([]);
  });

  it("reads an overdrawn balance, and balances written in accounting style", () => {
    const r = read(
      chase([
        ["10/02/2026", "A", "-10.00", "5.00"],
        ["10/03/2026", "B", "-20.00", "(15.00)"],
        ["10/04/2026", "C", "-5.00", "$-20.00"],
      ]),
    );
    expect(r.control.warnings).toEqual([]);
    expect(r.balances?.at(-1)?.balanceCents).toBe(-2000);
  });

  it("checks Bank of America's stated block and says nothing", () => {
    expect(read(bofa()).control.warnings).toEqual([]);
  });

  it("says nothing of a shape with no balance and no totals (a card)", () => {
    const r = read(
      [
        "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
        "10/01/2026,10/02/2026,NETFLIX.COM,Entertainment,Sale,-15.49,",
        "10/03/2026,10/04/2026,TRADER JOE'S,Groceries,Sale,-44.10,",
        "10/05/2026,10/05/2026,PAYMENT THANK YOU,,Payment,200.00,",
      ].join("\n"),
    );
    expect(r.control.warnings).toEqual([]);
  });

  it("gives no false alarm on any exported layout of the CSV bench", () => {
    const alarms: string[] = [];
    let files = 0;
    let balanced = 0;
    for (const set of CSV_SETS) {
      for (const [name, text] of readFixtures(set)) {
        const result = readCsvFile({ name, text });
        if (!result.ok) continue;
        files += 1;
        if (result.control.balanceWay) balanced += 1;
        for (const w of result.control.warnings) alarms.push(`${name}: ${w.code} ${w.message}`);
      }
    }
    expect(files).toBeGreaterThan(100);
    expect(balanced).toBeGreaterThan(10);
    expect(alarms).toEqual([]);
  });
});

describe("a statement that doesn't add up", () => {
  it("warns when a row is missing from under the balance column", () => {
    const rows = [...CHASE_NEWEST_FIRST];
    rows.splice(1, 1);
    const r = read(chase(rows));
    expect(codes(r)).toEqual(["balance_gap"]);
    expect(r.control.warnings[0]?.message).toContain("Oct 5, 2026");
    expect(r.control.warnings[0]?.message).toContain("$500.00");
    // The bank's own balance stays: it's the rows that are short.
    expect(r.balances?.at(-1)?.balanceCents).toBe(139500);
  });

  it("warns when an unreadable row breaks the walk, and counts it", () => {
    const rows = [...CHASE_NEWEST_FIRST];
    rows[1] = ["10/04/2026", "PAY", "five hundred", "1400.00"];
    const r = read(chase(rows));
    expect(codes(r)).toEqual(expect.arrayContaining(["balance_gap", "rows_unread"]));
    expect(r.control.rows).toEqual({ inFile: 4, read: 3, skipped: 1, leftOut: 0 });
  });

  it("doesn't use a column that isn't a balance as the account's balance", () => {
    const r = read(
      chase([
        ["10/02/2026", "A", "-10.00", "4417"],
        ["10/03/2026", "B", "-20.00", "4418"],
        ["10/04/2026", "C", "-5.00", "4419"],
        ["10/05/2026", "D", "-7.00", "4420"],
      ]),
    );
    expect(codes(r)).toEqual(["not_a_balance"]);
    expect(r.balances).toEqual([]);
  });

  it("warns when opening plus the rows isn't the closing balance", () => {
    const r = read(bofa({ end: "1,400.00" }));
    expect(codes(r)).toContain("statement_total");
    expect(r.control.warnings.find((w) => w.code === "statement_total")?.message).toContain(
      "$100.00",
    );
  });

  it("warns when the stated money in or out isn't what the rows come to", () => {
    expect(codes(read(bofa({ credits: "900.00" })))).toEqual(["statement_total"]);
    expect(codes(read(bofa({ debits: "-1.00" })))).toEqual(["statement_total"]);
  });

  it("warns when a footer's total isn't the rows'", () => {
    const text = `${chase(CHASE_NEWEST_FIRST)}\nTotal,,,1.00,,,`;
    expect(codes(read(text))).toEqual(["statement_total"]);
    const right = `${chase(CHASE_NEWEST_FIRST)}\nTotal,,,395.00,,,`;
    expect(codes(read(right))).toEqual([]);
  });

  it("warns when a stated row count isn't what's there", () => {
    const text = `${chase(CHASE_NEWEST_FIRST)}\nTotal transactions,,,5,,,`;
    expect(codes(read(text))).toEqual(["row_count"]);
  });

  it("warns when downloads were pasted together", () => {
    const text = `${chase(CHASE_NEWEST_FIRST)}\n${chase(CHASE_NEWEST_FIRST)}`;
    expect(codes(read(text))).toContain("repeated_header");
  });

  it("warns when a card file's signs look backwards", () => {
    const r = read(
      [
        "Date,Description,Card Member,Account #,Amount",
        ...["NETFLIX.COM", "SPOTIFY", "TRADER JOE'S", "SHELL OIL", "HULU", "STARBUCKS"].map(
          (d, i) => `10/0${i + 1}/2026,${d},SAM,-1000,-12.00`,
        ),
      ].join("\n"),
    );
    expect(codes(r)).toEqual(["signs_reversed"]);
  });

  it("says nothing of a row's description in any warning", () => {
    const rows: [string, string, string, string][] = [
      ["10/05/2026", "SECRET SHOP", "-5.00", "1395.00"],
      ["10/03/2026", "OTHER SECRET", "-80.00", "900.00"],
      ["10/02/2026", "THIRD SECRET", "bad", "980.00"],
    ];
    const r = read(chase(rows));
    expect(r.control.warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.control.warnings)).not.toMatch(/SECRET/);
  });
});

describe("signs against a mapped file's own balance", () => {
  const text = [
    "When,What,Amount,Balance",
    "10/02/2026,A,-10.00,110.00",
    "10/03/2026,B,-20.00,130.00",
    "10/04/2026,C,-5.00,135.00",
    "10/05/2026,D,40.00,95.00",
  ].join("\n");
  const signed = {
    hasHeader: true,
    date: 0,
    dateOrder: "mdy",
    description: 1,
    amount: { kind: "signed", column: 2, moneyOut: "negative" },
    balance: 3,
  } as const;

  it("warns in the preview while the account's kind isn't known", () => {
    const r = read(text, "x.csv", { mapping: signed });
    expect(codes(r)).toEqual(["signs_reversed"]);
    expect(r.control.warnings[0]?.message).toContain("Unless this is a credit card");
  });

  it("refuses the save on a bank account: the person can pick the other sign", () => {
    const r = readCsvFile({ name: "x.csv", text, mapping: signed }, "checking");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("unknown_format");
    expect(!r.ok && r.choices).toBeTruthy();
  });

  it("is what a card's balance does when it's written as what's owed", () => {
    const owed = [
      "When,What,Amount,Balance",
      "10/02/2026,A,10.00,110.00",
      "10/03/2026,B,20.00,130.00",
      "10/04/2026,C,5.00,135.00",
      "10/05/2026,PAYMENT,-40.00,95.00",
    ].join("\n");
    const mapping = { ...signed, amount: { ...signed.amount, moneyOut: "positive" } } as const;
    const r = read(owed, "x.csv", { mapping }, "credit_card");
    expect(r.control.warnings).toEqual([]);
    expect(r.balances?.at(-1)?.balanceCents).toBe(9500);
  });

  it("turns round a card balance written negative, so net worth subtracts the debt", () => {
    const negative = [
      "When,What,Amount,Balance",
      "10/02/2026,A,10.00,-110.00",
      "10/03/2026,B,20.00,-130.00",
      "10/04/2026,C,5.00,-135.00",
    ].join("\n");
    const mapping = { ...signed, amount: { ...signed.amount, moneyOut: "positive" } } as const;
    const r = read(negative, "x.csv", { mapping }, "credit_card");
    expect(r.control.warnings).toEqual([]);
    expect(r.balances?.at(-1)?.balanceCents).toBe(13500);
  });
});

describe("rows that look like totals", () => {
  const mapping = {
    hasHeader: true,
    date: 1,
    dateOrder: "mdy",
    description: 0,
    amount: { kind: "signed", column: 2, moneyOut: "negative" },
  } as const;

  it("keeps a shop named like a total", () => {
    const text = [
      "What,When,Amount",
      "Total Wine & More,10/02/2026,-45.00",
      "Summary Fitness,10/03/2026,-30.00",
      "Totals Barbershop,10/03/2026,-25.00",
    ].join("\n");
    expect(read(text, "x.csv", { mapping }).transactions).toHaveLength(3);
  });

  it("still leaves out a real total", () => {
    const text = [
      "What,When,Amount",
      "Lunch,10/02/2026,-45.00",
      "Total,,-45.00",
      "Total debits,,-45.00",
      "Ending balance,10/02/2026,100.00",
    ].join("\n");
    const r = read(text, "x.csv", { mapping });
    expect(r.transactions).toHaveLength(1);
    expect(r.control.rows).toEqual({ inFile: 4, read: 1, skipped: 0, leftOut: 3 });
  });
});

describe("the walk, at its edges", () => {
  it("takes a cent either way as rounding, and two as a real gap", () => {
    const rows = (balance: string) =>
      chase([
        ["10/02/2026", "A", "-10.00", "990.00"],
        ["10/03/2026", "B", "-20.00", "970.00"],
        ["10/04/2026", "C", "-20.00", "950.00"],
        ["10/05/2026", "D", "-20.00", balance],
      ]);
    expect(codes(read(rows("930.01")))).toEqual([]);
    expect(codes(read(rows("930.02")))).toEqual(["balance_gap"]);
  });

  it("checks a statement of one day by whether its rows lead to one another", () => {
    const day = (last: string) =>
      chase([
        ["10/02/2026", "A", "-10.00", "990.00"],
        ["10/02/2026", "B", "-20.00", "970.00"],
        ["10/02/2026", "C", "-5.00", last],
      ]);
    expect(codes(read(day("965.00")))).toEqual([]);
    expect(codes(read(day("500.00")))).toEqual(["balance_gap"]);
  });

  it("doesn't call a first day broken when one of its rows has no balance", () => {
    const r = read(
      chase([
        ["10/02/2026", "A", "-10.00", "990.00"],
        ["10/02/2026", "HOLD", "-99.00", ""],
        ["10/02/2026", "B", "-20.00", "970.00"],
        ["10/03/2026", "C", "-5.00", "965.00"],
      ]),
    );
    expect(codes(r)).toEqual([]);
  });

  it("wants three days' changes before calling signs backwards from a balance alone", () => {
    const text = (rows: string[]) => ["When,What,Amount,Balance", ...rows].join("\n");
    const mapping = {
      hasHeader: true,
      date: 0,
      dateOrder: "mdy",
      description: 1,
      amount: { kind: "signed", column: 2, moneyOut: "negative" },
      balance: 3,
    } as const;
    const twoChanges = [
      "10/02/2026,A,-10.00,110.00",
      "10/03/2026,B,-20.00,130.00",
      "10/04/2026,C,-5.00,135.00",
    ];
    expect(codes(read(text(twoChanges), "x.csv", { mapping }))).toEqual([]);
    const threeChanges = [...twoChanges, "10/05/2026,D,-1.00,136.00"];
    expect(codes(read(text(threeChanges), "x.csv", { mapping }))).toEqual(["signs_reversed"]);
  });

  it("says the gap's dollars only when a day's money went missing", () => {
    const [gap] = read(
      chase([
        ["10/02/2026", "A", "-10.00", "990.00"],
        ["10/03/2026", "B", "-20.00", "970.00"],
        ["10/04/2026", "C", "-20.00", "900.00"],
        ["10/05/2026", "D", "-20.00", "880.00"],
      ]),
    ).control.warnings;
    expect(gap?.message).toContain("1 day, first on Oct 4, 2026: $50.00 isn't explained");
  });
});

describe("signs with no balance to check them by", () => {
  const WELLS = (rows: [string, string][]) =>
    rows.map(([what, amount], i) => `"10/0${i + 1}/2026","${amount}","*","","${what}"`).join("\n");
  const SPENDING = ["NETFLIX.COM", "SPOTIFY", "TRADER JOE'S", "SHELL OIL", "HULU"];

  it("warns when what the rules know runs against most rows' signs", () => {
    const backwards = WELLS(SPENDING.map((name): [string, string] => [name, "12.00"]));
    expect(codes(read(backwards))).toEqual(["signs_reversed"]);
  });

  it("says nothing when they run with most rows' signs", () => {
    const right = WELLS(SPENDING.map((name): [string, string] => [name, "-12.00"]));
    expect(codes(read(right))).toEqual([]);
  });

  it("says nothing on four rows, or when one in three runs against", () => {
    const four = WELLS(SPENDING.slice(0, 4).map((name): [string, string] => [name, "12.00"]));
    expect(codes(read(four))).toEqual([]);
    const mixed = WELLS([
      ...SPENDING.slice(0, 2).map((name): [string, string] => [name, "12.00"]),
      ...SPENDING.slice(2).map((name): [string, string] => [name, "-12.00"]),
    ]);
    expect(codes(read(mixed))).toEqual([]);
  });

  it("says nothing of a bank account that's mostly money in, with no names it knows", () => {
    const deposits = WELLS(
      ["A", "B", "C", "D", "E", "F"].map((name): [string, string] => [`CLIENT ${name}`, "500.00"]),
    );
    expect(codes(read(deposits))).toEqual([]);
  });

  const AMEX = (amounts: string[]) =>
    [
      "Date,Description,Card Member,Account #,Amount",
      ...amounts.map((a, i) => `10/0${i + 1}/2026,UNKNOWN PLACE ${i},SAM,-1000,${a}`),
    ].join("\n");

  it("on a card, wants most of five rows paid in, not rows at zero", () => {
    expect(codes(read(AMEX(["-1.00", "-2.00", "-3.00", "-4.00"])))).toEqual([]);
    expect(codes(read(AMEX(["-1.00", "-2.00", "-3.00", "-4.00", "-5.00"])))).toEqual([
      "signs_reversed",
    ]);
    expect(codes(read(AMEX(["-1.00", "-2.00", "-3.00", "4.00", "5.00"])))).toEqual([]);
    expect(codes(read(AMEX(["-1.00", "-2.00", "-3.00", "-4.00", "0.00", "0.00", "0.00"])))).toEqual(
      [],
    );
  });
});

describe("statedTotals, row by row", () => {
  it("takes the first opening balance said and the last closing one", () => {
    const text = [
      "Opening balance,,100.00",
      "Closing balance,,120.00",
      "Date,Description,Amount",
      "Opening balance,,999.00",
      "Closing balance,,130.00",
    ].join("\n");
    expect(statedTotals(parseCsv(text))).toMatchObject({
      openingCents: 10000,
      closingCents: 13000,
    });
  });

  it("reads a row count as a count", () => {
    expect(statedTotals(parseCsv("Total transactions,12"))).toEqual({ rowCount: 12 });
    const text = `${chase(CHASE_NEWEST_FIRST)}\nTotal transactions,,,4,,,`;
    expect(codes(read(text))).toEqual([]);
  });

  it("counts an unread row among those a stated count covers", () => {
    const rows = [...CHASE_NEWEST_FIRST];
    rows[3] = ["10/02/2026", "RENT", "lots", "980.00"];
    const text = `${chase(rows)}\nTotal transactions,,,4,,,`;
    expect(codes(read(text))).not.toContain("row_count");
  });

  it("ignores a label with no figure, and a figure with no label", () => {
    expect(statedTotals(parseCsv("Ending balance,,n/a\nWhatever,,5.00"))).toEqual({});
  });

  it("reads a label in the second column, not one further along", () => {
    expect(statedTotals(parseCsv("x,Ending balance,1.00"))).toEqual({ closingCents: 100 });
    expect(statedTotals(parseCsv("x,y,Ending balance,1.00"))).toEqual({});
  });

  it("reads the figure after the label, never before it", () => {
    expect(statedTotals(parseCsv("9.00,Ending balance,1.00"))).toEqual({ closingCents: 100 });
    expect(statedTotals(parseCsv("9.00,Ending balance,x"))).toEqual({});
  });

  it("isn't fooled by a shoe shop or a row with a shop's name in it", () => {
    const text = bofa({
      rows: [
        `10/02/2026,NEW BALANCE STORE,"-150.00","850.00"`,
        `10/03/2026,TOTAL WINE,"-50.00","800.00"`,
        `10/04/2026,PAY,"500.00","1,300.00"`,
      ],
    });
    expect(read(text).control.warnings).toEqual([]);
  });
});

describe("statedTotals", () => {
  it("reads a block above the header and a footer", () => {
    expect(statedTotals(parseCsv(bofa()))).toEqual({
      openingCents: 100000,
      closingCents: 130000,
      creditsCents: 50000,
      debitsCents: -20000,
    });
  });
});

describe("closingBalances, either way", () => {
  it("finds a day's closing row on a card that rises", () => {
    const rows = [
      { date: "2026-10-02", amountCents: 10, balanceCents: 110 },
      { date: "2026-10-02", amountCents: 20, balanceCents: 130 },
    ];
    expect(closingBalances([...rows].reverse(), "up")).toEqual([
      { date: "2026-10-02", balanceCents: 130 },
    ]);
  });
});

describe("OFX", () => {
  const block = (id: string, type: string, amount: string) =>
    `<STMTTRN><TRNTYPE>${type}<DTPOSTED>20261001<TRNAMT>${amount}<FITID>${id}<NAME>SHOP ${id}</STMTTRN>`;
  const ofx = (blocks: string[], end = "</BANKTRANLIST></STMTRS></OFX>") =>
    `OFXHEADER:100\n<OFX><STMTRS><BANKTRANLIST>${blocks.join("\n")}${end}`;

  it("says nothing of a whole file", () => {
    const r = read(ofx([block("1", "DEBIT", "-5.00"), block("2", "CREDIT", "9.00")]), "a.qfx");
    expect(r.control.warnings).toEqual([]);
    expect(r.control.rows).toEqual({ inFile: 2, read: 2, skipped: 0, leftOut: 0 });
  });

  it("warns when a download was cut off mid-row", () => {
    const text = `${ofx([block("1", "DEBIT", "-5.00")], "")}<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>2026`;
    expect(codes(read(text, "a.qfx"))).toEqual(["cut_off"]);
  });

  it("warns when one bank id has two amounts", () => {
    const text = ofx([block("1", "DEBIT", "-5.00"), block("1", "DEBIT", "-7.00")]);
    expect(codes(read(text, "a.qfx"))).toEqual(["same_id"]);
  });

  it("keeps quiet when the same row comes twice", () => {
    const text = ofx([block("1", "DEBIT", "-5.00"), block("1", "DEBIT", "-5.00")]);
    const r = read(text, "a.qfx");
    expect(codes(r)).toEqual([]);
    expect(r.control.rows.leftOut).toBe(1);
  });

  it("warns when amounts run against the debit and credit labels", () => {
    const blocks = ["1", "2", "3", "4", "5"].map((id) => block(id, "DEBIT", "5.00"));
    expect(codes(read(ofx(blocks), "a.qfx"))).toEqual(["signs_reversed"]);
  });
});

// A walk over the days has to add up the same rows the old search of them did, in any order.
describe("the balance walk's one pass", () => {
  const row = (date: string, amountCents: number, balanceCents?: number) => ({
    date,
    amountCents,
    ...(balanceCents === undefined ? {} : { balanceCents }),
  });
  const report = (rows: ReturnType<typeof row>[]) =>
    controlTotals({
      rows,
      described: [],
      stated: {},
      counts: { read: rows.length, kept: rows.length, leftOut: 0 } as never,
      unread: 0,
      repeatedHeaders: 0,
      kind: "checking",
    });

  it("counts each day's rows against that day's step, listed newest first", () => {
    expect(
      report([
        row("2026-10-03", 300, 400),
        row("2026-10-02", 200, 700),
        row("2026-10-01", 100, 900),
      ]).warnings,
    ).toEqual([]);
  });

  it("still finds a break between two days", () => {
    expect(
      report([
        row("2026-10-01", 100, 900),
        row("2026-10-02", 200, 650),
        row("2026-10-03", 300, 350),
      ]).warnings.length,
    ).toBeGreaterThan(0);
  });

  it("counts a row with no balance of its own, on a day that has a close", () => {
    expect(
      report([row("2026-10-01", 100, 900), row("2026-10-02", 50), row("2026-10-02", 150, 700)])
        .warnings,
    ).toEqual([]);
  });
});
