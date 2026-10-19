import type { LoanProduct } from "@/config/debt";
import type { Prisma } from "@/generated/prisma/client";
import type { Applicant } from "@/lib/lenders/partner";

// Loan applications (spec step 112) as the chat and pages show them: the shape and where
// each stands, in words. Pure, so the chat's message sources and tools can use it.

export type ApplicationStatus =
  "draft" | "approved" | "declined" | "accepted" | "funded" | "paid_off" | "withdrawn";
export type LoanApplicationRow = Prisma.LoanApplicationGetPayload<{
  select: {
    id: true;
    debtKey: true;
    oldAccountId: true;
    oldName: true;
    partner: true;
    offerId: true;
    lender: true;
    product: true;
    aprBps: true;
    rateType: true;
    termMonths: true;
    amountCents: true;
    feeCents: true;
    monthlyCents: true;
    totalCents: true;
    savingCents: true;
    status: true;
    applicant: true;
    partnerApplicationId: true;
    reviewedAt: true;
    submittedAt: true;
    acceptedAt: true;
    fundedAt: true;
    paidOffAt: true;
    createdAt: true;
  };
}>;

export type LoanApplicationView = Omit<LoanApplicationRow, "status" | "applicant" | "product"> & {
  status: ApplicationStatus;
  product: LoanProduct;
  applicant: Applicant;
};

// "Approved by Harbor Auto Refi: waiting for your yes."
export function statusLine(
  app: Pick<LoanApplicationView, "status" | "lender" | "oldName">,
): string {
  switch (app.status) {
    case "draft":
      return `Ready for you to review and submit to ${app.lender}.`;
    case "approved":
      return `Approved by ${app.lender}: waiting for your yes.`;
    case "declined":
      return `${app.lender} declined it.`;
    case "accepted":
      return `You accepted it. ${app.lender} pays off your ${app.oldName} next.`;
    case "funded":
      return `${app.lender} funded it. Jane is watching for your ${app.oldName} to reach zero.`;
    case "paid_off":
      return `Done: your ${app.oldName} is paid off.`;
    case "withdrawn":
      return "Withdrawn.";
  }
}
