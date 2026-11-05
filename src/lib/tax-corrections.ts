import {
  ONE_PER_YEAR,
  TAX_CORRECTION_KINDS,
  TAX_CORRECTION_LABEL_MAX,
  TAX_CORRECTION_MAX_CENTS,
  TAX_CORRECTION_MAX_PER_YEAR,
  type TaxCorrectionKind,
} from "@/config/tax-set-aside";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { log } from "@/lib/log";
import { scanSuggestions } from "@/lib/suggestions";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { todayOf } from "@/lib/today";
import { oneLine } from "@/lib/untrusted-text";
import { defaultTaxYear } from "@/planning/tax-pack";

// What a person points out on their tax calculation: income that isn't, a deduction, a payment, a
// number that's wrong. The estimate reads these each time it's worked out (src/lib/tax-estimate.ts),
// so they hold across later syncs and scans, and every figure built on it moves with them.

type Options = { client?: PrismaClient; now?: Date; via: "page" | "chat" };

export class TaxCorrectionError extends Error {}

export type NewTaxCorrection =
  | { kind: "not_income"; payerKey: string }
  | { kind: Exclude<TaxCorrectionKind, "not_income" | "paid">; cents: number; label?: string }
  | { kind: "paid"; cents: number; paidTo: "federal" | "state"; label?: string };

const WORDS: Record<TaxCorrectionKind, string> = {
  not_income: "Not income",
  wages: "Wages so far",
  self_employed: "Self-employment income so far",
  withheld: "Federal tax withheld so far",
  business_cost: "A cost of my work",
  deduction: "A deduction",
  paid: "A tax payment",
  kept_apart: "Already kept apart",
};

// The cards say the figure as of the last scan: worked out again now, so the dock moves with the
// page, and a card that no longer holds leaves. A scan that fails doesn't undo what they said.
const rescan = (userId: string, client: PrismaClient, now: Date) =>
  scanSuggestions(userId, { client, now }).catch((error) =>
    log.error("Scanning after a tax correction failed", { error: String(error) }),
  );

export const isCorrectionKind = (kind: string): kind is TaxCorrectionKind =>
  (TAX_CORRECTION_KINDS as readonly string[]).includes(kind);

export async function addTaxCorrection(
  userId: string,
  correction: NewTaxCorrection,
  { client = defaultClient, now = new Date(), via }: Options,
): Promise<void> {
  const db = scopedFor(userId, client);
  const year = defaultTaxYear(await todayOf(userId, { client, now }));
  if ((await db.taxCorrections.count({ where: { year } })) >= TAX_CORRECTION_MAX_PER_YEAR)
    throw new TaxCorrectionError("That's as many as Jane can keep for a year. Undo one first.");
  let data: { payerKey: string | null; label: string; cents: number | null; paidTo: string | null };
  if (correction.kind === "not_income") {
    // Only a payer on this person's own calculation, with the name from their own deposits.
    const { soFar } = await loadTaxEstimate(userId, { client, now, year });
    const payer = soFar.payers.find((p) => p.key === correction.payerKey);
    if (!payer) throw new TaxCorrectionError("That payer isn't in your income.");
    data = { payerKey: payer.key, label: payer.label, cents: null, paidTo: null };
  } else {
    const { cents, kind } = correction;
    const positive = kind === "business_cost" || kind === "deduction" || kind === "paid";
    if (!Number.isInteger(cents) || cents < (positive ? 1 : 0) || cents > TAX_CORRECTION_MAX_CENTS)
      throw new TaxCorrectionError("Enter an amount in dollars.");
    data = {
      payerKey: null,
      label: (oneLine(correction.label ?? "") || WORDS[kind]).slice(0, TAX_CORRECTION_LABEL_MAX),
      cents,
      paidTo: correction.kind === "paid" ? correction.paidTo : null,
    };
  }
  if (ONE_PER_YEAR.includes(correction.kind))
    await db.taxCorrections.deleteMany({ where: { year, kind: correction.kind } });
  if (correction.kind === "not_income")
    await db.taxCorrections.upsert({
      where: {
        userId_year_kind_payerKey: {
          userId,
          year,
          kind: "not_income",
          payerKey: correction.payerKey,
        },
      },
      create: { userId, year, kind: correction.kind, ...data },
      update: {},
    });
  else await db.taxCorrections.create({ data: { userId, year, kind: correction.kind, ...data } });
  await logAudit(
    { type: "user", id: userId },
    "tax_correction_added",
    { type: "user", id: userId },
    { kind: correction.kind, year, via },
  );
  await track(userId, "tax_correction_added", { kind: correction.kind, via });
  await rescan(userId, client, now);
}

// Undo: the estimate goes back to what the accounts show.
export async function removeTaxCorrection(
  userId: string,
  id: string,
  { client = defaultClient, now = new Date(), via }: Options,
): Promise<void> {
  const db = scopedFor(userId, client);
  const row = await db.taxCorrections.findFirst({
    where: { id },
    select: { kind: true, year: true },
  });
  if (!row) throw new TaxCorrectionError("That's already gone.");
  await db.taxCorrections.deleteMany({ where: { id } });
  await logAudit(
    { type: "user", id: userId },
    "tax_correction_removed",
    { type: "user", id: userId },
    { kind: row.kind, year: row.year, via },
  );
  await track(userId, "tax_correction_removed", { kind: row.kind, via });
  await rescan(userId, client, now);
}
