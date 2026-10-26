import {
  INCOME_KIND_ORDER,
  MAX_DEPENDANTS,
  TAX_PROFILE_LOOKBACK_DAYS,
  isFilingStatus,
  isIncomeKind,
  usesFoundAnswers,
  type FilingStatus,
  type IncomeKind,
} from "@/config/tax";
import { isStateCode } from "@/config/referrals";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { autopilotFor, type SectorAutopilot } from "@/lib/sector-autopilot";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { readPeople } from "@/lib/insurance/family-rules";
import {
  findTaxFacts,
  taxProfileView,
  workingProfile,
  type FoundFacts,
  type ProfileField,
  type StoredTaxProfile,
  type TaxProfileView,
  type WorkingProfile,
} from "@/planning/tax-profile";
import { DAY_MS, isoDay as iso } from "@/lib/dates";

// The tax profile (spec step 118): loads what Jane found in the person's own accounts and
// what they told it, and saves their answers. Always for one person, through scopedFor.

type Options = { client?: PrismaClient; now?: Date };

export class TaxProfileError extends Error {}

const PROFILE_SELECT = {
  filingStatus: true,
  childrenUnder17: true,
  otherDependants: true,
  state: true,
  incomeKinds: true,
  answered: true,
} as const;

export async function loadTaxFacts(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ found: FoundFacts; stored: StoredTaxProfile | null }> {
  const db = scopedFor(userId, client);
  const since = new Date(Date.parse(`${iso(now)}T00:00:00Z`) - TAX_PROFILE_LOOKBACK_DAYS * DAY_MS);
  const [transactions, accounts, user, newBaby, stored, insurance] = await Promise.all([
    db.transactions.findMany({
      where: { pending: false, date: { gte: since } },
      select: {
        date: true,
        amountCents: true,
        pfcDetailed: true,
        description: true,
        merchantName: true,
      },
    }),
    db.accounts.findMany({ select: { name: true, type: true, subtype: true } }),
    // The person's own settings: users have their own helpers, so a direct read by id.
    client.user.findUnique({ where: { id: userId }, select: { state: true } }),
    db.lifeEvents.count({ where: { kind: "new_baby" } }),
    db.taxProfiles.findFirst({ select: PROFILE_SELECT }),
    // The household listed for insurance: the children in it are the dependants Jane offers.
    db.insuranceProfiles.findFirst({ select: { people: true } }),
  ]);
  return {
    found: findTaxFacts({
      transactions: transactions.map((t) => ({ ...t, date: iso(t.date) })),
      accounts,
      settingsState: user?.state ?? null,
      newBaby: newBaby > 0,
      household: readPeople(insurance?.people),
    }),
    stored,
  };
}

export async function loadTaxProfile(
  userId: string,
  options: Options = {},
): Promise<TaxProfileView> {
  const { found, stored } = await loadTaxFacts(userId, options);
  return taxProfileView(stored, found);
}

// The profile Jane works with at the Taxes area's autopilot level (spec step 141,
// src/config/tax.ts usesFoundAnswers), and that setting, for saying what it does on its own.
export async function loadWorkingProfile(
  userId: string,
  options: Options = {},
): Promise<{ view: TaxProfileView; profile: WorkingProfile; taxes: SectorAutopilot }> {
  const [view, taxes] = await Promise.all([
    loadTaxProfile(userId, options),
    autopilotFor(userId, "taxes", { client: options.client ?? defaultClient, now: options.now }),
  ]);
  return { view, profile: workingProfile(view, usesFoundAnswers(taxes.level)), taxes };
}

// One answer, as the person gave it. Checked here, whatever the page or chat sent.
export type TaxAnswer =
  | { field: "filingStatus"; value: FilingStatus }
  | { field: "dependants"; childrenUnder17: number; otherDependants: number }
  | { field: "state"; value: string }
  | { field: "incomeKinds"; value: IncomeKind[] };

function check(answer: TaxAnswer): TaxAnswer {
  switch (answer.field) {
    case "filingStatus":
      if (!isFilingStatus(answer.value)) throw new TaxProfileError("Pick a filing status.");
      return answer;
    case "dependants": {
      const ok = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_DEPENDANTS;
      if (!ok(answer.childrenUnder17) || !ok(answer.otherDependants)) {
        throw new TaxProfileError(`Dependants must be a whole number from 0 to ${MAX_DEPENDANTS}.`);
      }
      return answer;
    }
    case "state":
      if (!isStateCode(answer.value)) throw new TaxProfileError("Pick a state from the list.");
      return answer;
    case "incomeKinds":
      if (!answer.value.every(isIncomeKind)) throw new TaxProfileError("Pick from the list.");
      // In the usual order, once each.
      return {
        field: "incomeKinds",
        value: INCOME_KIND_ORDER.filter((k) => answer.value.includes(k)),
      };
  }
}

function dataOf(answer: TaxAnswer) {
  switch (answer.field) {
    case "filingStatus":
      return { filingStatus: answer.value };
    case "dependants":
      return { childrenUnder17: answer.childrenUnder17, otherDependants: answer.otherDependants };
    case "state":
      return { state: answer.value };
    case "incomeKinds":
      return { incomeKinds: answer.value };
  }
}

