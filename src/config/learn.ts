import { CONTRIBUTION_LIMITS, STANDARD_DEDUCTION, TAX_RATES_YEAR } from "@/config/tax-rates";

// Learn (spec step 136): short, fixed explainers in plain words, one tap from Jane's answers
// and cards. Education, not advice: none says what this person should do, none promises an
// outcome, and every figure comes from the app's own config. Each is marked with its review:
// all are waiting for counsel's review before anyone relies on them, and the page says so.

export type ReviewStatus = "awaiting_counsel" | "reviewed";

export type Explainer = {
  slug: string;
  title: string;
  // One sentence, used in answers and link previews.
  summary: string;
  paragraphs: string[];
  sources: string[];
  review: { status: ReviewStatus; writtenOn: string; reviewedBy: string | null };
};

const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

const AWAITING = { status: "awaiting_counsel" as const, writtenOn: "2026-10-19", reviewedBy: null };

export const EXPLAINERS: readonly Explainer[] = [
  {
    slug: "index-funds",
    title: "Index funds",
    summary:
      "An index fund owns every company in a market list, so it follows that market instead of trying to beat it.",
    paragraphs: [
      "An index is a list of companies, like the biggest 500 in the US or every company on a stock market. An index fund simply buys everything on its list, in proportion to each company's size.",
      "Because nobody is paid to pick winners, index funds usually cost very little each year. Actively managed funds pay people to choose, which costs more, and most of them end up behind their index over long periods after those costs.",
      "One broad index fund can hold thousands of companies, so a bad year for any one of them barely moves it. It still goes up and down with the whole market.",
    ],
    sources: [
      "SEC Investor.gov: Index funds",
      "S&P Dow Jones Indices, SPIVA scorecards (how active funds compare with their index)",
    ],
    review: AWAITING,
  },
  {
    slug: "fees",
    title: "What investing fees cost",
    summary:
      "A fund's expense ratio is the share of your money it charges every year, and over decades even small differences add up.",
    paragraphs: [
      "Every fund charges a yearly fee called the expense ratio, taken from the fund's value, so you never see a bill. A 1% expense ratio on $10,000 is about $100 a year; 0.05% is about $5.",
      "The fee also takes away the growth that money would have earned, every year. That's why Jane shows fees over 30 years as well as this year: the gap between a cheap fund and an expensive one keeps widening.",
      "Some accounts add an advisory fee or an account fee on top. Jane adds these up from your account's own fee records.",
    ],
    sources: ["SEC Investor.gov: How fees and expenses affect your investment portfolio"],
    review: AWAITING,
  },
  {
    slug: "the-match",
    title: "The employer match",
    summary:
      "Many employers add money to your 401(k) when you put money in, up to a limit: if you put in less, that money is left unclaimed.",
    paragraphs: [
      "A common match is 50 cents for every dollar you put in, on up to 6% of your pay. Put in 6% and your employer adds 3%. Put in 4% and they add 2%: the other 1% of your pay is money they would have given you.",
      "The match goes into your 401(k) on top of your pay. Some plans make you stay a while before the employer's part is fully yours; your plan's documents say how long.",
      `What you put in from your pay has a yearly limit, ${dollars(CONTRIBUTION_LIMITS.workplace)} in ${TAX_RATES_YEAR}, with more allowed from age 50.`,
    ],
    sources: ["IRS: 401(k) plan overview", "Your employer plan's summary plan description"],
    review: AWAITING,
  },
  {
    slug: "roth-vs-traditional",
    title: "Roth or traditional",
    summary:
      "Traditional accounts take the tax off now and tax the money when it comes out; Roth accounts tax it now and let it come out tax-free.",
    paragraphs: [
      "With a traditional 401(k) or IRA, what you put in lowers this year's taxable income, and you pay income tax when you take it out in retirement.",
      "With a Roth, you pay the tax now, and the money (including what it grew to) comes out tax-free in retirement, if you follow the rules on age and how long the account has been open.",
      "Which comes out ahead depends mostly on your tax rate now compared with later. A lower rate now tends to favour Roth; a higher rate now tends to favour traditional. Many people use both.",
      `IRAs have their own yearly limit: ${dollars(CONTRIBUTION_LIMITS.ira)} in ${TAX_RATES_YEAR}, with more from age 50. Roth IRAs have income limits.`,
    ],
    sources: [
      "IRS Publication 590-A and 590-B (IRAs)",
      "IRS: Roth comparison chart for 401(k) plans",
    ],
    review: AWAITING,
  },
  {
    slug: "rebalancing",
    title: "Rebalancing",
    summary:
      "Rebalancing means selling some of what grew and buying what lagged, to get back to the mix you chose.",
    paragraphs: [
      "You pick a mix, say 60% stocks and 40% bonds. When stocks rise faster, they become more than 60% of your money, which means more ups and downs than you chose.",
      "Rebalancing sells some of what's grown too big and buys what's too small, so the mix matches what you picked again. It's about the risk you take, not about guessing what goes up next.",
      "In a taxable account, selling something that gained can mean tax, so it often makes sense to rebalance inside retirement accounts or with new money first.",
    ],
    sources: [
      "SEC Investor.gov: Rebalancing your portfolio",
      "FINRA: Asset allocation and diversification",
    ],
    review: AWAITING,
  },
  {
    slug: "refinancing",
    title: "Refinancing",
    summary:
      "Refinancing replaces a loan with a new one, usually to get a lower rate or a different monthly payment.",
    paragraphs: [
      "The new loan pays off the old one, and you then pay the new lender. If the new rate is lower, less of each payment goes to interest.",
      "A longer new loan can lower the monthly payment but cost more interest overall; a shorter one can do the opposite. Fees and closing costs count too: the saving has to be bigger than what the new loan costs to set up.",
      "Refinancing federal student loans into a private loan ends federal protections such as income-driven repayment and forgiveness programs.",
    ],
    sources: [
      "Consumer Financial Protection Bureau: What is refinancing?",
      "Federal Student Aid: Refinancing and consolidation",
    ],
    review: AWAITING,
  },
  {
    slug: "deductibles",
    title: "Deductibles",
    summary:
      "A deductible is what you pay yourself on a claim before your insurance starts paying.",
    paragraphs: [
      "If your car insurance has a $1,000 deductible and a repair costs $3,000, you pay the first $1,000 and the insurer pays the rest.",
      "A higher deductible usually means a lower premium, because you take on more of each claim. It works if you could comfortably pay the deductible from savings if something happened.",
      "Health plans also have deductibles, often per year, plus copays and an out-of-pocket maximum.",
    ],
    sources: [
      "Insurance Information Institute: Understanding deductibles",
      "HealthCare.gov: Deductible",
    ],
    review: AWAITING,
  },
  {
    slug: "standard-deduction",
    title: "The standard deduction",
    summary:
      "The standard deduction is an amount of income you don't pay federal income tax on, without listing your expenses.",
    paragraphs: [
      `For ${TAX_RATES_YEAR} it's ${dollars(STANDARD_DEDUCTION.single)} for a single filer and ${dollars(STANDARD_DEDUCTION.married_joint)} for a married couple filing jointly. It's taken off your income before tax is worked out.`,
      "Instead, you can itemize: add up certain expenses such as mortgage interest, state and local taxes and gifts to charity. People itemize only when that total is bigger than the standard deduction.",
      "Most people take the standard deduction. Jane's tax estimate picks whichever is larger for you.",
    ],
    sources: ["IRS: Standard deduction", "IRS Rev. Proc. 2025-32 (2026 amounts)"],
    review: AWAITING,
  },
];

export const explainer = (slug: string) => EXPLAINERS.find((e) => e.slug === slug) ?? null;

// Which explainer goes with each finding card (src/app/report/[findingId]) and chat topic.
export const FINDING_EXPLAINERS: Readonly<Record<string, string>> = {
  insurance_reshop: "deductibles",
  card_interest: "refinancing",
};

export const REVIEW_NOTE =
  "A plain-language explainer from Jane's team, waiting for review by counsel. It explains how things work; it isn't advice for you.";
