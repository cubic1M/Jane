import { LOAN_PAID_OFF_CENTS, type LoanProduct } from "@/config/debt";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadDebts } from "@/lib/debts";
import type { Applicant, PrequalifyRequest } from "@/lib/lenders/partner";
import { STAND_IN_CREDIT_BAND, lenderPartnerFor } from "@/lib/refinance";
import { compareRefinance, refinanceable } from "@/planning/refinance";
import {
  statusLine,
  type ApplicationStatus,
  type LoanApplicationView,
} from "./loan-application-status";

export { statusLine, type ApplicationStatus, type LoanApplicationView };

// One-tap apply (spec step 112). Jane prepares the application for a refinance offer from
// what she already knows (the person's name and email, the loan being paid off and what's
// owed); the person reviews the terms and taps Submit (a soft check with the lender
// partner); if approved, they tap Accept to sign; then Jane watches the lender fund it and
// the old loan reach zero. Every step after "prepare" needs the person's tap.

type Options = { client?: PrismaClient; now?: Date };

// Still under way: one at a time per debt.
const ACTIVE: readonly ApplicationStatus[] = ["draft", "approved", "accepted", "funded"];

export class LoanApplicationError extends Error {}

export const APPLICATION_SELECT = {
  id: true,
  debtKey: true,
  oldAccountId: true,
  oldName: true,
  partner: true,
  offerId: true,
  lender: true,
  product: true,
  aprBps: true,
  rateType: true,
  termMonths: true,
  amountCents: true,
  feeCents: true,
  monthlyCents: true,
  totalCents: true,
  savingCents: true,
  status: true,
  applicant: true,
  partnerApplicationId: true,
  reviewedAt: true,
  submittedAt: true,
  acceptedAt: true,
  fundedAt: true,
  paidOffAt: true,
  createdAt: true,
} as const;

type Row = Prisma.LoanApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