// Saves answers (one from the chat, all of them from the page) and marks them answered.
export async function saveTaxAnswers(
  userId: string,
  answers: TaxAnswer[],
  { client = defaultClient, via }: { client?: PrismaClient; via: "chat" | "page" },
): Promise<void> {
  const checked = answers.map(check);
  if (checked.length === 0) return;
  const db = scopedFor(userId, client);
  const existing = await db.taxProfiles.findFirst({ select: { answered: true } });
  const fields = checked.map((a) => a.field);
  const data = Object.assign({}, ...checked.map(dataOf));
  const answered = [...new Set([...(existing?.answered ?? []), ...fields])];
  await db.taxProfiles.upsert({
    where: { userId },
    create: { userId, ...data, answered },
    update: { ...data, answered },
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_profile_changed",
    { type: "user", id: userId },
    // Which fields, never the answers.
    { fields: fields.join(","), via },
  );
  await track(userId, "tax_profile_answered", { fields: fields.join(","), via });
}

// "That's right" on what Jane found: saves what it showed as the person's answer.
export async function confirmFound(
  userId: string,
  field: Extract<ProfileField, "incomeKinds" | "state" | "dependants">,
  options: Options & { via: "chat" | "page" },
): Promise<TaxProfileView> {
  const view = await loadTaxProfile(userId, options);
  // "Yes, these are my dependants": the children in the household listed for insurance.
  if (field === "dependants") {
    const d = view.dependants;
    if (d.status !== "found" || d.childrenUnder17 === null || d.otherDependants === null) {
      throw new TaxProfileError(
        "There are no dependants to confirm. Add them on your tax profile.",
      );
    }
    await saveTaxAnswers(
      userId,
      [{ field, childrenUnder17: d.childrenUnder17, otherDependants: d.otherDependants }],
      options,
    );
    return loadTaxProfile(userId, options);
  }
  if (field === "state") {
    if (view.state.status !== "found" || !view.state.value) {
      throw new TaxProfileError("There's no state to confirm. Pick one on your tax profile.");
    }
    await saveTaxAnswers(userId, [{ field, value: view.state.value }], options);
  } else {
    if (view.incomeKinds.status !== "found") {
      throw new TaxProfileError("Your income is already on your profile.");
    }
    await saveTaxAnswers(userId, [{ field, value: view.incomeKinds.value }], options);
  }
  return loadTaxProfile(userId, options);
}

// "Add it" on a new kind of income Jane saw.
export async function addIncomeKind(
  userId: string,
  kind: string,
  options: Options & { via: "chat" | "page" },
): Promise<void> {
  if (!isIncomeKind(kind)) throw new TaxProfileError("Pick from the list.");
  const view = await loadTaxProfile(userId, options);
  if (view.incomeKinds.value.includes(kind) && view.incomeKinds.status === "yours") {
    throw new TaxProfileError("That's already on your profile.");
  }
  await saveTaxAnswers(
    userId,
    [{ field: "incomeKinds", value: [...view.incomeKinds.value, kind] }],
    options,
  );
}

// Spec step 120: the year-to-date figures from the person's latest pay stub, for when
// there's no payroll connection. All amounts are whole cents, none negative; the date is
// the pay stub's, not in the future.
export type PayStubEntry = {
  asOf: string;
  grossCents: number;
  federalCents: number;
  stateCents: number;
  retirementCents: number;
  pretaxCents: number;
};

export async function savePayStub(
  userId: string,
  entry: PayStubEntry | null,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<void> {
  if (entry) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.asOf) || Number.isNaN(Date.parse(entry.asOf))) {
      throw new TaxProfileError("Give the pay stub's date.");
    }
    if (entry.asOf > iso(now))
      throw new TaxProfileError("The pay stub's date can't be in the future.");
    const amounts = [
      entry.grossCents,
      entry.federalCents,
      entry.stateCents,
      entry.retirementCents,
      entry.pretaxCents,
    ];
    if (amounts.some((c) => !Number.isInteger(c) || c < 0)) {
      throw new TaxProfileError("Amounts must be dollars and cents, none below zero.");
    }
    if (entry.retirementCents + entry.pretaxCents + entry.federalCents > entry.grossCents) {
      throw new TaxProfileError(
        "The deductions add up to more than the gross pay. Check the figures.",
      );
    }
  }
  const data = {
    payAsOf: entry ? new Date(`${entry.asOf}T00:00:00Z`) : null,
    payGrossYtdCents: entry?.grossCents ?? null,
    payFederalYtdCents: entry?.federalCents ?? null,
    payStateYtdCents: entry?.stateCents ?? null,
    payRetirementYtdCents: entry?.retirementCents ?? null,
    payPretaxYtdCents: entry?.pretaxCents ?? null,
  };
  await scopedFor(userId, client).taxProfiles.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_profile_changed",
    { type: "user", id: userId },
    { fields: "payStub", via },
  );
  await track(userId, "tax_pay_stub_saved", { via, cleared: entry === null });
}
