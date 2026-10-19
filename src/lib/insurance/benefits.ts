import {
  BENEFIT_PATTERNS,
  BENEFIT_POLICY_KIND,
  DISABILITY_PAY_SHARE,
  LIFE_MULTIPLES,
  PAY_PERIODS,
  type BenefitKind,
  type PayFrequency,
} from "@/config/benefits";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { payrollFor, type Paystub } from "./payroll";

// Benefits through work (spec step 150): found from the person's pay-stub deductions, and
// for cover the employer pays for (which no stub shows), from a short guided flow. A found
// benefit counts only once the person confirms it; a confirmed insurance benefit becomes a
// policy on the profile ("Through your job"), so gaps, the checkup and comparisons see it.

type Options = { client?: PrismaClient; now?: Date };

export class BenefitError extends Error {}

export type Benefit = {
  id: string;
  employer: string;
  kind: BenefitKind;
  label: string;
  perPayCents: number;
  payFrequency: PayFrequency;
  // What it's worth, when known: life cover in cents, disability as a monthly benefit.
  details: { deathBenefitCents?: number; monthlyBenefitCents?: number; yearlyPayCents?: number };
  status: "found" | "confirmed" | "declined" | "unsure";
  source: "paystub" | "asked";
  policyId: string | null;
};

const SELECT = {
  id: true,
  employer: true,
  kind: true,
  label: true,
  perPayCents: true,
  payFrequency: true,
  details: true,
  status: true,
  source: true,
  policyId: true,
} as const;

function toBenefit(row: Prisma.EmployerBenefitGetPayload<{ select: typeof SELECT }>): Benefit {
  return {
    id: row.id,
    employer: row.employer,
    kind: row.kind as BenefitKind,
    label: row.label,
    perPayCents: row.perPayCents,
    payFrequency: (Object.hasOwn(PAY_PERIODS, row.payFrequency)
      ? row.payFrequency
      : "monthly") as PayFrequency,
    details: (row.details ?? {}) as Benefit["details"],
    status: row.status as Benefit["status"],
    source: row.source === "asked" ? "asked" : "paystub",
    policyId: row.policyId,
  };
}

// Pure: which benefit a pay-stub deduction is, by its label; null for anything else.
export function benefitOf(label: string): BenefitKind | null {
  return BENEFIT_PATTERNS.find(([, pattern]) => pattern.test(label))?.[0] ?? null;
}

// Pure: what a benefit costs a year.
export const yearlyCost = (b: Pick<Benefit, "perPayCents" | "payFrequency">) =>
  b.perPayCents * PAY_PERIODS[b.payFrequency];

// Pure: yearly pay from a stub.
export const yearlyPay = (stub: Pick<Paystub, "grossCents" | "payFrequency">) =>
  stub.grossCents * PAY_PERIODS[stub.payFrequency];

// Reads the newest pay stub and adds each benefit deduction not seen before, as found.
// Declined ones are never added again. Returns how many are new.
export async function benefitsFromPayroll(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const payroll = await payrollFor(userId, { client });
  if (!payroll) return 0;
  const [stub] = await payroll.paystubs(userId, { now });
  if (!stub) return 0;
  const db = scopedFor(userId, client);
  const known = await db.employerBenefits.findMany({
    where: { employer: stub.employer },
    select: { kind: true, label: true },
  });
  const has = new Set(known.map((k) => `${k.kind}:${k.label}`));
  const pay = yearlyPay(stub);
  const fresh = stub.deductions.flatMap((d) => {
    const kind = benefitOf(d.label);
    return kind && !has.has(`${kind}:${d.label}`) ? [{ ...d, kind }] : [];
  });
  if (fresh.length === 0) return 0;
  await db.employerBenefits.createMany({
    data: fresh.map((d) => ({
      userId,
      employer: stub.employer,
      kind: d.kind,
      label: d.label,
      perPayCents: d.amountCents,
      payFrequency: stub.payFrequency,
      status: "found",
      source: "paystub",
      details: detailsFor(d.kind, d.label, pay),
    })),
    skipDuplicates: true,
  });
  await track(userId, "benefits_found", { count: fresh.length, demo: payroll.demo });
  return fresh.length;
}

// What the pay stub says a benefit is worth: supplemental life as a multiple of pay
// ("SUPP LIFE 1X"), long-term disability as the usual share of pay.
function detailsFor(kind: BenefitKind, label: string, yearlyPayCents: number): Benefit["details"] {
  if (kind === "life") {
    const multiple = Number(/(\d)\s*x\b/i.exec(label)?.[1] ?? 0);
    return multiple > 0
      ? { deathBenefitCents: yearlyPayCents * multiple, yearlyPayCents }
      : { yearlyPayCents };
  }
  if (kind === "disability") {
    return {
      monthlyBenefitCents: Math.round((yearlyPayCents / 12) * DISABILITY_PAY_SHARE),
      yearlyPayCents,
    };
  }
  return { yearlyPayCents };
}

