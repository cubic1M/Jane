import type { PrismaClient } from "@/generated/prisma/client";
import type { DocumentBoxes } from "@/planning/tax-document-check";
import type { ExpectedForm } from "@/planning/tax-documents";

// Tax forms from a document partner (spec step 166). There's no partner yet, so the demo
// bank's people get a stand-in (./demo.ts) that behaves like one: each payer's form becomes
// available on its usual date, with its boxes. Swap in a real one (a payroll connection's
// W-2s, a brokerage's 1099s through a service such as Plaid Income, Argyle or a tax-form
// API) behind TaxDocumentPartner; real accounts are asked "Have you got it?" until then.

export type FetchedForm = {
  // The expected form it answers (ExpectedForm key).
  key: string;
  boxes: DocumentBoxes;
};

export interface TaxDocumentPartner {
  readonly name: string;
  // The forms ready for the expected ones (only those past their usual date). A form not
  // ready yet is simply left out.
  fetchForms(
    userId: string,
    year: number,
    expected: ExpectedForm[],
    options: { client: PrismaClient; today: string },
  ): Promise<FetchedForm[]>;
}
