// What a real account reads about what Jane does in the read-only beta
// (CONCIERGE_ACTIONS.realAccounts): Jane reads and tells, the person acts. The area pages and the
// chat's tools both say this, in place of the autopilot words a concierge account gets.

export const READ_ONLY_TAXES = {
  title: "What Jane does with your taxes",
  lines: [
    "Jane keeps your tax estimate up to date from your accounts and tags donations, medical, childcare and education spending.",
    "Each month it tells you what is due, and it keeps your year's records ready as a tax-time pack.",
    "You file, sign and pay yourself; Jane gives you the steps.",
  ],
};

export const READ_ONLY_TAX_CALENDAR =
  "Jane tells you what is due each month of the tax year; you do each one yourself.";

const INSURANCE_LIMIT =
  "It doesn't buy, change or cancel insurance or call an insurer; it gives you the steps and drafts to do that yourself.";

export const READ_ONLY_INSURANCE = {
  title: "How Jane handles insurance",
  limit: INSURANCE_LIMIT,
  body: `Jane reads your policy documents and adds each one once you confirm what Jane read. ${INSURANCE_LIMIT}`,
};

export const READ_ONLY_INVESTMENTS = {
  title: "What Jane does with your investments",
  lines: [
    "Jane reads your holdings and fees from your accounts and shows you where they stand.",
    "It doesn't trade or move money, and it doesn't say what to buy or sell; those choices and steps are yours.",
  ],
};