const toView = (row: Row): LoanApplicationView => ({
  ...row,
  status: row.status as ApplicationStatus,
  product: row.product as LoanProduct,
  applicant: row.applicant as unknown as Applicant,
});

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export async function listApplications(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<LoanApplicationView[]> {
  const rows = await scopedFor(userId, client).loanApplications.findMany({
    select: APPLICATION_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  return rows.map(toView);
}

export async function getApplication(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<LoanApplicationView | null> {
  const row = await scopedFor(userId, client).loanApplications.findFirst({
    where: { id },
    select: APPLICATION_SELECT,
  });
  return row ? toView(row) : null;
}

// Prepares (or refreshes) the application for this lender's offer on this debt, with the
// lender's rate as it is now. Nothing is sent to the lender.
export async function prepareApplication(
  userId: string,
  input: { debtKey: string; lender: string },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<LoanApplicationView> {
  const found = await lenderPartnerFor(userId, { client });
  if (!found) throw new LoanApplicationError("There's no lending partner for your accounts yet.");
  const asOf = isoDay(now);
  const book = await loadDebts(userId, { client, now });
  const debt = book.debts.find((d) => d.key === input.debtKey);
  const what = debt && refinanceable(debt, asOf);
  if (!debt || !what) throw new LoanApplicationError("That debt can't be refinanced.");
  const request: PrequalifyRequest = {
    product: what.product,
    amountCents: debt.balanceCents!,
    termMonths: what.termMonths,
    creditBand: STAND_IN_CREDIT_BAND,
    month: asOf.slice(0, 7),
  };
  const offer = (await found.partner.prequalify(request)).find((o) => o.lender === input.lender);
  if (!offer) throw new LoanApplicationError(`${input.lender} doesn't have an offer for it now.`);
  const scored = compareRefinance(debt, [offer], asOf)!.offers[0];

  const db = scopedFor(userId, client);
  const under = await db.loanApplications.findFirst({
    where: { debtKey: debt.key, status: { in: ACTIVE.filter((s) => s !== "draft") } },
    select: { lender: true },
  });
  if (under) {
    throw new LoanApplicationError(`You're already applying with ${under.lender} for this one.`);
  }
  // Users have their own helpers, so a read of these columns by id.
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  const applicant: Applicant = {
    name: user?.name ?? "",
    email: user?.email ?? "",
    payingOff: debt.name,
    amountCents: debt.balanceCents!,
  };
  const data = {
    debtKey: debt.key,
    oldAccountId: debt.accountId,
    oldName: debt.name,
    partner: found.key,
    offerId: offer.id,
    lender: offer.lender,
    product: offer.product,
    aprBps: offer.aprBps,
    rateType: offer.rateType,
    termMonths: what.termMonths,
    amountCents: debt.balanceCents!,
    feeCents: offer.feeCents,
    monthlyCents: scored.monthlyCents,
    totalCents: scored.totalCents,
    savingCents: scored.savingCents,
    applicant: applicant as unknown as Prisma.InputJsonObject,
  };
  // A draft for the same debt is replaced: one application per debt at a time.
  await db.loanApplications.deleteMany({ where: { debtKey: debt.key, status: "draft" } });
  const row = await db.loanApplications.create({
    data: { userId, ...data },
    select: APPLICATION_SELECT,
  });
  await track(userId, "loan_application_prepared", { product: offer.product });
  return toView(row);
}

async function mustBe(userId: string, id: string, status: ApplicationStatus, client: PrismaClient) {
  const app = await getApplication(userId, id, { client });
  if (!app) throw new LoanApplicationError("That application isn't there anymore.");
  if (app.status !== status) throw new LoanApplicationError(statusLine(app));
  return app;
}

// Sends the application, once the person has reviewed the terms. A soft check: approved
// on the offer's terms, or declined.
export async function submitApplication(
  userId: string,
  id: string,
  { reviewed }: { reviewed: boolean },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<LoanApplicationView> {
  if (!reviewed) throw new LoanApplicationError("Review the terms before you apply.");
  const app = await mustBe(userId, id, "draft", client);
  const found = await lenderPartnerFor(userId, { client });
  if (!found) throw new LoanApplicationError("There's no lending partner for your accounts yet.");
  const result = await found.partner.apply({
    offer: {
      id: app.offerId,
      lender: app.lender,
      product: app.product,
      aprBps: app.aprBps,
      rateType: app.rateType === "variable" ? "variable" : "fixed",
      termMonths: app.termMonths,
      feeCents: app.feeCents,
      feeLabel: "",
      sourceUrl: "",
      demo: found.key === "demo",
    },
    request: {
      product: app.product,
      amountCents: app.amountCents,
      termMonths: app.termMonths,
      creditBand: STAND_IN_CREDIT_BAND,
      month: isoDay(now).slice(0, 7),
    },
    applicant: app.applicant,
  });
  const row = await scopedFor(userId, client).loanApplications.update({
    where: { id: app.id },
    data: {
      status: result.status,
      partnerApplicationId: result.applicationId,
      reviewedAt: now,
      submittedAt: now,
    },
    select: APPLICATION_SELECT,
  });
  await logAudit(
    { type: "user", id: userId },
    "loan_application_submitted",
    {
      type: "loan_application",
      id: app.id,
    },
    { lender: app.lender, product: app.product, status: result.status },
  );
  await track(userId, "loan_application_submitted", {
    product: app.product,
    status: result.status,
  });
  return toView(row);
}

// The person accepts the approved loan: signs for it with the lender.
export async function acceptLoan(
  userId: string,
  id: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<LoanApplicationView> {
  const app = await mustBe(userId, id, "approved", client);
  const found = await lenderPartnerFor(userId, { client });
  if (!found) throw new LoanApplicationError("There's no lending partner for your accounts yet.");
  await found.partner.accept(app.partnerApplicationId ?? "");
  const row = await scopedFor(userId, client).loanApplications.update({
    where: { id: app.id },
    data: { status: "accepted", acceptedAt: now },
    select: APPLICATION_SELECT,
  });
  await logAudit(
    { type: "user", id: userId },
    "loan_accepted",
    {
      type: "loan_application",
      id: app.id,
    },
    { lender: app.lender, product: app.product },
  );
  await track(userId, "loan_accepted", { product: app.product });
  return toView(row);
}

export async function withdrawApplication(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).loanApplications.updateMany({
    where: { id, status: { in: ["draft", "approved"] } },
    data: { status: "withdrawn" },
  });
  if (count === 0) throw new LoanApplicationError("That one can't be withdrawn now.");
  await track(userId, "loan_application_withdrawn");
}

// Jane following applications by herself, before her brain looks (src/lib/debt-refresh.ts):
// an accepted loan the lender funded, and a funded one whose old loan now shows zero. Returns
// what changed.
export async function refreshLoanApplications(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ funded: number; paidOff: number }> {
  const db = scopedFor(userId, client);
  const open = await db.loanApplications.findMany({
    where: { status: { in: ["accepted", "funded"] } },
    select: APPLICATION_SELECT,
  });
  if (open.length === 0) return { funded: 0, paidOff: 0 };
  const found = await lenderPartnerFor(userId, { client });
  let funded = 0;
  let paidOff = 0;
  for (const row of open) {
    if (row.status === "accepted" && found) {
      const status = await found.partner.status(row.partnerApplicationId ?? "", {
        now,
        acceptedAt: row.acceptedAt,
      });
      if (status === "funded") {
        await db.loanApplications.updateMany({
          where: { id: row.id, status: "accepted" },
          data: { status: "funded", fundedAt: now },
        });
        await track(userId, "loan_funded", { product: row.product });
        funded += 1;
      }
    }
  }
  // The old loans, as the bank reports them now.
  const watching = await db.loanApplications.findMany({
    where: { status: "funded" },
    select: { id: true, oldAccountId: true, product: true },
  });
  if (watching.length > 0) {
    const accounts = await db.accounts.findMany({
      where: { id: { in: watching.flatMap((w) => w.oldAccountId ?? []) } },
      select: { id: true, currentBalanceCents: true },
    });
    for (const w of watching) {
      const old = accounts.find((a) => a.id === w.oldAccountId);
      // Gone from the bank, or at zero (give or take a few cents of interest).
      if (
        !old ||
        (old.currentBalanceCents !== null && old.currentBalanceCents <= LOAN_PAID_OFF_CENTS)
      ) {
        await db.loanApplications.updateMany({
          where: { id: w.id, status: "funded" },
          data: { status: "paid_off", paidOffAt: now },
        });
        await track(userId, "loan_old_paid_off", { product: w.product });
        paidOff += 1;
      }
    }
  }
  return { funded, paidOff };
}

// The demo bank's side (spec step 75): demo loans a funded application has paid off, by
// the plaid account id and the day, so its next sync shows them at zero.
export async function demoPayoffs(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<{ plaidAccountId: string; day: string }[]> {
  const db = scopedFor(userId, client);
  const apps = await db.loanApplications.findMany({
    where: { status: { in: ["funded", "paid_off"] }, fundedAt: { not: null } },
    select: { oldAccountId: true, fundedAt: true },
  });
  if (apps.length === 0) return [];
  const accounts = await db.accounts.findMany({
    where: { id: { in: apps.flatMap((a) => a.oldAccountId ?? []) } },
    select: { id: true, plaidAccountId: true },
  });
  return apps.flatMap((a) => {
    const account = accounts.find((x) => x.id === a.oldAccountId);
    return account?.plaidAccountId
      ? [{ plaidAccountId: account.plaidAccountId, day: isoDay(a.fundedAt!) }]
      : [];
  });
}
