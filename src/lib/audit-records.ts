import { GIVING } from "@/config/giving";
import { RECEIPT_MATCH_DAYS, RETENTION_YEARS_BACK } from "@/config/records";
import { TAX_TAGS, type TaxTagKind } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDeadline } from "@/lib/deadlines";
import { loadGiving, type GivingView } from "@/lib/giving";
import { loadHomeTaxes, type HomeTaxesView } from "@/lib/home-taxes";
import { loadTaxDocuments, type TaxDocumentsView } from "@/lib/tax-documents";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import { loadTaxTags, type TaxTagsView } from "@/lib/tax-organizer";
import {
  buildAuditPack,
  matchReceipt,
  retentionSchedule,
  type AuditItem,
  type AuditPack,
  type Evidence,
  type Retention,
} from "@/planning/audit-records";
import { homeOfficeDeduction, mileageDeduction } from "@/planning/self-employed";
import { isoDay as iso } from "@/lib/dates";

// Audit-ready records (spec step 171), loaded from the person's own accounts: every
// deduction and credit Jane counts, tied to its transactions, the receipts in their
// document vault, the forms it collected and their answers; an audit pack per year; and
// how long to keep each year's records, with a reminder before they can be thrown away.
// Jane never deletes anything.

type Options = { client?: PrismaClient; now?: Date };

export class AuditRecordsError extends Error {}

export type AuditRecordsView = AuditPack & {
  retention: Retention[];
  // Years whose records can go soon or now and have no reminder yet.
  due: Retention[];
};

const TAG_ITEMS: readonly TaxTagKind[] = [
  "donation",
  "medical",
  "childcare",
  "education",
  "business",
  "rental",
];
const TAG_KEY: Readonly<Record<string, string>> = {
  donation: "charity",
  medical: "medical",
  childcare: "childcare",
  education: "education",
  business: "business",
  rental: "rental",
};

export async function loadAuditRecords(
  userId: string,
  year: number,
  {
    client = defaultClient,
    now = new Date(),
    loaded = {},
  }: Options & {
    // What the Taxes page has already loaded for the same year, so it isn't loaded twice.
    loaded?: {
      estimate?: TaxEstimateView;
      tags?: TaxTagsView;
      giving?: GivingView;
      home?: HomeTaxesView;
      docs?: TaxDocumentsView;
    };
  } = {},
): Promise<AuditRecordsView> {
  const db = scopedFor(userId, client);
  const today = iso(now);
  const [estimate, tags, giving, home, docs, receipts, profile, first] = await Promise.all([
    loaded.estimate?.year === year
      ? loaded.estimate
      : loadTaxEstimate(userId, { client, now, year }),
    loaded.tags?.year === year ? loaded.tags : loadTaxTags(userId, year, { client }),
    loaded.giving ?? loadGiving(userId, { client, now }),
    loaded.home ?? loadHomeTaxes(userId, { client, now }),
    loaded.docs?.year === year ? loaded.docs : loadTaxDocuments(userId, year, { client, now }),
    db.documents.findMany({
      where: { kind: "receipt" },
      select: { id: true, fileName: true, purchaseDate: true, purchaseAmountCents: true },
      orderBy: [{ fileName: "asc" }, { id: "asc" }],
    }),
    db.taxProfiles.findFirst({
      select: {
        homeOfficeSqFt: true,
        businessMiles: true,
        businessMilesYear: true,
        retentionReminded: true,
      },
    }),
    db.transactions.findFirst({ select: { date: true }, orderBy: { date: "asc" } }),
  ]);
  const vault = receipts.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    date: r.purchaseDate ? iso(r.purchaseDate) : null,
    cents: r.purchaseAmountCents,
  }));
  const receipted = new Set(giving.gifts.filter((g) => g.receipted).map((g) => g.transactionId));
  const candidates: AuditItem[] = [];

  // The tagged spending: each charge with the receipt in the vault that matches it.
  for (const tag of TAG_ITEMS) {
    const rows = tags.tagged.filter((t) => t.tag === tag);
    const evidence: Evidence[] = [];
    const needs: string[] = [];
    for (const t of rows) {
      const match = matchReceipt({ date: t.date, cents: t.amountCents }, vault, RECEIPT_MATCH_DAYS);
      const confirmed = tag === "donation" && receipted.has(t.id);
      evidence.push({
        kind: "transaction",
        id: t.id,
        date: t.date,
        payee: t.payee,
        cents: t.amountCents,
        receipt: Boolean(match) || confirmed,
      });
      if (match) evidence.push({ kind: "receipt", id: match.id, fileName: match.fileName });
      if (tag === "donation" && t.amountCents >= GIVING.receiptFromCents && !match && !confirmed) {
        needs.push(`The charity's receipt for your gift to ${t.payee}.`);
      }
    }
    candidates.push({
      key: TAG_KEY[tag],
      label: TAX_TAGS[tag].plural.replace(/^./, (c) => c.toUpperCase()),
      claimedCents: rows.reduce((s, t) => s + t.amountCents, 0),
      evidence,
      needs,
    });
  }

  // Home: mortgage interest, property tax, energy work, each with its own sources.
  const fromFigure = (
    key: string,
    label: string,
    f: { cents: number; sources: HomeSource[] } | null,
  ) => {
    if (!f) return;
    candidates.push({
      key,
      label,
      claimedCents: f.cents,
      evidence: f.sources.flatMap(homeEvidence),
      needs: [],
    });
  };
  fromFigure("mortgage_interest", "Mortgage interest", home.mortgageInterest);
  fromFigure("property_tax", "Property tax", home.propertyTax);
  for (const e of home.energy.filter((e) => e.cents > 0)) fromFigure("energy", e.label, e);

  // Student loan interest: the lender's 1098-E when collected and usable, else the loan.
  const student = docs.forms.find((f) => f.formKey === "student" && f.document && f.usable);
  if (estimate.input.studentLoanInterestCents > 0) {
    candidates.push({
      key: "student_loan_interest",
      label: "Student loan interest",
      claimedCents: estimate.input.studentLoanInterestCents,
      evidence: student
        ? [
            {
              kind: "form",
              key: student.key,
              form: student.form,
              from: student.from,
              cents: student.document!.boxes.interest ?? 0,
            },
          ]
        : [
            {
              kind: "loan",
              name: "Your student loan",
              cents: estimate.input.studentLoanInterestCents,
            },
          ],
      needs: student ? [] : ["The lender's 1098-E when it arrives."],
    });
  }

  // Self-employment: the home office and miles are the person's own answers.
  if (profile?.homeOfficeSqFt) {
    candidates.push({
      key: "home_office",
      label: "Home office",
      claimedCents: homeOfficeDeduction(profile.homeOfficeSqFt),
      evidence: [
        { kind: "answer", label: `${profile.homeOfficeSqFt} square feet, on your tax profile` },
      ],
      needs: ["A floor plan or photo of the space used only for work."],
    });
  }
  if (profile?.businessMilesYear === year && profile.businessMiles) {
    candidates.push({
      key: "mileage",
      label: "Business miles",
      claimedCents: mileageDeduction(profile.businessMiles),
      evidence: [{ kind: "answer", label: `${profile.businessMiles} miles, in your mileage log` }],
      needs: ["A log of dates, places and reasons for each trip."],
    });
  }

  const pack = buildAuditPack(year, candidates);
  const firstYear = first ? first.date.getUTCFullYear() : year;
  const years = Array.from(
    { length: Math.min(RETENTION_YEARS_BACK, year - firstYear + 1) },
    (_, i) => year - i,
  );
  const retention = retentionSchedule(years, today);
  const reminded = new Set(profile?.retentionReminded ?? []);
  return {
    ...pack,
    retention,
    due: retention.filter((r) => r.status !== "keep" && !reminded.has(String(r.year))),
  };
}

