import type Anthropic from "@anthropic-ai/sdk";
import { TAX_TAG_ORDER } from "@/config/tax";
import { DECISION_TOPICS } from "@/config/tax-decisions";
import { noInput } from "@/lib/ask/tools";

// Claude's tax tools in Jane's chat (spec steps 118–127): read-only, over the person's own
// data, through the same loaders as /taxes. Every dollar figure is recorded for the
// guardrails, like the other chat tools (./claude-tools.ts).

export const TAX_TOOLS: Anthropic.Tool[] = [
  {
    name: "tax_profile",
    description:
      "The person's tax profile: how they file, dependants, the state they file in and their kinds of income, each marked as told by the person, found by Jane from their accounts (not yet checked) or not set; where Jane saw each kind of income and how much came in over the last year; and what Jane does about taxes on its own at their autopilot level.",
    input_schema: noInput,
  },
  {
    name: "tax_tags",
    description:
      "Spending tagged for the person's taxes this tax year (donations, medical, childcare, education, work expenses): each tag's total and count, and, for one tag, its transactions with date, payee, amount and who tagged it (the person, Jane, or Jane but unsure). Tags never change spending categories or totals.",
    input_schema: {
      type: "object",
      properties: {
        tag: {
          type: "string",
          enum: [...TAX_TAG_ORDER],
          description: "Optional: list this tag's transactions.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "tax_estimate",
    description:
      "Jane's estimate of the person's federal and state tax for the tax year, from their income so far projected to the year's end, their pay stubs and their tax profile: income, adjustments, AGI, the deduction (standard or itemized, with its parts), taxable income, income tax, other taxes, credits, total tax, what's been withheld and paid, and the refund or amount owed; the state's the same way. Every figure is an estimate; also lists what Jane assumed. Say figures as estimates.",
    input_schema: noInput,
  },
  {
    name: "tax_withholding",
    description:
      "Whether the person's federal withholding is on course for the tax Jane estimates: on track, a big refund coming, or a bill coming, with the estimated refund or amount owed and paychecks left this year. In demo advice mode only, also what to put on a new W-4 (Step 4(b) deductions or Step 4(c) extra withholding) for the rest of the year and from January, and what each does to a paycheck. Jane never sends a W-4; the person does.",
    input_schema: noInput,
  },
  {
    name: "tax_savings",
    description:
      "Demo advice mode only: ways for the person to pay less tax this year that Jane found in their accounts (retirement contributions, IRA, HSA and FSA room, itemizing, bunching gifts, student loan interest, education and energy credits, dependent care), each with why, an estimated yearly saving and what to do. Outside demo advice mode it says it isn't available. Say every saving as an estimate.",
    input_schema: noInput,
  },
  {
    name: "tax_self_employed",
    description:
      "Freelance and gig taxes: freelance money in this year, business expenses tagged, the home office and business miles and what they take off, and in demo advice mode the share of each payment to set aside and the estimated tax payments left this year (dates and amounts that add up to what the estimate says is still owed). Say amounts as estimates.",
    input_schema: noInput,
  },
  {
    name: "tax_refunds",
    description:
      "Tax refunds seen in the person's accounts in the last year: federal or state, amount, date, the tax year, how it compares with Jane's estimate for that year, whether its plan was set up, and in demo advice mode only where it could go (emergency fund, high-rate debt, goals behind).",
    input_schema: noInput,
  },
  {
    name: "tax_return",
    description:
      "Filing the person's tax return through the filing partner: the year being filed, whether it's filing season, whether filing through Jane is available for them, and the return's status (ready to review, submitted, accepted) with its federal refund or amount owed. Jane can start a return; only the person can sign and file it, on /taxes/file.",
    input_schema: noInput,
  },
  {
    name: "tax_investments",
    description:
      "Gains and losses in the person's taxable investment accounts for the tax year, from the cost basis their broker reports: realised (sold) and unrealised, each short- and long-term, sales that were wash sales and how much loss that disallowed; in demo advice mode also losses worth harvesting (with the wash-sale risk) and holdings better kept in a 401(k) or IRA. Retirement accounts aren't taxed on gains.",
    input_schema: noInput,
  },
  {
    name: "tax_states",
    description:
      "The person's state and local income taxes for the tax year: each state that taxes some of their income (lived there all year, part of the year after a move, or as a nonresident for an employer in a state that taxes remote work), the dates lived there, the income it taxes, the tax after any credit for tax paid to another state, its tax agency and web address (the source of its figures), and whether its rate is rough; the city or county income tax; the moves Jane counted (told by the person, or spotted by Jane in payments to state agencies and not yet checked) and the employer's state. Every figure is an estimate.",
    input_schema: noInput,
  },
  {
    name: "tax_plan",
    description:
      "The person's year-round tax plan for the tax year: each tax move that applies (workplace plan and IRA or HSA contributions, open enrollment, estimated payments, selling at a loss before year-end, gifts before December 31, a W-4 check after a new job or baby, filing), each with its deadline, when Jane brings it up, what it'd put on their deadlines, and whether it's there already or they said no. Moves past their deadline aren't included. Contribution, sale and gift moves are demo advice.",
    input_schema: noInput,
  },
  {
    name: "tax_giving",
    description:
      "The person's gifts to charity this tax year (tagged as donations): each gift's date, charity and amount, whether it needs the charity's written receipt (gifts of $250 or more) and whether they have it; their donor-advised fund if they opened one; and in demo advice mode the options that do more good for the same money (bunching two years of gifts, a donor-advised fund, giving long-held shares instead of cash), each with the federal tax with and without it. Say the option figures are estimates and demo advice.",
    input_schema: noInput,
  },
  {
    name: "tax_family",
    description:
      "Demo advice only: the person's family tax choices for the tax year, each with both sides' federal tax and whether each side is open to them (with the eligibility rules): claiming their children, a dependent care FSA or the care credit, the American Opportunity or Lifetime Learning credit, a 529's state tax break, and married filing jointly or separately (or head of household or single); plus what Jane assumed. Choosing is the person's.",
    input_schema: noInput,
  },
  {
    name: "tax_home",
    description:
      "What the person's home changes at tax time for the tax year, each figure with where it came from (transactions, the lender's 1098 or loan, or their answers): mortgage interest (on up to the debt limit), property tax paid, the state and local tax cap applied to state income tax and property tax (total, cap, what counts, what doesn't), points, the home office, energy credits from work paid for, and a home sale's gain against the exclusion (with whether it qualifies and why).",
    input_schema: noInput,
  },
  {
    name: "tax_records",
    description:
      "The person's audit-ready records for a tax year: every deduction and credit Jane counts (donations, medical, childcare, education, business, mortgage interest, property tax, energy, student loan interest, home office, miles), each with the transactions, receipts in their document vault, collected forms and answers that support it and what's still needed (for example a charity's receipt for a gift of $250 or more); amounts counted with no source yet (not in the pack); and how long to keep each year's records and when they can be thrown away. Jane never deletes records.",
    input_schema: noInput,
  },
  {
    name: "tax_last_return",
    description:
      "Prior-year returns the person uploaded and confirmed, and in demo advice mode what a review against their accounts found for each: money left behind (itemizing instead of the standard deduction, student loan interest, an education credit, the child and dependent care credit) with the federal tax each would have saved, the last day to amend, whether an amended return is worth preparing, and the state of any amended return (ready for them to review and sign, submitted, accepted). Returns not confirmed aren't used. Amending needs the person's review and signature.",
    input_schema: noInput,
  },
  {
    name: "tax_side_income",
    description:
      "The person's side income for the tax year: a rental (rent in, expenses they tagged, depreciation on the building over 27.5 years, the net, how much of a loss counts under the passive loss allowance and how much carries forward); each gig platform's payouts matched to its 1099 (matched, differs, waiting for the form); whether they treat the income as a business or a hobby; and in demo advice mode the federal tax both ways. All of it is in the estimate, quarterly amounts and tax-time pack.",
    input_schema: noInput,
  },
  {
    name: "tax_notices",
    description:
      "Letters from the IRS or the state the person uploaded: which notice each is (CP2000, CP14, CP501, CP503, CP504, a state notice), what it means in plain words, the amount and the date to respond or pay by, what Jane found against the person's own records (forms collected, income in their accounts, payments seen), in demo advice mode which reply that points to (agree, pay or disagree), and whether a reply is drafted or handed over. Notices not confirmed aren't used. Nothing is paid or sent without the person's tap.",
    input_schema: noInput,
  },
  {
    name: "tax_identity",
    description:
      "The person's tax identity protection: whether they have an IRS Identity Protection PIN for the year and whether Jane put the January reminder on their deadlines; any sign of tax identity theft Jane noticed (a rejected return, a letter that reads like one) or that they reported; and an open case's steps in order (report to the FTC, Form 14039, credit freeze, call the IRS, paper return if the e-file was rejected, IP PIN) with which are done. The steps are the person's own: Jane never contacts the IRS or a bureau.",
    input_schema: noInput,
  },
  {
    name: "tax_equity",
    description:
      "The tax on the person's crypto and equity pay for the tax year: crypto sold (proceeds, cost by lot, short- and long-term gain), what they hold and its unrealised gain, the 1099-DA from an exchange that sold; ESPP sales and whether each was qualifying or a disqualifying disposition that lost its special treatment; ISOs exercised and the alternative minimum tax; RSU vests with the tax withheld against their real rate and the shortfall; and in demo advice mode how much to set aside and whether a goal exists. Holding-period and AMT rules are in config with sources. For RSUs, rsuAnswer is the finished statement of the withholding gap: say it in 2–3 sentences, don't work it out and don't list every detail.",
    input_schema: noInput,
  },
  {
    name: "tax_years",
    description:
      "The person's federal tax projected over the next years: each year's income, tax and top rate (the first is their estimate, the rest assume pay grows until the retirement year they gave, or one Jane assumed, and that the brackets rise with inflation), the total over the years; and in demo advice mode the moves that save tax over the years (a Roth conversion in a low-income year, realising gains in the 0% bracket, bunching charity into alternate years, timing a planned bonus, sale or withdrawal), each with the tax it saves in all. Jane moves no money; a move can be put on the person's deadlines.",
    input_schema: noInput,
  },
  {
    name: "tax_property",
    description:
      "The person's property tax check: their home's assessed value against its market value (their own figures, or sample data), how far over it is and what that costs a year, the county's appeal window and deadline, and in demo advice mode whether an appeal is worth making, the comparable sales behind a drafted appeal, who files it, and exemptions (homestead, senior, veteran, disabled) they may not have claimed with what each does. Jane files and applies for nothing itself.",
    input_schema: noInput,
  },
  {
    name: "tax_accountant",
    description:
      "Where working with an accountant stands: whether the person's taxes include things people usually bring an accountant to (self-employment, rental income, stock options or crypto, income in more than one state, a home sale, an open IRS letter, a tax identity problem, large gains), their read-only accountant links (live, expired or revoked, how many times each was opened), the questions Jane has for an accountant, and the answers that came back. A link shows only tax information, ends on a date the person picks, can be revoked, and every view is logged. Jane never sends a link itself: the person makes and shares it.",
    input_schema: noInput,
  },
  {
    name: "tax_calendar",
    description:
      "The person's tax calendar for this month and the year: what Jane does each month (the January IRS Identity Protection PIN reminder and form chase, estimated payments paid through the payment stand-in a few days before they are due when they fit the person's cap for taxes, the June withholding check, December's year-end moves in one message, filing day and the refund tracked), where each item stands now (done, needs the person's tap, coming, nothing to do), any estimated payment that needs a tap and why (over the cap, over the monthly cap, or the person asked Jane to ask first), and the year-end moves. Nothing is paid above the cap without a tap; signing and filing a return are always the person's.",
    input_schema: noInput,
  },
  {
    name: "tax_business",
    description:
      "A business owner's tax structure: profit from self-employment so far this year (projected), the qualified business income deduction they get as a sole proprietor and what it saves, their federal tax as they are, and in demo advice mode whether an S corporation would save more than its payroll tax and filing costs at their profit (with a salary range to start from), plus the home office deduction and business miles on file. A tax professional confirms and files any election; Jane files nothing.",
    input_schema: noInput,
  },
  {
    name: "tax_inherited",
    description:
      "Inherited money and gifts: an inherited IRA the person has (found by the account's name) with the year it must be empty by under the 10-year rule (from the year they told Jane the owner died; spouses can treat it as their own), the exceptions, and in demo advice mode how much tax taking it out evenly saves against taking it all at the end; gifts to one person this year over the annual exclusion that need a gift tax return (Form 709); the step-up in basis on inherited assets; and the federal and state estate tax facts. Facts only, with a pointer to a tax professional or estate lawyer: Jane gives no legal advice.",
    input_schema: noInput,
  },
  {
    name: "tax_health",
    description:
      "The tax side of the person's health cover. A Marketplace plan's premium tax credit checked against their income this year, month by month so a mid-year rise shows (projected income, share of the poverty line, over the 400% line where the credit stops or not, the credit allowed, the advance credit (told, or worked out from their income early in the year) and what would be repaid with the return, with no cap from 2026); HSA deposits this year and at this pace by December against the limit for their cover, with what's over and the 6% penalty each year it stays in; and medical costs and health premiums against the 7.5% of income floor and the standard deduction, with what itemizing would save. Telling the Marketplace or an HSA provider is the person's: Jane contacts no one. What to do about the credit is demo advice.",
    input_schema: noInput,
  },
  {
    name: "tax_disaster",
    description:
      "Disaster relief and losses for the person: the county they live in (told, or named by their property tax payee), any IRS disaster postponement covering it from their disaster feed (only a stand-in with sample declarations for demo-bank people; none for real accounts yet), what it covers (from the incident date, deadlines move to the postponed date: estimated payments, filing and paying, prior-year IRA and HSA contributions) and whether Jane has moved the tax deadlines on their list; repairs since the disaster, what insurance or FEMA paid back, and the casualty loss after the $100 floor and 10% of income (Form 4684), kept once with the insurance claim. Facts only; Jane files nothing.",
    input_schema: noInput,
  },
  {
    name: "tax_retirement",
    description:
      "Taxes on the person's retirement income: their Social Security for a year (from its deposits), other income (pension, IRA withdrawals, wages), provisional income and how much of the benefit is taxable (0, up to 50% or up to 85%), the tax on it that nothing withholds unless they file Form W-4V, and the rate on their next IRA dollar once Social Security's taxable part growing with it is counted; Medicare's income surcharge (IRMAA): this year's income sets the premiums two years ahead, the tier, the next line (estimated past the published years) and the room to it, and what crossing it adds a year; and, in demo advice mode, the order to draw from accounts tuned to stay under the line (pre-tax up to a cap, then taxable, then Roth), which the retirement paycheck uses. Jane moves no money and changes no withholding.",
    input_schema: noInput,
  },
  {
    name: "tax_draft_check",
    description:
      "The person's draft tax returns (uploaded to Documents as a draft before filing): what Jane read off each (line by line, waiting for the person to confirm, or confirmed), and for a confirmed draft what its check against their collected forms, accounts and estimate found: income missing (interest, dividends, capital gains, business income, wages lower than the W-2), deductions or credits left out (student loan interest, itemizing, education and care credits, estimated payments), figures that don't match the forms (withholding), each with its line and the federal tax it changes (more tax owed, or money back). Jane never files or changes the draft.",
    input_schema: noInput,
  },
  {
    name: "tax_decide",
    description:
      "A direct answer, in three sentences or fewer from the person's own numbers, to one of the tax questions people ask: whether to itemize, do a Roth conversion, change their withholding, pay estimated taxes, put more in their 401(k), pick a traditional or Roth IRA, open an HSA, appeal their property tax, sell a loser for the loss, give stock instead of cash, or claim a home office; and the facts: what they will owe or get back, why their refund is what it is, their effective rate, tax paid so far, what they can deduct, how much to set aside, when the next estimated payment is due, whether they must file, and their mortgage interest deduction. Decisions are demo advice and carry the label; for a real account the answer says what the numbers are, not what to do. Start with the verdict in words; offer no button unless they asked you to do something; for any amount these sentences don't give, use the calculate tool. Pass the topic.",
    input_schema: {
      type: "object" as const,
      properties: { topic: { type: "string" as const, enum: [...DECISION_TOPICS] } },
      required: ["topic"],
      additionalProperties: false,
    },
  },
  {
    name: "tax_forms",
    description:
      "The tax forms Jane expects for the tax year from the person's payers and lenders (W-2, 1099s, 1098s): each form, who sends it, the usual date it's sent by, whether the person has it, and whether the payer may not send one because the amount is under the reporting threshold; and the ones Jane collected from the document partner, with whether each matches the person's accounts (a form that doesn't match is flagged and not used until the person says it's right).",
    input_schema: noInput,
  },
];

export const isTaxTool = (name: string) => TAX_TOOLS.some((t) => t.name === name);
