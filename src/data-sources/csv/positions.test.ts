import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { notAStatement, readCsvFile } from "./csv-source";
import {
  NOT_POSITIONS,
  detectPositionsLayout,
  parseFileDate,
  parseNumber,
  readPositionsFile,
  subtypeFromName,
  typeFromName,
  type PositionsFile,
} from "./positions";

// Fixtures are made-up holdings in each broker's published download layout, not real data.
const text = (name: string) =>
  readFileSync(new URL(`./__fixtures__/positions/${name}`, import.meta.url), "utf8");

function read(name: string): PositionsFile {
  const result = readPositionsFile(text(name));
  if ("error" in result) throw new Error(result.error);
  return result;
}

const rows = (file: PositionsFile, account = 0) =>
  file.accounts[account].positions.map((p) => [p.ticker, p.quantity, p.valueCents, p.isCash]);

describe("Fidelity positions", () => {
  const file = read("fidelity.csv");

  it("is detected, with the download date under the rows", () => {
    expect(file.layout).toBe("fidelity");
    expect(file.asOf).toBe("2026-10-28");
  });

  it("splits the file into its accounts, named with the last four", () => {
    expect(file.accounts.map((a) => [a.name, a.mask, a.subtype])).toEqual([
      ["Fidelity Individual …0001", "0001", "brokerage"],
      ["Fidelity ROTH IRA …0002", "0002", "roth"],
    ]);
  });

  it("reads the core position as cash and leaves out pending activity", () => {
    expect(rows(file)).toEqual([
      ["SPAXX", 6200, 620000, true],
      ["FMAGX", 500, 750000, false],
      ["FXAIX", 50.123, 1128269, false],
    ]);
    expect(file.skipped).toBe(1);
    expect(file.accounts[0].cashCents).toBe(620000);
    expect(file.accounts[0].valueCents).toBe(2498269);
  });

  it("keeps plain cash (FCASH) apart from a money market fund (SPAXX): no ticker", () => {
    expect(rows(file, 1)).toEqual([
      [null, 300, 30000, true],
      ["VTI", 20, 570000, false],
    ]);
    expect(file.accounts[1].positions[0].name).toBe("Cash");
  });

  it("keeps the cost basis and price, and none for cash", () => {
    const [cash, magellan] = file.accounts[0].positions;
    expect(cash.costBasisCents).toBeNull();
    expect(cash.priceCents).toBe(100);
    expect(magellan.costBasisCents).toBe(600000);
    expect(magellan.priceCents).toBe(1500);
    expect(magellan.name).toBe("Fidelity Magellan");
  });
});

describe("Schwab positions", () => {
  it("reads one account's export: the title names it, options are left out", () => {
    const file = read("schwab.csv");
    expect(file.layout).toBe("schwab");
    expect(file.asOf).toBe("2026-10-28");
    expect(file.accounts.map((a) => [a.name, a.mask])).toEqual([["Schwab Individual …901", "901"]]);
    expect(rows(file)).toEqual([
      ["SWTSX", 200, 1910000, false],
      ["SCHD", 100, 270000, false],
      [null, 2200, 220000, true],
    ]);
    // Schwab's own Account Total, $24,310, less the $310 option left out.
    expect(file.accounts[0].valueCents).toBe(2431000 - 31000);
    expect(file.skipped).toBe(1);
    expect(file.accounts[0].positions[1].type).toBe("etf");
    expect(file.accounts[0].positions[0].costBasisCents).toBe(1500000);
  });

  it("reads the all-accounts export one block at a time", () => {
    const file = read("schwab-all-accounts.csv");
    expect(file.asOf).toBe("2026-10-28");
    expect(file.accounts.map((a) => [a.name, a.subtype, a.valueCents])).toEqual([
      ["Schwab Individual …901", "brokerage", 900000],
      ["Schwab Roth Contributory IRA …456", "roth", 120000],
    ]);
  });
});

