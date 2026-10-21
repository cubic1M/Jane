import {
  AUTHORIZED_USER,
  COSIGNING,
  FAMILY_KINDS,
  FIRST_CARD,
  PERSON_MAX,
  type FamilyKind,
} from "@/config/family-credit";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadDebtTrouble } from "@/lib/debt-trouble";
import {
  authorizedUser,
  cosignEffect,
  fileStartSavingCents,
  type AuView,
  type CosignView,
} from "@/planning/family-credit";

// Helping family with credit (spec step 249), for one person: their cards as places to add
// someone (what it does to both scores), a first card for a student, and loans they co-signed
// with what it does to their own debt load. What each does to credit is a fact or a stated
// range; whether to do it is the person's (and, for the legal side, a lawyer's). Jane applies
// for nothing and contacts no one.

type Options = { client?: PrismaClient; now?: Date };

export class FamilyCreditError extends Error {}

export type CardView = {
  accountId: string;
  name: string;
  balanceCents: number;
  limitCents: number | null;
  au: AuView;
};

export type FamilyEntry = {
  id: string;
  kind: FamilyKind;
  person: string;
  debtKey: string | null;
  balanceCents: number | null;
  monthlyPaymentCents: number | null;
  missed: boolean;
};

export type FamilyCredit = {
  advice: boolean;
  cards: CardView[];
  entries: FamilyEntry[];
  // The best card to add someone to: the lowest use, with a limit.
  bestCard: CardView | null;
  cosign: CosignView;
  // Co-signed loans where the other person missed a payment.
  missed: FamilyEntry[];
  // What starting a young person's file is worth, a guess stated in config.
  fileStartCents: number;
  firstCard: typeof FIRST_CARD;
  authorizedUser: typeof AUTHORIZED_USER;
  cosigning: typeof COSIGNING;
};

export async function loadFamilyCredit(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<FamilyCredit> {
  const db = scopedFor(userId, client);
  const [accounts, rows, advice, trouble, report] = await Promise.all([
    db.accounts.findMany({
      where: { type: "credit" },
      select: { id: true, name: true, currentBalanceCents: true, availableBalanceCents: true },
    }),
    db.familyCredit.findMany({ orderBy: { createdAt: "asc" } }),
    adviceMode(userId, { client }),
    loadDebtTrouble(userId, { client, now }),
    db.creditReports.findFirst({
      orderBy: [{ pulledOn: "desc" }, { createdAt: "desc" }],
      select: { cardLimitCents: true },
    }),
  ]);
  const cards: CardView[] = accounts
    .map((a) => {
      const balanceCents = Math.max(0, a.currentBalanceCents ?? 0);
      // A card's limit is known from its available credit, or, with one card, from the credit
      // report's total limit.
      const limitCents =
        a.currentBalanceCents != null && a.availableBalanceCents != null
          ? a.currentBalanceCents + a.availableBalanceCents
          : accounts.length === 1
            ? (report?.cardLimitCents ?? null)
            : null;
      return {
        accountId: a.id,
        name: a.name,
        balanceCents,
        limitCents,
        au: authorizedUser({ balanceCents, limitCents }),
      };
    })
    .sort((a, b) => (a.au.utilisation ?? 9) - (b.au.utilisation ?? 9));
  const entries: FamilyEntry[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind as FamilyKind,
    person: r.person,
    debtKey: r.debtKey,
    balanceCents: r.balanceCents,
    monthlyPaymentCents: r.monthlyPaymentCents,
    missed: r.missed,
  }));
  const cosigned = entries.filter((e) => e.kind === "cosigned");
  return {
    advice,
    cards,
    entries,
    bestCard: cards.find((c) => c.au.safe) ?? null,
    cosign: cosignEffect({
      incomeCents: trouble.incomeCents,
      paymentsCents: trouble.monthlyPaymentsCents,
      cosigned,
    }),
    missed: cosigned.filter((e) => e.missed),
    fileStartCents: fileStartSavingCents(),
    firstCard: FIRST_CARD,
    authorizedUser: AUTHORIZED_USER,
    cosigning: COSIGNING,
  };
}

export type FamilyInput = {
  kind: string;
  person: string;
  debtKey?: string | null;
  balanceCents?: number | null;
  monthlyPaymentCents?: number | null;
};

export async function addFamilyCredit(
  userId: string,
  input: FamilyInput,
  { client = defaultClient }: Options = {},
): Promise<string> {
  if (!(FAMILY_KINDS as readonly string[]).includes(input.kind)) {
    throw new FamilyCreditError("Pick what you're doing for them.");
  }
  const person = input.person.trim().slice(0, PERSON_MAX);
  if (!person) throw new FamilyCreditError("Who is it for?");
  const money = (c: number | null | undefined, label: string) => {
    if (c == null) return null;
    if (!Number.isInteger(c) || c < 0)
      throw new FamilyCreditError(`${label} should be a dollar amount.`);
    return c;
  };
  const balanceCents = money(input.balanceCents, "What's owed");
  const monthlyPaymentCents = money(input.monthlyPaymentCents, "The payment");
  if (input.kind === "cosigned" && balanceCents === null && monthlyPaymentCents === null) {
    throw new FamilyCreditError("Give what's owed or the monthly payment, so I can count it.");
  }
  const row = await client.familyCreditHelp.create({
    data: {
      userId,
      kind: input.kind,
      person,
      debtKey: input.kind === "authorized_user" ? (input.debtKey ?? null) : null,
      balanceCents: input.kind === "cosigned" ? balanceCents : null,
      monthlyPaymentCents: input.kind === "cosigned" ? monthlyPaymentCents : null,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "family_credit_changed",
    { type: "family_credit", id: row.id },
    {
      kind: input.kind,
      change: "added",
    },
  );
  return row.id;
}

export async function setMissed(
  userId: string,
  id: string,
  missed: boolean,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const done = await client.familyCreditHelp.updateMany({
    where: { id, userId, kind: "cosigned" },
    data: { missed },
  });
  if (done.count === 0) throw new FamilyCreditError("I can't find that loan.");
  await logAudit(
    { type: "user", id: userId },
    "family_credit_changed",
    { type: "family_credit", id },
    {
      change: missed ? "missed" : "caught_up",
    },
  );
}

export async function removeFamilyCredit(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const done = await client.familyCreditHelp.deleteMany({ where: { id, userId } });
  if (done.count === 0) throw new FamilyCreditError("I can't find that one.");
  await logAudit(
    { type: "user", id: userId },
    "family_credit_changed",
    { type: "family_credit", id },
    {
      change: "removed",
    },
  );
}