type HomeSource = Parameters<typeof homeEvidence>[0];
function homeEvidence(
  s:
    | { kind: "transaction"; id: string; date: string; payee: string; cents: number }
    | { kind: "loan"; name: string; cents: number }
    | { kind: "document"; key: string; form: string; from: string; cents: number }
    | { kind: "answer"; label: string },
): Evidence[] {
  switch (s.kind) {
    case "transaction":
      return [{ ...s, receipt: false }];
    case "loan":
      return [s];
    case "document":
      return [{ kind: "form", key: s.key, form: s.form, from: s.from, cents: s.cents }];
    case "answer":
      return [s];
  }
}

// "Remind me": a reminder on the deadlines a month before a year's records can go. Jane
// doesn't delete anything; the person decides what to throw away.
export async function remindRetention(
  userId: string,
  year: number,
  {
    client = defaultClient,
    now = new Date(),
    via,
  }: Options & { via: "chat" | "page" | "autopilot" },
): Promise<Retention> {
  const view = await loadAuditRecords(userId, new Date(now).getUTCFullYear(), { client, now });
  const r = view.retention.find((x) => x.year === year);
  if (!r) throw new AuditRecordsError("That year isn't on your list.");
  const today = iso(now);
  const dueOn = r.status === "can_go" ? today : r.keepUntil;
  await addDeadline(
    userId,
    {
      title: `Records for your ${year} taxes can go after ${r.keepUntil}`,
      dueOn,
      kind: "other",
      note: `${r.rule} Check nothing's needed for a later year before you throw anything away.`,
    },
    { client, now },
  );
  const db = scopedFor(userId, client);
  const existing = await db.taxProfiles.findFirst({ select: { retentionReminded: true } });
  const retentionReminded = [...new Set([...(existing?.retentionReminded ?? []), String(year)])];
  await db.taxProfiles.upsert({
    where: { userId },
    create: { userId, retentionReminded },
    update: { retentionReminded },
  });
  await track(userId, "records_retention_reminded", { via });
  return r;
}

// At the levels that let Jane act: a reminder for every year whose records can go soon.
export async function remindDueRecords(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const view = await loadAuditRecords(userId, now.getUTCFullYear(), { client, now });
  for (const r of view.due)
    await remindRetention(userId, r.year, { client, now, via: "autopilot" });
  return view.due.length;
}