export async function listBenefits(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<Benefit[]> {
  const rows = await scopedFor(userId, client).employerBenefits.findMany({
    select: SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toBenefit);
}

// A confirmed insurance benefit as a policy on the profile, at its monthly cost.
async function policyFor(userId: string, b: Benefit, client: PrismaClient): Promise<string | null> {
  const kind = BENEFIT_POLICY_KIND[b.kind];
  if (!kind) return null;
  const coverage: Prisma.InputJsonObject =
    kind === "life" && b.details.deathBenefitCents
      ? { deathBenefit: b.details.deathBenefitCents }
      : kind === "disability" && b.details.monthlyBenefitCents
        ? { monthlyBenefit: b.details.monthlyBenefitCents, waitingDays: 90 }
        : {};
  const row = await scopedFor(userId, client).insurancePolicies.create({
    data: {
      userId,
      kind,
      carrier: b.employer,
      status: "active",
      source: "employer",
      premiumCents: Math.round(yearlyCost(b) / 12),
      premiumFrequency: "monthly",
      coverage,
      covers: `${b.label} through your job`,
    },
    select: { id: true },
  });
  return row.id;
}

// Confirm: the person says the deduction is this benefit. Only now does it count.
export async function confirmBenefit(
  userId: string,
  benefitId: string,
  { client = defaultClient }: Options = {},
): Promise<Benefit> {
  const db = scopedFor(userId, client);
  const row = await db.employerBenefits.findFirst({
    where: { id: benefitId, status: { in: ["found", "unsure"] } },
    select: SELECT,
  });
  if (!row) throw new BenefitError("That one's already been answered.");
  const benefit = toBenefit(row);
  const policyId = await policyFor(userId, benefit, client);
  await db.employerBenefits.updateMany({
    where: { id: benefitId },
    data: { status: "confirmed", policyId },
  });
  await logAudit(
    { type: "user", id: userId },
    "employer_benefit_confirmed",
    {
      type: "employer_benefit",
      id: benefitId,
    },
    { kind: benefit.kind },
  );
  await track(userId, "benefit_confirmed", { kind: benefit.kind, source: benefit.source });
  return { ...benefit, status: "confirmed", policyId };
}

export async function confirmAllFound(userId: string, { client = defaultClient }: Options = {}) {
  const found = (await listBenefits(userId, { client })).filter((b) => b.status === "found");
  for (const b of found) await confirmBenefit(userId, b.id, { client });
  return found.length;
}

// Not this: the deduction isn't that benefit, and isn't suggested again.
export async function declineBenefit(
  userId: string,
  benefitId: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).employerBenefits.updateMany({
    where: { id: benefitId, status: "found" },
    data: { status: "declined" },
  });
  if (count === 0) throw new BenefitError("That one's already been answered.");
  await track(userId, "benefit_declined");
}

// The guided flow (spec step 150): cover the employer pays for, which no pay stub shows.
export type BenefitQuestion = "life" | "disability";
export type BenefitAnswer = "1x" | "2x" | "yes" | "none" | "unsure";

// Pure: the next question to ask, given what's on file: employer-paid life cover (always worth
// asking: supplemental life on the stub sits on top of it), then disability unless a stub
// already shows it. Null once both are answered.
export function nextQuestion(benefits: Benefit[]): BenefitQuestion | null {
  const asked = (kind: BenefitKind) =>
    benefits.some((b) => b.kind === kind && b.source === "asked");
  if (!asked("life")) return "life";
  if (
    !asked("disability") &&
    !benefits.some((b) => b.kind === "disability" && b.status !== "declined")
  ) {
    return "disability";
  }
  return null;
}

export async function answerQuestion(
  userId: string,
  question: BenefitQuestion,
  answer: BenefitAnswer,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Benefit[]> {
  const db = scopedFor(userId, client);
  const benefits = await listBenefits(userId, { client });
  if (nextQuestion(benefits) !== question)
    throw new BenefitError("That one's already been answered.");
  const payroll = await payrollFor(userId, { client });
  const [stub] = payroll ? await payroll.paystubs(userId, { now }) : [];
  const employer = stub?.employer ?? benefits[0]?.employer ?? "Your employer";
  const pay = stub ? yearlyPay(stub) : null;
  const yes = answer === "1x" || answer === "2x" || answer === "yes";
  const details =
    question === "life" && (answer === "1x" || answer === "2x") && pay !== null
      ? { deathBenefitCents: pay * LIFE_MULTIPLES[answer], yearlyPayCents: pay }
      : question === "disability" && yes && pay !== null
        ? {
            monthlyBenefitCents: Math.round((pay / 12) * DISABILITY_PAY_SHARE),
            yearlyPayCents: pay,
          }
        : {};
  const row = await db.employerBenefits.create({
    data: {
      userId,
      employer,
      kind: question,
      label:
        question === "life"
          ? `Basic life${yes ? ` ${answer}` : ""} paid by your employer`
          : "Disability paid by your employer",
      perPayCents: 0,
      payFrequency: stub?.payFrequency ?? "monthly",
      status: yes ? "found" : answer === "none" ? "declined" : "unsure",
      source: "asked",
      details,
    },
    select: SELECT,
  });
  // What they told Jane is their confirmation.
  if (yes) await confirmBenefit(userId, row.id, { client });
  await track(userId, "benefit_question_answered", { question, answer });
  return listBenefits(userId, { client });
}

// The employer's open enrollment, from the newest pay stub.
export async function openEnrollmentAtWork(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ employer: string; start: string; end: string } | null> {
  const payroll = await payrollFor(userId, { client });
  const [stub] = payroll ? await payroll.paystubs(userId, { now }) : [];
  return stub?.openEnrollment ? { employer: stub.employer, ...stub.openEnrollment } : null;
}
