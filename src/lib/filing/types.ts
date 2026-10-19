// Filing a tax return through a partner (spec step 126). There's no filing partner yet, so
// the demo bank's people file with a stand-in (./demo.ts) that behaves like one: it takes
// the package, prepares a return with a preview, accepts a signed submission and later
// reports it accepted. Swap in a real e-file partner (an IRS-authorized e-file provider
// with an API, such as April or Column Tax) behind FilingPartner; real accounts can't file
// until one is connected.

export type ReturnPackage = {
  taxYear: number;
  profile: {
    filingStatus: string;
    childrenUnder17: number;
    otherDependants: number;
    state: string | null;
    incomeKinds: string[];
  };
  // Cents, for the year.
  income: Record<string, number>;
  withholding: { federalCents: number; stateCents: number };
  estimatedPayments: { federalCents: number; stateCents: number };
  deductions: { studentLoanInterestCents: number; mortgageInterestCents: number };
  // Tax tags' totals, by tag.
  tags: Record<string, number>;
  forms: { form: string; from: string; received: boolean }[];
  documents: { kind: string; title: string }[];
};

export type ReturnPreview = { federalRefundCents: number; stateRefundCents: number | null };

export type PartnerStatus = "submitted" | "accepted" | "rejected";

export interface FilingPartner {
  readonly name: string;
  createReturn(
    pkg: ReturnPackage,
    preview: ReturnPreview,
  ): Promise<{ partnerReturnId: string; preview: ReturnPreview }>;
  submitReturn(
    partnerReturnId: string,
    signature: { name: string; signedAt: Date },
  ): Promise<{ status: PartnerStatus }>;
  status(partnerReturnId: string, submittedAt: Date, now: Date): Promise<PartnerStatus>;
}
