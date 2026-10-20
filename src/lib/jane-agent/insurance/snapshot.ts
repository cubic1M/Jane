import type { Need } from "@/lib/insurance/need/types";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Gap } from "@/lib/insurance/gaps";
import type { Household } from "@/lib/insurance/household";
import { nextRenewal, type Policy } from "@/lib/insurance/policies";
import { partnerFor } from "@/lib/insurance/partner";
import { loadInsurance } from "@/lib/insurance/profile";
import { openShops, recentNoBetter, type Shop } from "@/lib/insurance/shop";
import { switchesFor } from "@/lib/insurance/switch";
import { latestCheckup, type Checkup } from "@/lib/insurance/checkups";
import { listClaims, type Claim } from "@/lib/insurance/claims";
import {
  listBenefits,
  nextQuestion,
  type Benefit,
  type BenefitQuestion,
} from "@/lib/insurance/benefits";
import { listReadings, type Reading } from "@/lib/insurance/readings";
import { latestLife, type LifeApplication } from "@/lib/insurance/life";
import { listCoverChanges, type CoverChange } from "@/lib/insurance/cover-changes";
import { listNegotiations, type Negotiation } from "@/lib/insurance/negotiate";
import { listSavings, type Saving } from "@/lib/insurance/savings";
import { listRisks, type Risk } from "@/lib/insurance/risks";
import { loadReview } from "@/lib/insurance/review";
import type { ReviewInput } from "@/lib/insurance/review-rules";
import { loadHealthYear, type HealthYear } from "@/lib/insurance/health-year";
import { SWITCH_NEWS_DAYS, SWITCH_PAYMENT_DAYS } from "@/config/insurance";

// What Jane's brain knows about the person's insurance (spec Phase X), from the same loader
// as /insurance.

export type InsuranceSnapshot = {
  policies: (Policy & { nextRenewal: string | null })[];
  gaps: Gap[];
  household: Household;
  // Demo advice mode (spec step 98).
  advice: boolean;
  // Whether an insurance partner can quote for this person (spec step 103).
  canQuote: boolean;
  // Spec step 104: Jane shops this person's policies herself (a partner and demo advice
  // mode), her open picks, and reshops that found nothing better lately.
  // Optional, so a snapshot built without them (in tests) says nothing about reshops.
  shopsItself?: boolean;
  shops?: Shop[];
  noBetter?: Shop[];
  // Spec step 105: switches Jane is doing (the new policy bound, waiting for its first
  // payment) and ones finished lately.
  switches?: Switch[];
  // Spec step 106: the newest coverage checkup, if the person hasn't seen it yet.
  checkup?: Checkup | null;
  // Spec step 107: claims the person is tracking.
  claims?: Claim[];
  // Spec step 150: benefits through work and the next guided question, if any.
  benefits?: Benefit[];
  benefitQuestion?: BenefitQuestion | null;
  // Spec step 151: policies read from documents, waiting for the person's confirm tap.
  readings?: Reading[];
  // Spec step 153: life cover sized and being applied for (demo advice), or the question
  // about dependants it needs first.
  life?: LifeApplication | null;
  lifeAsk?: "dependants" | null;
  // Spec step 154: cover changes prepared after a life event, waiting for the person.
  coverChanges?: CoverChange[];
  // Spec step 155: renewal calls (to ask about, or done lately) and claims Jane filed.
  negotiations?: Negotiation[];
  filedClaims?: Claim[];
  draftClaims?: Claim[];
  // Spec step 196: cheaper ways to pay for the same cover, offered and waiting.
  savings?: Saving[];
  // Spec step 197: risks seen in how they live, waiting for a yes or no.
  risks?: Risk[];
  // Spec step 200: the health plan's year, when its terms are known.
  healthYear?: HealthYear | null;
  // What cover they need, from the same numbers the nightly detectors use (spec step 278).
  // Loaded when a need is asked about, not on every snapshot.
  needs?: Need[] | null;
  // Spec step 202: the yearly review, when a checkup is waiting to be seen.
  review?: ReviewInput | null;
};

export type Switch = Awaited<ReturnType<typeof switchesFor>>[number];

export async function loadInsuranceSnapshot(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<InsuranceSnapshot> {
  const asOf = now.toISOString().slice(0, 10);
  const [
    { policies, gaps, household, advice, readings },
    partner,
    shops,
    noBetter,
    checkup,
    claims,
    benefits,
    life,
    coverChanges,
    negotiations,
    savings,
    risks,
    healthYear,
    switches,
  ] = await Promise.all([
    // Reads any policy document not read yet, so the readings below come after it.
    loadInsurance(userId, { client, now }).then(async (profile) => ({
      ...profile,
      readings: await listReadings(userId, { client, status: "waiting" }),
    })),
    partnerFor(userId, { client }),
    openShops(userId, { client, now }),
    recentNoBetter(userId, { client, now }),
    latestCheckup(userId, { client }),
    listClaims(userId, { client }),
    listBenefits(userId, { client }),
    latestLife(userId, { client }),
    listCoverChanges(userId, { client, status: "prepared" }),
    listNegotiations(userId, { client }),
    listSavings(userId, { client, status: "offered" }),
    listRisks(userId, { client, status: "asked" }),
    loadHealthYear(userId, { client, now }),
    switchesFor(userId, {
      client,
      since: new Date(now.getTime() - (SWITCH_NEWS_DAYS + SWITCH_PAYMENT_DAYS) * 86_400_000),
    }),
  ]);
  const review =
    checkup && !checkup.seenAt
      ? await loadReview(userId, checkup, gaps.length, { client, now })
      : null;
  return {
    review,
    policies: policies.map((p) => ({ ...p, nextRenewal: nextRenewal(p, asOf) })),
    gaps,
    household,
    advice,
    canQuote: partner !== null,
    shopsItself: partner !== null && advice,
    shops,
    noBetter,
    switches,
    checkup: checkup && !checkup.seenAt ? checkup : null,
    claims: claims.filter((c) => c.status === "open"),
    // Filed by Jane in the last couple of months, open or just paid.
    filedClaims: claims.filter(
      (c) =>
        c.filing === "filed" && c.filedAt && now.getTime() - c.filedAt.getTime() < 60 * 86_400_000,
    ),
    draftClaims: claims.filter((c) => c.status === "open" && c.filing === "draft"),
    benefits,
    // Asked once the pay-stub benefits are answered (or there are none to answer), for people
    // with a job: a paycheck in their accounts or a benefit on file.
    benefitQuestion:
      !benefits.some((b) => b.status === "found") &&
      (household.signals.paycheck || benefits.length > 0)
        ? nextQuestion(benefits)
        : null,
    readings,
    life: life && life.status !== "bought" ? life : null,
    coverChanges,
    negotiations: negotiations.filter((n) => n.status !== "declined"),
    savings,
    risks,
    healthYear,
    // Asked of people in demo advice mode with a paycheck, no life cover and no answer yet.
    lifeAsk:
      advice &&
      !life &&
      household.dependants.value === null &&
      household.signals.paycheck &&
      !policies.some((p) => p.kind === "life" && p.status === "active")
        ? "dependants"
        : null,
  };
}
