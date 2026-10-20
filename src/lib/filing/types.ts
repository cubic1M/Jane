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
  // Spec step 166: collected forms that check out (or the person said are right), with
  // their boxes in cents. Optional: returns started before step 166 don't have it.
  collectedForms?: { form: string; from: string; boxes: Record<string, number> }[];
};

export type ReturnPreview = { federalRefundCents: number; stateRefundCents: number | null };

export type PartnerStatus = "submitted" | "accepted" | "rejected";

export interface FilingPartner {
  readonly name: string;
  createReturn(
    pkg: ReturnPackage,
    preview: ReturnPreview,
  ): Promise<{ partnerReturnId: string; preview: ReturnPreview }>;
  // Spec step 172: an amended return (1040-X) for a past year, with the changes found.
  createAmendment(input: {
    taxYear: number;
    changes: { key: string; title: string; savesCents: number }[];
  }): Promise<{ partnerReturnId: string; refundCents: number }>;
  submitReturn(
    partnerReturnId: string,
    signature: { name: string; signedAt: Date },
  ): Promise<{ status: PartnerStatus }>;
  status(partnerReturnId: string, submittedAt: Date, now: Date): Promise<PartnerStatus>;
}
