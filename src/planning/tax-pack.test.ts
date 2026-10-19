import { describe, expect, it } from "vitest";
import {
  buildTaxPack,
  csvCell,
  defaultTaxYear,
  estimatedTaxDates,
  nextEstimatedTaxDate,
  selectableYears,
  taxPackCsv,
  taxYearFrom,
  type PackTransaction,
} from "./tax-pack";

let n = 0;
const tx = (overrides: Partial<PackTransaction>): PackTransaction => ({
  id: `t${(n += 1)}`,
  date: "2026-03-10",
  amountCents: 5_000,
  description: "SOMETHING",
  merchantName: null,
  pfcDetailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
  ...overrides,
});

describe("which year the pack opens on", () => {
  it("is last year until April 30, then this year", () => {
    expect(defaultTaxYear("2027-01-02")).toBe(2026);
    expect(defaultTaxYear("2027-04-30")).toBe(2026);
    expect(defaultTaxYear("2027-05-01")).toBe(2027);
    expect(defaultTaxYear("2026-12-31")).toBe(2026);
  });

  it("takes a picked year in range, and ignores anything else", () => {
    expect(taxYearFrom("2024", "2026-10-18")).toBe(2024);
    expect(taxYearFrom("2027", "2026-10-18")).toBe(2026);
    expect(taxYearFrom("1999", "2026-10-18")).toBe(2026);
    expect(taxYearFrom("20x6", "2026-10-18")).toBe(2026);
    expect(taxYearFrom(undefined, "2026-02-01")).toBe(2025);
    expect(selectableYears("2026-10-18")[0]).toBe(2026);
  });
});

describe("estimated-payment reminder dates", () => {
  it("are April 15, June 15, September 15 and the next January 15", () => {
    expect(estimatedTaxDates(2026)).toEqual([
      "2026-04-15",
      "2026-06-15",
      "2026-09-15",
      "2027-01-15",
    ]);
  });

  it("finds the next one on or after today", () => {
    expect(nextEstimatedTaxDate("2026-10-18")).toBe("2027-01-15");
    expect(nextEstimatedTaxDate("2026-01-10")).toBe("2026-01-15");
    expect(nextEstimatedTaxDate("2026-06-15")).toBe("2026-06-15");
    expect(nextEstimatedTaxDate("2026-06-16")).toBe("2026-09-15");
  });
});

