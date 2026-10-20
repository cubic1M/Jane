// Audit-ready records (spec step 171): how long to keep what, FOR REVIEW. From the IRS's
// "How long should I keep records?" (irs.gov/businesses/small-businesses-self-employed/
// how-long-should-i-keep-records): keep records that support a return for 3 years from
// the date it was filed (or the due date, if later); 6 years if you left out more than
// 25% of your income; 7 years for a loss from worthless securities or a bad debt; records
// for property (a home, shares) until the period of limitations for the year you sell it
// ends. Jane never deletes anything: she reminds, and the person decides.

export type RetentionKey = "return" | "property";

export const RETENTION: Readonly<
  Record<RetentionKey, { label: string; years: number; rule: string }>
> = {
  return: {
    label: "Records behind a return's deductions, credits and income",
    years: 3,
    rule: "3 years after the return was due or filed, whichever is later.",
  },
  property: {
    label: "Records of a home or investments you bought",
    years: 3,
    rule: "Until 3 years after the return that reports the sale.",
  },
};

// Which kind of record each audit-pack item is.
export const ITEM_RETENTION: Readonly<Record<string, RetentionKey>> = {
  charity: "return",
  medical: "return",
  childcare: "return",
  education: "return",
  business: "return",
  rental: "property",
  property_tax: "return",
  mortgage_interest: "property",
  student_loan_interest: "return",
  energy: "property",
  home_office: "return",
  mileage: "return",
};

// A receipt in the vault counts for a transaction when its date is within this many days
// and its amount is the same.
export const RECEIPT_MATCH_DAYS = 3;

// Jane brings up records that can be thrown away this many days ahead, and puts a reminder
// on the deadlines then.
export const RETENTION_REMIND_DAYS = 30;

// How many tax years back the retention schedule looks.
export const RETENTION_YEARS_BACK = 8;
