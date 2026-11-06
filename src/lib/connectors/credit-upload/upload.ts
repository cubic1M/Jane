import {
  CREDIT_SCORE_MAX_AGE_DAYS,
  CREDIT_SCORE_MODELS,
  type CreditScoreModel,
} from "@/config/connectors";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { consentCovers, usableConnector } from "../consent";
import { creditUpload } from "./connector";

// The person's own credit report (connectors roadmap round 9): they get their free weekly reports
// at AnnualCreditReport.com and type in a free score; Jane keeps only derived numbers, never the
// report itself. No vendor, so nothing is pulled from a bureau and no FCRA permissible purpose is
// claimed (counsel to confirm). A read connector with no act, off until its REAL_CONNECTORS switch.
//
// Reading the report's PDF (a `credit_report` document kind through src/lib/documents/extract.ts)
// is the next step; this is what it must produce, and the only shape that's saved.

// What Jane keeps from one bureau's report: counts and amounts. No name, address, SSN, account
// number or tradeline: a field that isn't here is dropped, and a creditor's name is the only text.
export type CreditUpload = {
  bureau: "equifax" | "experian" | "transunion";
  reportDate: string;
  openCards: { limitCents: number; balanceCents: number }[];
  oldestAccountMonths: number;
  averageAgeMonths: number;
  hardInquiries12m: number;
  // Payments 30, 60 and 90+ days late in the last 24 months.
  late24m: { days30: number; days60: number; days90: number };
  collections: { creditor: string; amountCents: number; medical: boolean }[];
};

export type ScoreEntry = { model: CreditScoreModel; score: number; asOf: string };

export class CreditUploadError extends Error {
  constructor(readonly field: string) {
    super(`That doesn't look right: ${field}.`);
    this.name = "CreditUploadError";
  }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const BUREAUS = new Set(["equifax", "experian", "transunion"]);
const count = (value: unknown, field: string, max = 1000): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new CreditUploadError(field);
  }
  return value;
};
const cents = (value: unknown, field: string) => count(value, field, 2_000_000_000);
// A creditor is a company: no digits that could be an account number, no @, a short name.
const creditorName = (value: unknown): string => {
  if (typeof value !== "string") throw new CreditUploadError("collections.creditor");
  const name = value.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name || /\d{4,}|@/.test(name)) throw new CreditUploadError("collections.creditor");
  return name;
};

// The only way a report gets in: exactly these fields, checked, anything else dropped.
export function validateCreditUpload(raw: unknown): CreditUpload {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.bureau !== "string" || !BUREAUS.has(r.bureau)) throw new CreditUploadError("bureau");
  if (typeof r.reportDate !== "string" || !ISO_DAY.test(r.reportDate)) {
    throw new CreditUploadError("reportDate");
  }
  if (!Array.isArray(r.openCards) || r.openCards.length > 100)
    throw new CreditUploadError("openCards");
  if (!Array.isArray(r.collections) || r.collections.length > 100) {
    throw new CreditUploadError("collections");
  }
  const late = (r.late24m ?? {}) as Record<string, unknown>;
  return {
    bureau: r.bureau as CreditUpload["bureau"],
    reportDate: r.reportDate,
    openCards: r.openCards.map((card) => {
      const c = (card ?? {}) as Record<string, unknown>;
      return {
        limitCents: cents(c.limitCents, "openCards.limitCents"),
        balanceCents: cents(c.balanceCents, "openCards.balanceCents"),
      };
    }),
    oldestAccountMonths: count(r.oldestAccountMonths, "oldestAccountMonths"),
    averageAgeMonths: count(r.averageAgeMonths, "averageAgeMonths"),
    hardInquiries12m: count(r.hardInquiries12m, "hardInquiries12m", 100),
    late24m: {
      days30: count(late.days30, "late24m.days30", 100),
      days60: count(late.days60, "late24m.days60", 100),
      days90: count(late.days90, "late24m.days90", 100),
    },
    collections: r.collections.map((item) => {
      const c = (item ?? {}) as Record<string, unknown>;
      return {
        creditor: creditorName(c.creditor),
        amountCents: cents(c.amountCents, "collections.amountCents"),
        medical: c.medical === true,
      };
    }),
  };
}