describe("the pack", () => {
  const transactions = [
    tx({
      date: "2026-02-01",
      merchantName: "American Red Cross",
      pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
    }),
    tx({
      date: "2026-09-01",
      description: "RED CROSS",
      pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
    }),
    // Last year's gift isn't in this year's pack.
    tx({ date: "2025-12-31", pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_DONATIONS" }),
    tx({ amountCents: 2_340, pfcDetailed: "MEDICAL_PHARMACIES_AND_SUPPLEMENTS" }),
    tx({ amountCents: 18_000, pfcDetailed: "MEDICAL_DENTAL_CARE" }),
    // A refund and a vet bill are left out.
    tx({ amountCents: -1_000, pfcDetailed: "MEDICAL_DENTAL_CARE" }),
    tx({ amountCents: 9_000, pfcDetailed: "MEDICAL_VETERINARY_SERVICES" }),
    tx({ amountCents: 60_000, pfcDetailed: "GENERAL_SERVICES_CHILDCARE" }),
    tx({ amountCents: 12_000, pfcDetailed: "GENERAL_SERVICES_EDUCATION" }),
    tx({ date: "2026-02-15", amountCents: -100_000, pfcDetailed: "INCOME_CONTRACTOR" }),
    tx({ date: "2026-03-31", amountCents: -25_000, pfcDetailed: "INCOME_GIG_ECONOMY" }),
    tx({ date: "2026-11-02", amountCents: -40_000, pfcDetailed: "INCOME_CONTRACTOR" }),
    // A salary isn't contracting income.
    tx({ amountCents: -300_000, pfcDetailed: "INCOME_SALARY" }),
    tx({ amountCents: 4_000, pfcDetailed: "FOOD_AND_DRINK_GROCERIES" }),
  ];
  const loans = [
    { name: "Home loan", kind: "mortgage", ytdInterestPaidCents: 1_023_040 },
    { name: "Student loan", kind: "student", ytdInterestPaidCents: 80_550 },
    { name: "Card", kind: "credit", ytdInterestPaidCents: 30_000 },
    { name: "Car loan", kind: "loan", ytdInterestPaidCents: 105_075 },
  ];
  const pack = buildTaxPack({ year: 2026, today: "2026-12-01", transactions, loans });

  it("lists charity gifts by date with the payee and a total", () => {
    expect(pack.charity.rows.map((r) => [r.date, r.payee])).toEqual([
      ["2026-02-01", "American Red Cross"],
      ["2026-09-01", "RED CROSS"],
    ]);
    expect(pack.charity.totalCents).toBe(10_000);
  });

  it("totals medical, childcare and education spending", () => {
    expect(pack.preparer.medical.totalCents).toBe(20_340);
    expect(pack.preparer.medical.rows).toHaveLength(2);
    expect(pack.preparer.childcare.totalCents).toBe(60_000);
    expect(pack.preparer.education.totalCents).toBe(12_000);
  });

  it("shows student loan and mortgage interest for this year only", () => {
    expect(pack.interest).toEqual([
      { name: "Home loan", kind: "mortgage", cents: 1_023_040 },
      { name: "Student loan", kind: "student", cents: 80_550 },
    ]);
    const lastYear = buildTaxPack({ year: 2025, today: "2026-03-01", transactions, loans });
    expect(lastYear.interest).toBeNull();
    expect(lastYear.charity.totalCents).toBe(5_000);
  });

  it("totals contracting and gig income by quarter", () => {
    expect(pack.income.quarterCents).toEqual([125_000, 0, 0, 40_000]);
    expect(pack.income.totalCents).toBe(165_000);
    expect(pack.reminders).toEqual(estimatedTaxDates(2026));
  });

  it("downloads one CSV row per transaction with its group, then the summary", () => {
    const lines = taxPackCsv(pack).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Group,Date,Payee,Amount,Note");
    expect(lines).toContain("Charity,2026-02-01,American Red Cross,50.00,Tagged by Jane");
    expect(lines).toContain("Medical,2026-03-10,SOMETHING,180.00,Tagged by Jane");
    // Education is tagged, but Jane asks about it.
    expect(lines).toContain("Education,2026-03-10,SOMETHING,120.00,Tagged by Jane: check it");
    expect(lines).toContain("Income from contracting or gig work,2026-11-02,SOMETHING,400.00,");
    expect(lines).toContain("Summary,,Medical: total,203.40,");
    expect(lines).toHaveLength(1 + 2 + 2 + 1 + 1 + 3 + 7);
  });
});

describe("the pack follows the tax tags (spec step 119)", () => {
  const gift = tx({
    id: "gift",
    merchantName: "Red Cross",
    pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
  });
  const pens = tx({ id: "pens", merchantName: "Staples", amountCents: 1_250 });
  const course = tx({
    id: "course",
    merchantName: "MasterClass",
    amountCents: 12_000,
    pfcDetailed: "GENERAL_SERVICES_EDUCATION",
  });
  const pack = buildTaxPack({
    year: 2026,
    today: "2026-12-01",
    loans: [],
    transactions: [gift, pens, course],
    overrides: {
      byTransaction: new Map([["gift", "none"]]),
      byMerchant: new Map([
        ["staples", "work"],
        ["masterclass", "education"],
      ]),
    },
    forms: [
      {
        key: "w2:acme",
        formKey: "w2",
        form: "W-2",
        from: "ACME",
        what: "wages",
        by: "2027-01-31",
        amountCents: 100,
        mayNotSend: false,
        received: false,
      },
    ],
  });

  it("matches the tags: untagged gifts are out, the person's work tag is in", () => {
    expect(pack.charity.rows).toEqual([]);
    expect(pack.preparer.work.rows).toEqual([
      { id: "pens", date: "2026-03-10", payee: "Staples", amountCents: 1_250, source: "yours" },
    ]);
    expect(pack.preparer.education.rows[0].source).toBe("yours");
  });

  it("lists the forms to expect in the spreadsheet", () => {
    const lines = taxPackCsv(pack).trimEnd().split("\r\n");
    expect(lines).toContain("Work expenses,2026-03-10,Staples,12.50,Tagged by you");
    expect(lines).toContain("Summary,,Work expenses: total,12.50,");
    expect(lines[lines.length - 1]).toBe("Tax forms to expect,2027-01-31,W-2 from ACME,,Waiting");
  });
});

describe("CSV cells", () => {
  it("quotes formula-looking cells so a spreadsheet won't run them", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("Red Cross")).toBe("Red Cross");
  });

  it("wraps commas, quotes and line breaks", () => {
    expect(csvCell('Dr "Smile", DDS')).toBe('"Dr ""Smile"", DDS"');
    expect(csvCell("=1,2")).toBe('"\'=1,2"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("escapes a payee in the download", () => {
    const evil = buildTaxPack({
      year: 2026,
      today: "2026-12-01",
      loans: [],
      transactions: [
        tx({
          merchantName: "=cmd|' /C calc'!A0",
          pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
        }),
      ],
    });
    expect(taxPackCsv(evil)).toContain("Charity,2026-03-10,'=cmd|' /C calc'!A0,50.00");
  });
});
