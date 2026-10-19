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
import { autopilotOf } from "@/lib/autopilot";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
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

// The tax profile (spec step 118): loads what Jane found in the person's own accounts and
// what they told her, and saves their answers. Always for one person, through scopedFor.

type Options = { client?: PrismaClient; now?: Date };

export class TaxProfileError extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (date: Date) => date.toISOString().slice(0, 10);

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
  const [transactions, accounts, user, newBaby, stored] = await Promise.all([
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
  ]);
  return {
    found: findTaxFacts({
      transactions: transactions.map((t) => ({ ...t, date: iso(t.date) })),
      accounts,
      settingsState: user?.state ?? null,
      newBaby: newBaby > 0,
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

// The profile Jane works with at the person's autopilot level (src/config/tax.ts).
export async function loadWorkingProfile(
  userId: string,
  options: Options = {},
): Promise<{ view: TaxProfileView; profile: WorkingProfile; autopilot: string | null }> {
  const [view, autopilot] = await Promise.all([
    loadTaxProfile(userId, options),
    autopilotOf(userId, { client: options.client ?? defaultClient }),
  ]);
  return { view, profile: workingProfile(view, usesFoundAnswers(autopilot)), autopilot };
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

// "That's right" on what Jane found: saves what she showed as the person's answer.
export async function confirmFound(
  userId: string,
  field: Extract<ProfileField, "incomeKinds" | "state">,
  options: Options & { via: "chat" | "page" },
): Promise<TaxProfileView> {
  const view = await loadTaxProfile(userId, options);
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
