// The tax year that runs itself (spec step 223). FOR REVIEW. The year's tax calendar: what
// Jane does each month, by herself within the sector caps (src/config/autopilot-sectors.ts)
// or by asking for a tap. Dates come from the same config as the rest of taxes
// (ESTIMATED_TAX_DATES, the filing season, the IP PIN season).

export type CalendarKey =
  | "ip_pin"
  | "documents"
  | "estimate"
  | "withholding"
  | "year_end"
  | "filing_day"
  | "refund"
  | "quiet";

export const CALENDAR_ITEMS: Readonly<
  Record<CalendarKey, { title: string; ask: string; auto: string }>
> = {
  ip_pin: {
    title: "IRS Identity Protection PIN",
    ask: "I remind you to get an IP PIN.",
    auto: "I put getting an IP PIN on your deadlines.",
  },
  documents: {
    title: "Tax forms",
    ask: "I look for each form every day and tell you what came in and what didn't match.",
    auto: "I look for each form every day, tick off the ones that match your accounts and chase the missing ones.",
  },
  estimate: {
    title: "Estimated tax payment",
    ask: "When a payment is coming due I ask you to pay it, with a button.",
    auto: "I pay each estimated payment a few days before it is due, if it is within your cap for taxes. Above the cap, you get a button.",
  },
  withholding: {
    title: "Mid-year withholding check",
    ask: "I check your paycheck withholding against your estimate and tell you if it is off.",
    auto: "I check your paycheck withholding against your estimate and tell you if it is off, with the W-4 change ready.",
  },
  year_end: {
    title: "Year-end moves",
    ask: "I send one message with the moves still open before December 31, with a button to put them on your deadlines.",
    auto: "I send one message with the moves still open before December 31 and have already put them on your deadlines.",
  },
  filing_day: {
    title: "Filing",
    ask: "When every form is in, I get your return ready for you to review and sign.",
    auto: "When every form is in, I get your return ready for you to review and sign. The signing and filing are always yours.",
  },
  refund: {
    title: "Your refund",
    ask: "After you file, I track the refund until it lands.",
    auto: "After you file, I track the refund until it lands and match it to my estimate.",
  },
  quiet: {
    title: "Nothing due",
    ask: "Nothing is due. I keep your estimate current.",
    auto: "Nothing is due. I keep your estimate current and watch for anything that changes it.",
  },
};

// The calendar, month by month (1 = January).
export const TAX_CALENDAR: Readonly<Record<number, readonly CalendarKey[]>> = {
  1: ["ip_pin", "documents", "estimate"],
  2: ["documents"],
  3: ["documents", "filing_day"],
  4: ["filing_day", "estimate", "refund"],
  5: ["refund"],
  6: ["withholding", "estimate"],
  7: ["withholding"],
  8: ["quiet"],
  9: ["estimate"],
  10: ["quiet"],
  11: ["quiet"],
  12: ["year_end"],
};

// Jane pays an estimated payment this many days before it is due (and up to PAY_GRACE_DAYS
// after, if it was missed), when it fits the caps; otherwise she asks.
export const ESTIMATE_PAY_LEAD_DAYS = 5;
export const ESTIMATE_PAY_GRACE_DAYS = 30;

// The year-end message goes out from this day of December.
export const YEAR_END_FROM_DAY = 1;
