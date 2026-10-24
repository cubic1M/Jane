import { PROJECT_MAX_CENTS, PROJECT_MIN_CENTS, PROJECT_YEARS_MAX } from "@/config/home-equity";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DebtBook } from "@/insights/debts";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadMortgage, type Mortgage } from "@/lib/mortgage";
import {
  compareProject,
  escrowCheck,
  escrowLetter,
  pmiOriginalLetter,
  pmiTimeline,
  type EscrowCheck,
  type PmiTimeline,
  type ProjectOption,
} from "@/planning/home-equity";

// A home's equity, used well (spec step 228), for one person: PMI against the home's original
// value (the request letter at 80%, the automatic end at 78%), the escrow in the payment
// against the real tax and insurance bills (with a refund request when it's overfunded), and
// a home project paid for with a HELOC, a cash-out refinance or a personal loan, each with
// its total cost (demo advice). The loan comes from the bank; the original value and the
// bills are what the person tells Jane.

type Options = { client?: PrismaClient; now?: Date; book?: DebtBook; mortgage?: Mortgage | null };

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export class HomeEquityError extends Error {}

export type HomeFacts = {
  originalValueCents: number | null;
  yearlyTaxCents: number | null;
  yearlyInsuranceCents: number | null;
  pmiLetterSentOn: string | null;
  escrowRequestSentOn: string | null;
};

export type HomeEquity = {
  // A mortgage with a balance.
  available: boolean;
  loanName: string | null;
  accountId: string | null;
  balanceCents: number;
  homeValueCents: number | null;
  hasPmi: boolean | null;
  facts: HomeFacts;
  pmi: PmiTimeline | null;
  pmiLetter: string | null;
  escrow: EscrowCheck | null;
  escrowLetter: string | null;
  paymentCents: number | null;
  // Demo advice mode: a project comparison may be shown.
  advice: boolean;
};

const EMPTY_FACTS: HomeFacts = {
  originalValueCents: null,
  yearlyTaxCents: null,
  yearlyInsuranceCents: null,
  pmiLetterSentOn: null,
  escrowRequestSentOn: null,
};