export function validateScore(raw: unknown, { today }: { today: string }): ScoreEntry {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.model !== "string" || !Object.hasOwn(CREDIT_SCORE_MODELS, r.model)) {
    throw new CreditUploadError("score model");
  }
  const model = r.model as CreditScoreModel;
  const { low, high } = CREDIT_SCORE_MODELS[model];
  if (
    typeof r.score !== "number" ||
    !Number.isInteger(r.score) ||
    r.score < low ||
    r.score > high
  ) {
    throw new CreditUploadError("score");
  }
  if (typeof r.asOf !== "string" || !ISO_DAY.test(r.asOf) || r.asOf > today) {
    throw new CreditUploadError("score date");
  }
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.asOf}T00:00:00Z`)) / 86_400_000;
  if (age > CREDIT_SCORE_MAX_AGE_DAYS) throw new CreditUploadError("score date");
  return { model, score: r.score, asOf: r.asOf };
}

// What Claude may see of it (round 9's design rule): derived numbers only. No creditor names, no
// text at all from the report, so nothing a person wrote or a bureau printed can reach a prompt.
export function creditForLlm(upload: CreditUpload, score: ScoreEntry | null) {
  const limit = upload.openCards.reduce((sum, c) => sum + c.limitCents, 0);
  const balance = upload.openCards.reduce((sum, c) => sum + c.balanceCents, 0);
  return {
    score: score?.score ?? null,
    scoreModel: score ? CREDIT_SCORE_MODELS[score.model].label : null,
    scoreAsOf: score?.asOf ?? null,
    reportDate: upload.reportDate,
    openCards: upload.openCards.length,
    utilisationPercent: limit > 0 ? Math.round((balance / limit) * 100) : null,
    oldestAccountMonths: upload.oldestAccountMonths,
    averageAgeMonths: upload.averageAgeMonths,
    hardInquiries12m: upload.hardInquiries12m,
    latePayments24m: upload.late24m,
    collections: upload.collections.length,
    collectionsCents: upload.collections.reduce((sum, c) => sum + c.amountCents, 0),
    medicalCollections: upload.collections.filter((c) => c.medical).length,
  };
}

type Options = { client?: PrismaClient; now?: Date };

// Saves one report with the score the person typed in, as their own (partner "upload"). Only with
// the connector on for them and their read_credit consent.
export async function saveCreditUpload(
  userId: string,
  raw: { report: unknown; score: unknown },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ id: string }> {
  const connector = await usableConnector(userId, creditUpload.id, { client });
  if (!(await consentCovers(userId, connector, { client }))) throw new CreditUploadError("consent");
  const today = now.toISOString().slice(0, 10);
  const upload = validateCreditUpload(raw.report);
  const score = validateScore(raw.score, { today });
  const { low, high, label } = CREDIT_SCORE_MODELS[score.model];
  const row = await scopedFor(userId, client).creditReports.create({
    data: {
      userId,
      partner: "upload",
      score: score.score,
      model: label,
      rangeLow: low,
      rangeHigh: high,
      cardLimitCents: upload.openCards.reduce((sum, c) => sum + c.limitCents, 0),
      averageAgeMonths: upload.averageAgeMonths,
      hardInquiries: upload.hardInquiries12m,
      // The derived report itself, already stripped to the fields above.
      inputs: { upload, scoreAsOf: score.asOf },
      demo: false,
      pulledOn: new Date(`${score.asOf}T00:00:00Z`),
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "credit_report_uploaded",
    { type: "user", id: userId },
    { bureau: upload.bureau, collections: upload.collections.length },
  );
  await track(userId, "credit_report_uploaded", { bureau: upload.bureau });
  return row;
}