describe("Vanguard holdings", () => {
  const file = read("vanguard.csv");

  it("reads the holdings and stops at the transactions", () => {
    expect(file.layout).toBe("vanguard");
    expect(file.accounts.map((a) => [a.name, a.valueCents, a.cashCents])).toEqual([
      ["Vanguard Account …0003", 2096056, 125075],
      ["Vanguard Account …0004", 1650000, 0],
    ]);
    expect(rows(file)[0]).toEqual(["VMFXX", 1250.75, 125075, true]);
  });

  it("says it can't tell the account type or cost", () => {
    expect(file.asOf).toBeNull();
    expect(file.notes.join(" ")).toMatch(/account type/);
    expect(file.accounts[0].positions.every((p) => p.costBasisCents === null)).toBe(true);
  });
});

describe("Robinhood account activity", () => {
  const file = read("robinhood.csv");

  it("counts shares from the trades, oldest first, priced at the last trade", () => {
    expect(file.layout).toBe("robinhood");
    expect(file.asOf).toBe("2026-10-20");
    expect(rows(file)).toEqual([
      ["AAPL", 5, 115000, false],
      ["VOO", 8, 448000, false],
      [null, 2677.5, 267750, true],
    ]);
    const [apple, voo] = file.accounts[0].positions;
    expect(apple.name).toBe("Apple");
    expect(apple.costBasisCents).toBe(115000);
    // Ten bought for $5,000, two sold: eight at the average cost.
    expect(voo.costBasisCents).toBe(400000);
  });

  it("leaves options out and says how it was read", () => {
    expect(file.skipped).toBe(1);
    expect(file.notes[0]).toMatch(/no holdings download/);
    expect(file.notes).toHaveLength(1);
  });

  it("warns when the report starts after some trades", () => {
    const late = text("robinhood.csv").replace(/"08\/03\/2026"[\s\S]*?"Buy","10".*\n/, "");
    const result = readPositionsFile(late);
    if ("error" in result) throw new Error(result.error);
    expect(result.notes[1]).toMatch(/starts after some of your trades/);
    expect(result.accounts[0].positions.map((p) => p.ticker)).toEqual(["AAPL", null]);
  });
});

describe("what isn't a positions file", () => {
  it("refuses a bank statement and says which downloads work", () => {
    const bank = readFileSync(
      new URL("./__fixtures__/chase-checking.csv", import.meta.url),
      "utf8",
    );
    expect(detectPositionsLayout(bank)).toBeNull();
    expect(readPositionsFile(bank)).toEqual({ error: NOT_POSITIONS });
  });

  it("isn't read as a bank statement either", () => {
    for (const name of ["fidelity.csv", "schwab.csv", "vanguard.csv", "robinhood.csv"]) {
      expect(detectPositionsLayout(text(name))).not.toBeNull();
      const asBank = readCsvFile({ name, text: text(name) });
      expect(asBank.ok && asBank.transactions.length > 0).toBe(false);
    }
  });

  it("refuses a header with nothing under it", () => {
    const header = text("vanguard.csv").split("\n")[0];
    expect(readPositionsFile(header)).toEqual({ error: expect.stringMatching(/no holdings/) });
  });
});