export async function loadHomeEquity(
  userId: string,
  { client = defaultClient, now = new Date(), book, mortgage: given }: Options = {},
): Promise<HomeEquity> {
  const m = given === undefined ? await loadMortgage(userId, { client, now, book }) : given;
  const advice = await adviceMode(userId, { client });
  if (!m) {
    return {
      available: false,
      loanName: null,
      accountId: null,
      balanceCents: 0,
      homeValueCents: null,
      hasPmi: null,
      facts: EMPTY_FACTS,
      pmi: null,
      pmiLetter: null,
      escrow: null,
      escrowLetter: null,
      paymentCents: null,
      advice,
    };
  }
  const db = scopedFor(userId, client);
  const [row, user] = await Promise.all([
    db.homeEquityFacts.findFirst(),
    client.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);
  const facts: HomeFacts = row
    ? {
        originalValueCents: row.originalValueCents,
        yearlyTaxCents: row.yearlyTaxCents,
        yearlyInsuranceCents: row.yearlyInsuranceCents,
        pmiLetterSentOn: row.pmiLetterSentOn ? isoDay(row.pmiLetterSentOn) : null,
        escrowRequestSentOn: row.escrowRequestSentOn ? isoDay(row.escrowRequestSentOn) : null,
      }
    : EMPTY_FACTS;
  const aprBps = m.loan.aprBps;
  const paymentCents = m.loan.paymentCents;
  // The payment's split, as every page has it (src/insights/debts.ts).
  const paymentPiCents = m.loan.principalAndInterestCents ?? null;
  const balanceCents = m.loan.balanceCents!;
  const pmi =
    m.hasPmi && facts.originalValueCents
      ? pmiTimeline({
          originalValueCents: facts.originalValueCents,
          balanceCents,
          aprBps,
          paymentPiCents,
          today: isoDay(now),
        })
      : null;
  const name = user?.name ?? "";
  const escrow =
    facts.yearlyTaxCents !== null || facts.yearlyInsuranceCents !== null
      ? escrowCheck({
          paymentCents,
          paymentPiCents,
          yearlyTaxCents: facts.yearlyTaxCents,
          yearlyInsuranceCents: facts.yearlyInsuranceCents,
          escrowBalanceCents: m.escrowBalanceCents,
        })
      : null;
  return {
    available: true,
    loanName: m.loan.name,
    accountId: m.loan.accountId,
    balanceCents,
    homeValueCents: m.home?.valueCents ?? null,
    hasPmi: m.hasPmi,
    facts,
    pmi,
    pmiLetter:
      pmi?.canAskNow && !pmi.endsNow
        ? pmiOriginalLetter({
            name,
            loanName: m.loan.name,
            balanceCents,
            originalValueCents: facts.originalValueCents!,
          })
        : null,
    escrow,
    escrowLetter:
      escrow && escrow.kind === "over"
        ? escrowLetter({
            name,
            loanName: m.loan.name,
            check: escrow,
            yearlyTaxCents: facts.yearlyTaxCents,
            yearlyInsuranceCents: facts.yearlyInsuranceCents,
          })
        : null,
    paymentCents,
    advice,
  };
}

const bill = (cents: number | null, label: string): number | null => {
  if (cents === null) return null;
  if (!Number.isInteger(cents) || cents <= 0 || cents > 100_000_000) {
    throw new HomeEquityError(`${label} should be a dollar amount above zero.`);
  }
  return cents;
};

// The person told Jane the home's original value and what their tax and insurance bills are.
export async function saveHomeFacts(
  userId: string,
  input: {
    originalValueCents: number | null;
    yearlyTaxCents: number | null;
    yearlyInsuranceCents: number | null;
  },
  { client = defaultClient }: Options = {},
): Promise<void> {
  const data = {
    originalValueCents: bill(input.originalValueCents, "The home's original value"),
    yearlyTaxCents: bill(input.yearlyTaxCents, "The property tax"),
    yearlyInsuranceCents: bill(input.yearlyInsuranceCents, "The insurance"),
  };
  await scopedFor(userId, client).homeEquityFacts.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  await logAudit(
    { type: "user", id: userId },
    "home_equity_updated",
    { type: "home_equity", id: userId },
    {},
  );
  await track(userId, "home_equity_updated", {});
}

// The person sent the drafted request to their servicer.
export async function markHomeRequestSent(
  userId: string,
  which: "pmi" | "escrow",
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const data =
    which === "pmi"
      ? { pmiLetterSentOn: new Date(`${isoDay(now)}T00:00:00Z`) }
      : { escrowRequestSentOn: new Date(`${isoDay(now)}T00:00:00Z`) };
  await scopedFor(userId, client).homeEquityFacts.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  await logAudit(
    { type: "user", id: userId },
    "home_request_sent",
    { type: "home_equity", id: userId },
    { which },
  );
  await track(userId, "home_request_sent", { which });
}

export type ProjectComparison = {
  projectCents: number;
  years: number;
  options: ProjectOption[];
};

// The ways to pay for a project, with total cost. Null without a mortgage or outside demo
// advice mode (a real account gets no advice).
export async function compareHomeProject(
  userId: string,
  input: { projectCents: number; years: number },
  { client = defaultClient, now = new Date(), book, mortgage: given }: Options = {},
): Promise<ProjectComparison | null> {
  if (
    !Number.isInteger(input.projectCents) ||
    input.projectCents < PROJECT_MIN_CENTS ||
    input.projectCents > PROJECT_MAX_CENTS
  ) {
    throw new HomeEquityError(
      "Give the project's cost as a dollar amount between $1,000 and $1,000,000.",
    );
  }
  if (!Number.isInteger(input.years) || input.years < 1 || input.years > PROJECT_YEARS_MAX) {
    throw new HomeEquityError(`Pay it back over between 1 and ${PROJECT_YEARS_MAX} years.`);
  }
  const m = given === undefined ? await loadMortgage(userId, { client, now, book }) : given;
  if (!m || !(await adviceMode(userId, { client }))) return null;
  return {
    projectCents: input.projectCents,
    years: input.years,
    options: compareProject({
      projectCents: input.projectCents,
      years: input.years,
      homeValueCents: m.home?.valueCents ?? null,
      mortgageBalanceCents: m.loan.balanceCents!,
      mortgageAprBps: m.loan.aprBps,
      mortgagePiCents: m.loan.principalAndInterestCents ?? null,
    }),
  };
}
