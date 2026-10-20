// A protected tax identity (spec step 218). FOR REVIEW. Sources: irs.gov "Get An Identity
// Protection PIN (IP PIN)", "Taxpayer Guide to Identity Theft", Form 14039 (Identity Theft
// Affidavit), identitytheft.gov, and each credit bureau's freeze page.

// The IP PIN is a six-digit number for the year's return; the IRS issues a new one every
// January. Jane brings it up from the first of January until the filing deadline.
export const IP_PIN = {
  from: "01-01",
  until: "04-15",
  url: "https://www.irs.gov/identity-theft-fraud-scams/get-an-identity-protection-pin",
  // Who can get one, in a line.
  who: "Anyone with a Social Security number can get one online after verifying their identity.",
  // The reminder goes on the deadlines for this day of January.
  remindOn: "01-31",
} as const;

export type SignKey = "efile_rejected" | "unknown_form" | "irs_letter";

// A sign of tax identity theft, in the person's words, and how Jane learns of it.
export const SIGNS: Readonly<
  Record<SignKey, { title: string; what: string; learnedFrom: string }>
> = {
  efile_rejected: {
    title: "Your return was rejected because one was already filed",
    what: "If the e-file is rejected because a return was already filed with your Social Security number, someone else may have used it.",
    learnedFrom: "your return being rejected through Jane, or you telling me",
  },
  unknown_form: {
    title: "A W-2 or 1099 from a payer you don't know",
    what: "Income reported under your Social Security number by an employer or payer you never worked for can mean someone is using your number.",
    learnedFrom: "you telling me",
  },
  irs_letter: {
    title: "An IRS letter about a return you didn't file",
    what: "A notice about a return, a refund or an employer you don't recognize can mean someone filed in your name. Some letters ask you to verify your identity.",
    learnedFrom: "a notice you uploaded, or you telling me",
  },
};

export type StepKey =
  "report_ftc" | "form_14039" | "credit_freeze" | "call_irs" | "paper_return" | "ip_pin";

// The steps, in order. A step applies to the signs listed (all if omitted).
export const STEPS: readonly {
  key: StepKey;
  title: string;
  how: string;
  url?: string;
  phone?: string;
  signs?: readonly SignKey[];
}[] = [
  {
    key: "report_ftc",
    title: "Report it to the FTC",
    how: "Report the theft at IdentityTheft.gov. It makes a report and a recovery plan you can show the IRS and your bank.",
    url: "https://www.identitytheft.gov",
  },
  {
    key: "form_14039",
    title: "File Form 14039, the Identity Theft Affidavit",
    how: "Fill in Form 14039 and send it to the IRS with a copy of a photo ID. If your return was rejected, mail it with your paper return; if you got a letter, send it to the address on the letter.",
    url: "https://www.irs.gov/pub/irs-pdf/f14039.pdf",
  },
  {
    key: "credit_freeze",
    title: "Freeze your credit at all three bureaus",
    how: "A freeze stops anyone opening credit in your name. It's free, and you can lift it when you need credit.",
    url: "/loans/credit",
  },
  {
    key: "call_irs",
    title: "Call the IRS Identity Protection line",
    how: "Call to find out where your case stands and what the IRS needs from you. Have your ID and the notice in front of you.",
    phone: "800-908-4490",
  },
  {
    key: "paper_return",
    title: "File your return on paper",
    how: "If the e-file was rejected, print your return, sign it and mail it with Form 14039 attached.",
    signs: ["efile_rejected"],
  },
  {
    key: "ip_pin",
    title: "Get an IP PIN",
    how: "Once the IRS has your case, get an Identity Protection PIN so no one else can file with your number.",
    url: IP_PIN.url,
  },
];

export const CREDIT_FREEZE_URLS = {
  Equifax: "https://www.equifax.com/personal/credit-report-services/credit-freeze/",
  Experian: "https://www.experian.com/freeze/center.html",
  TransUnion: "https://www.transunion.com/credit-freeze",
} as const;
