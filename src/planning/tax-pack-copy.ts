// Every sentence the tax-time pack and its reminder alert show (spec step 72). Static, never
// from Claude. Organizing only: tax-pack-copy.test.ts checks no sentence says what counts,
// what's allowed or what to do, and that the disclaimer is there.

export const TAX_PACK_COPY = {
  title: "Tax-time pack",
  intro:
    "Your charity gifts, some spending and any contracting or gig income for the year, gathered in one place to hand to whoever does your taxes.",
  disclaimer:
    "Spending people often show their tax preparer. Jane doesn't know your tax situation; this is not tax advice.",
  notAdvice:
    "Jane gathers these from your accounts. It doesn't know your tax situation; this is not tax advice.",
  charityHeading: "Charity",
  charityEmpty: "No donations found for this year.",
  preparerHeading: "Spending you may want to show your tax preparer",
  groupLabels: {
    medical: "Medical",
    childcare: "Childcare",
    education: "Education",
    // Spec step 119: tagged by the person.
    work: "Work expenses",
    // Spec step 123.
    business: "Business expenses",
    // Spec step 173.
    rental: "Rental expenses",
  },
  groupEmpty: "None found for this year.",
  interestHeading: "Interest paid on loans",
  interestNote: "As your lender reports it for this year so far.",
  interestPastYear:
    "Your bank reports loan interest for the current year only. Your lender's year-end statement has the full amount for past years.",
  interestEmpty: "No student loan or mortgage interest reported.",
  incomeHeading: "Income from contracting or gig work",
  incomeEmpty: "No contracting or gig income found for this year.",
  remindersHeading: "IRS estimated-payment dates",
  remindersNote:
    "These are reminders of the usual dates only. Dates can move for weekends and holidays; irs.gov has the exact ones and explains who pays.",
  irsLinkLabel: "Estimated payments on irs.gov",
  downloadLabel: "Download as CSV",
  totalLabel: "Total",
  dateLabel: "Date",
  payeeLabel: "Payee",
  amountLabel: "Amount",
  yearsLabel: "Years",
  lifeEventsPrompt: "Getting ready for a big change instead?",
  lifeEventsLink: "Life-event checklists",
  incomplete:
    "This only includes what's in the accounts you've added. Receipts and statements are the source of truth.",
  // Spec step 119: the summary, the tags and the forms to expect.
  summaryHeading: "Summary",
  tagsNote: "Gathered from your tax tags. Change any tag and the pack follows.",
  tagsLink: "See and change your tax tags",
  checkNote: "Tagged by Jane: check it",
  formsHeading: "Tax forms to expect",
  formsEmpty: "No forms expected from what's in your accounts.",
  formsNote:
    "From the payers and lenders in your accounts. Usual dates; each payer sends its own form.",
  formReceived: "Received",
  formWaiting: "Waiting",
  formMayNotSend: "May not send one: below the reporting threshold",
  noteLabel: "Note",
  // Spec step 165: the states (and city) the year's income was taxed in.
  // Spec step 173.
  rentalHeading: "Rental property",
  rentalNote: "Rent in, the expenses you tagged, and depreciation on the building.",
  statesHeading: "States you lived or worked in",
  statesNote:
    "From your tax profile. Each state's tax agency, linked, is where its figures come from.",
  statesEmpty: "No state on your tax profile yet.",
  statesAllYear: "All year",
  statesNonresident: "Employer's state (you lived elsewhere)",
  statesLocal: "City income tax",
} as const;

export const QUARTER_LABELS = [
  "January to March",
  "April to June",
  "July to September",
  "October to December",
] as const;

// The alert raised before each estimated-payment date, for people with contracting or gig
// income.
export function estimatedTaxAlertCopy(dateLabel: string): { title: string; body: string } {
  return {
    title: `IRS estimated-payment date: ${dateLabel}`,
    body: `You've had contracting or gig income, so here's a reminder that ${dateLabel} is an IRS estimated-payment date. Your tax-time pack has your income by quarter. Jane doesn't know your tax situation; this is not tax advice.`,
  };
}

export function allTaxPackCopy(): string[] {
  const { groupLabels, ...rest } = TAX_PACK_COPY;
  const alert = estimatedTaxAlertCopy("Jan 15");
  return [
    ...Object.values(rest),
    ...Object.values(groupLabels),
    ...QUARTER_LABELS,
    alert.title,
    alert.body,
  ];
}