// #902: readers that look at the first N characters broke on long files where a quoted field
// straddled the cut. The upload path sniffs 8,192 characters (notAStatement) before reading.
describe("a long Fidelity file", () => {
  const head = text("fidelity.csv").split("\n")[0];
  const line = (i: number, description: string) =>
    `Z00000001,Individual,T${String(i).padStart(4, "0")},"${description}",1,$10.00,+$0.00,$10.00,,,,,0.1%,$9.00,$9.00,Cash,`;
  const body: string[] = [];
  let i = 0;
  // Grow it until a quoted description straddles both 4,000 and 8,192 characters.
  const straddles = (at: number, file: string) => {
    const open = file.lastIndexOf('"', at);
    return file.slice(0, open).split('"').length % 2 === 1 && file.indexOf('"', at) > at;
  };
  let file = "";
  while (file.length < 9000 || !straddles(8192, file) || !straddles(4000, file)) {
    body.push(
      line(i++, `FUND, WITH "COMMAS" AND QUOTES ${"X".repeat(i % 37)}`.replace(/"/g, '""')),
    );
    file = [head, ...body, "", '"Date downloaded Oct-28-2026 10:23 a.m ET"'].join("\n");
    if (i > 2000) throw new Error("no straddle");
  }

  it("is still a positions file and every row is read", () => {
    expect(file.length).toBeGreaterThan(8192);
    expect(notAStatement(file)).toBe(false);
    const result = readPositionsFile(file);
    if ("error" in result) throw new Error(result.error);
    expect(result.accounts[0].positions).toHaveLength(i);
    expect(result.accounts[0].positions[0].name).toMatch(/^Fund, With "Commas"/i);
    expect(result.asOf).toBe("2026-10-28");
  });
});

describe("helpers", () => {
  it("reads brokers' numbers", () => {
    expect(parseNumber("$1,234.56")).toBe(1234.56);
    expect(parseNumber("+$1.00")).toBe(1);
    expect(parseNumber("-$12.50")).toBe(-12.5);
    expect(parseNumber("$-25.00")).toBe(-25);
    expect(parseNumber("($1,150.00)")).toBe(-1150);
    expect(parseNumber("12.5S")).toBe(12.5);
    expect(parseNumber("--")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("reads the dates brokers write", () => {
    expect(parseFileDate("Date downloaded Oct-28-2026 10:23 a.m ET")).toBe("2026-10-28");
    expect(parseFileDate("as of 10:23 AM ET, 2026/10/28")).toBe("2026-10-28");
    expect(parseFileDate("10/28/2026")).toBe("2026-10-28");
    expect(parseFileDate("13/45/2026")).toBeNull();
  });

  it("names the account type from its name", () => {
    expect(subtypeFromName("ROTH IRA")).toBe("roth");
    expect(subtypeFromName("Rollover IRA")).toBe("ira");
    expect(subtypeFromName("Health Savings Account")).toBe("hsa");
    expect(subtypeFromName("ACME 401(K) PLAN")).toBe("401k");
    expect(subtypeFromName("Roth 401(k)")).toBe("roth 401k");
    expect(subtypeFromName("Individual")).toBe("brokerage");
  });
});

// Debugger 11-01: a Fidelity file doesn't say what each holding is, so Apple was stored with no
// type: /investments said "I don't know the yearly cost of FMAGX, AAPL" (a stock has none) and
// counted it as "other", not US stocks. The file's own words tell funds, ETFs and stocks apart.
describe("what each holding is, when the file doesn't say", () => {
  const types = (file: PositionsFile, account = 0) =>
    file.accounts[account].positions.map((p) => [p.ticker, p.type]);

  it("reads mutual funds, ETFs and stocks from the ticker and the name", () => {
    expect(typeFromName("FMAGX", "FIDELITY MAGELLAN")).toBe("mutual fund");
    expect(typeFromName("VTI", "VANGUARD INDEX FDS VANGUARD TOTAL STK MKT ETF")).toBe("etf");
    expect(typeFromName("SPY", "SPDR S&P 500 ETF TRUST")).toBe("etf");
    expect(typeFromName("AAPL", "APPLE INC")).toBe("equity");
    expect(typeFromName("MSFT", "MICROSOFT CORP")).toBe("equity");
    expect(typeFromName("BRK/B", "BERKSHIRE HATHAWAY INC CL B")).toBe("equity");
    // A fund's words without a fund ticker: a fund, but which kind isn't known.
    expect(typeFromName("QQQ", "INVESCO QQQ TRUST SERIES 1")).toBeNull();
    expect(typeFromName("XYZ", "SOMETHING")).toBeNull();
  });

  it("types Fidelity's and Vanguard's rows, and Robinhood's stocks as stocks", () => {
    expect(types(read("fidelity.csv"))).toEqual([
      ["SPAXX", "cash"],
      ["FMAGX", "mutual fund"],
      ["FXAIX", "mutual fund"],
    ]);
    expect(types(read("fidelity.csv"), 1)).toEqual([
      [null, "cash"],
      ["VTI", "etf"],
    ]);
    expect(types(read("vanguard.csv"))).toContainEqual(["VTSAX", "mutual fund"]);
    expect(types(read("robinhood.csv"))).toEqual([
      ["AAPL", "equity"],
      ["VOO", "etf"],
      [null, "cash"],
    ]);
    // A fund Robinhood names without "ETF" isn't called a stock.
    const qqq = readPositionsFile(
      text("robinhood.csv").replace(/"VOO","Vanguard S&P 500 ETF/g, '"QQQ","Invesco QQQ Trust'),
    );
    if ("error" in qqq) throw new Error(qqq.error);
    expect(types(qqq)).toContainEqual(["QQQ", null]);
  });
});
