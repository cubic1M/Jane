// Where the figures of a coming tax year come from, and when each source usually appears
// (Tax T32, roadmap 1.11). docs/tax/law-change.md is the yearly checklist built on this list; a
// test keeps the two in step, so a source can't be on one and missing from the other.
//
// A window is general knowledge unless `seen` says when it was read at the source. Read them again
// each year and put the new dates in `seen`.

export type WatchSource = {
  // Names the source in the checklist, the notes and the report.
  key: string;
  what: string;
  // The page to open: a stable one, so it still works next year.
  url: string;
  // When it usually appears (general knowledge unless `seen` has an entry).
  window: string;
  // The parameter groups (keys of FederalParams, src/config/tax-params/types.ts) it feeds.
  feeds: readonly string[];
  // What was read at the source: "<year>: what, on what day".
  seen?: readonly string[];
};

export const TAX_YEAR_SOURCES = [
  {
    key: "inflation_rev_proc",
    what: "The Revenue Procedure with the inflation-adjusted amounts for the coming year, and the news release that announces it",
    url: "https://www.irs.gov/newsroom",
    window: "October to early November",
    feeds: [
      "brackets",
      "capitalGains",
      "standardDeduction",
      "additionalStandard",
      "dependentStandard",
      "withholding",
      "ctc",
      "eitc",
      "qbi",
      "amt",
      "studentLoanInterest",
    ],
    seen: ["2027: Rev. Proc. 2026-35, news release IR-2026-133, 2026-11-05"],
  },
  {
    key: "pub_15t",
    what: "Publication 15-T: the withholding adjustment and the percentage-method tables for the coming year (an early draft is posted at the IRS drafts page first; it is not the final)",
    url: "https://www.irs.gov/publications/p15t",
    window: "December of the year before, usually",
    feeds: ["withholding"],
    seen: [
      "2027: the final is not out (the page says For use in 2026); the early draft p15t--dft.pdf, read 2026-11-27, still carries 2026's $8,600 and $7,500 band (16,100), not the 2027 standard deduction of 16,600, so it is not used",
    ],
  },
  {
    key: "retirement_notice",
    what: "The notice with the coming year's retirement plan and IRA limits, the Roth catch-up wage threshold and the saver's credit limits",
    url: "https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions",
    window: "late October to mid November",
    feeds: ["contributionLimits", "rothCatchUp", "savers"],
    seen: ["2027: Notice 2026-66, news release IR-2026-136, 2026-11-12"],
  },
  {
    key: "hsa_rev_proc",
    what: "The Revenue Procedure with the coming year's Health Savings Account limits",
    url: "https://www.irs.gov/irb",
    window: "spring (May or June of the year before)",
    feeds: ["contributionLimits"],
    seen: ["2027: Rev. Proc. 2026-24, Internal Revenue Bulletin 2026-25, 2026-06-15"],
  },
  {
    key: "ss_wage_base",
    what: "The Social Security contribution and benefit base (the wage base for self-employment tax)",
    url: "https://www.ssa.gov/oact/cola/cbb.html",
    window: "mid October, with the cost-of-living announcement",
    feeds: ["selfEmployment"],
    seen: ["2027: $192,300, press release of 2026-10-14"],
  },
  {
    key: "mileage_notice",
    what: "The standard mileage rates for the coming year (and any mid-year change)",
    url: "https://www.irs.gov/tax-professionals/standard-mileage-rates",
    window: "December, a notice and a news release",
    feeds: ["mileage"],
    seen: ["2027: not published on 2026-11-27 (the page ends at the July 2026 rate)"],
  },
  {
    key: "draft_forms",
    what: "The IRS drafts of the coming year's forms and instructions (Form 1040 series, 2441, 8863, 8880)",
    url: "https://www.irs.gov/draft-tax-forms",
    window: "late summer to December; the final instructions follow in January",
    feeds: ["dependentCare", "education", "savers"],
  },
  {
    key: "final_instructions",
    what: "The final Form 1040 instructions, Tax Table and EIC table: the second reading of every figure",
    url: "https://www.irs.gov/forms-instructions",
    window: "January",
    feeds: ["brackets", "eitc", "standardDeduction", "capitalGains"],
  },
  {
    key: "tax_legislation",
    what: "Any federal tax bill signed into law, and the IRS guidance on it",
    url: "https://www.congress.gov/",
    window: "any time: check after every bill, and read each Code section a figure cites",
    feeds: ["obbba", "salt", "charity", "dependentCare", "ctc", "medical", "education"],
  },
  {
    key: "irs_newsroom",
    what: "The IRS newsroom, for a late or corrected figure",
    url: "https://www.irs.gov/newsroom",
    window: "weekly from October to February, monthly otherwise",
    feeds: [],
  },
  {
    key: "ftb_tables",
    what: "The California Franchise Tax Board's tables for the coming year (brackets, standard deduction, exemption credits)",
    url: "https://www.ftb.ca.gov/forms/",
    window: "late December",
    feeds: [],
  },
  {
    key: "ftb_news",
    what: "The Franchise Tax Board's tax news, for the coming year's California amounts",
    url: "https://www.ftb.ca.gov/about-ftb/newsroom/tax-news/",
    window: "October (the first announcement of the next year's amounts)",
    feeds: [],
  },
  {
    key: "oracle_changelogs",
    what: "The change logs of the outside calculators the bench uses as a cross-check (Tax-Calculator, PolicyEngine)",
    url: "https://github.com/PSLmodels/Tax-Calculator/releases",
    window: "weekly from October to February, monthly otherwise",
    feeds: [],
  },
] as const satisfies readonly WatchSource[];

export type WatchKey = (typeof TAX_YEAR_SOURCES)[number]["key"];
