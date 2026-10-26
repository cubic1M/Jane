import {
  BENEFICIARY_EVENTS,
  ESTATE_FACTS,
  ESTATE_POINTER,
  FILE_SECTIONS,
  RELATIONSHIPS,
  type BeneficiaryEvent,
  type FileSection,
} from "@/config/family-file";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import {
  buildFile,
  checkAccounts,
  needsAttention,
  type AccountCheck,
  type BeneficiaryRow,
  type ContactRow,
  type LifeEventRow,
} from "@/planning/family-file";
import { isoDay as iso } from "@/lib/dates";

// The family looked after (spec step 237): who is named on each account, what a marriage,
// divorce or birth makes out of date, and a file of what the family would need that the person
// shares in part. Nothing here moves money or changes an account: Jane records what the person
// says and tells them where the form is. No legal advice: wills and trusts are facts and a
// pointer to a lawyer (src/config/family-file.ts).

type Options = { client?: PrismaClient; now?: Date };

export class FamilyFileError extends Error {}

const isSection = (k: string): k is FileSection => Object.hasOwn(FILE_SECTIONS, k);
const isEvent = (k: string): k is BeneficiaryEvent => Object.hasOwn(BENEFICIARY_EVENTS, k);

export type FamilyFileView = {
  checks: AccountCheck[];
  attention: AccountCheck[];
  rows: BeneficiaryRow[];
  events: LifeEventRow[];
  picks: FileSection[];
  contacts: ContactRow[];
  documents: string;
  facts: readonly string[];
  pointer: string;
};

async function accountsOf(userId: string, client: PrismaClient) {
  return scopedFor(userId, client).accounts.findMany({
    where: { type: { in: ["depository", "investment"] } },
    select: { id: true, name: true, mask: true, subtype: true },
    orderBy: { name: "asc" },
  });
}

export async function loadFamilyFile(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<FamilyFileView> {
  const db = scopedFor(userId, client);
  const [accounts, beneficiaries, file, babies] = await Promise.all([
    accountsOf(userId, client),
    db.accountBeneficiaries.findMany({ orderBy: { createdAt: "asc" } }),
    db.familyFiles.findFirst({}),
    db.lifeEvents.findMany({ where: { kind: "new_baby" }, select: { startedOn: true } }),
  ]);
  const rows: BeneficiaryRow[] = beneficiaries.map((b) => ({
    accountId: b.accountId,
    name: b.name,
    relationship: b.relationship,
    sharePct: b.sharePct,
    tier: b.tier === "contingent" ? "contingent" : "primary",
    confirmedOn: iso(b.confirmedOn),
  }));
  const told = (Array.isArray(file?.events) ? (file!.events as { kind: string; on: string }[]) : [])
    .filter((e) => isEvent(e.kind))
    .map((e) => ({ kind: e.kind as BeneficiaryEvent, on: e.on }));
  const events: LifeEventRow[] = [
    ...told,
    ...babies.map((b) => ({ kind: "birth" as const, on: iso(b.startedOn) })),
  ];
  const checks = checkAccounts(accounts, rows, events);
  return {
    checks,
    attention: needsAttention(checks),
    rows,
    events,
    picks: (file?.picks ?? []).filter(isSection),
    contacts: Array.isArray(file?.contacts) ? (file!.contacts as ContactRow[]) : [],
    documents: file?.documents ?? "",
    facts: ESTATE_FACTS,
    pointer: ESTATE_POINTER,
  };
}

export type NameInput = {
  name: string;
  relationship: string;
  sharePct: number;
  tier: "primary" | "contingent";
};

// The names the person gave for one account, replacing what was there. Shares of the primary
// names must add up to 100.
export async function saveBeneficiaries(
  userId: string,
  accountId: string,
  names: NameInput[],
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const db = scopedFor(userId, client);
  const account = await db.accounts.findFirst({ where: { id: accountId }, select: { id: true } });
  if (!account) throw new FamilyFileError("That account isn't yours.");
  const clean = names
    .map((n) => ({
      name: n.name.trim().slice(0, 80),
      relationship: (RELATIONSHIPS as readonly string[]).includes(n.relationship)
        ? n.relationship
        : "other",
      sharePct: Math.round(n.sharePct),
      tier: n.tier === "contingent" ? "contingent" : "primary",
    }))
    .filter((n) => n.name !== "");
  const primary = clean.filter((n) => n.tier === "primary");
  if (clean.length > 0 && primary.reduce((s, n) => s + n.sharePct, 0) !== 100) {
    throw new FamilyFileError("The shares of the main names need to add up to 100.");
  }
  await db.accountBeneficiaries.deleteMany({ where: { accountId } });
  for (const n of clean) {
    await db.accountBeneficiaries.create({
      data: { userId, accountId, ...n, confirmedOn: new Date(`${iso(now)}T00:00:00Z`) },
    });
  }
  await logAudit(
    { type: "user", id: userId },
    "beneficiary_saved",
    { type: "account", id: accountId },
    {
      names: clean.length,
    },
  );
  await track(userId, "beneficiary_saved", { names: clean.length });
}

// "These are still right": the names stay, and the day moves forward.
export async function confirmBeneficiaries(
  userId: string,
  accountId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const { count } = await scopedFor(userId, client).accountBeneficiaries.updateMany({
    where: { accountId },
    data: { confirmedOn: new Date(`${iso(now)}T00:00:00Z`) },
  });
  if (count === 0) throw new FamilyFileError("Nobody is named on that account yet.");
  await logAudit(
    { type: "user", id: userId },
    "beneficiary_saved",
    { type: "account", id: accountId },
    {
      confirmed: true,
    },
  );
}

async function upsertFile(
  userId: string,
  data: { events?: object; picks?: string[]; contacts?: object; documents?: string },
  client: PrismaClient,
) {
  await client.familyFile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

export async function recordEvent(
  userId: string,
  kind: string,
  on: string,
  { client = defaultClient }: Options = {},
) {
  if (!isEvent(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(on))
    throw new FamilyFileError("Pick what happened and when.");
  const file = await scopedFor(userId, client).familyFiles.findFirst({});
  const existing = Array.isArray(file?.events) ? (file!.events as object[]) : [];
  await upsertFile(userId, { events: [...existing, { kind, on }] }, client);
}

export async function savePicks(
  userId: string,
  picks: string[],
  { client = defaultClient }: Options = {},
) {
  const clean = [...new Set(picks)].filter(isSection);
  await upsertFile(userId, { picks: clean }, client);
  await logAudit(
    { type: "user", id: userId },
    "family_file_picked",
    { type: "user", id: userId },
    {
      sections: clean.join(","),
    },
  );
}

export async function saveContacts(
  userId: string,
  contacts: ContactRow[],
  documents: string,
  { client = defaultClient }: Options = {},
) {
  const clean = contacts
    .map((c) => ({
      name: c.name.trim().slice(0, 80),
      role: c.role.trim().slice(0, 40),
      phone: c.phone?.trim().slice(0, 30) || null,
      email: c.email?.trim().slice(0, 120) || null,
    }))
    .filter((c) => c.name !== "");
  await upsertFile(userId, { contacts: clean, documents: documents.slice(0, 1000) }, client);
}

// The file as text, with only the sections picked.
export async function exportFamilyFile(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<string> {
  const view = await loadFamilyFile(userId, { client });
  const accounts = await accountsOf(userId, client);
  await logAudit(
    { type: "user", id: userId },
    "family_file_exported",
    { type: "user", id: userId },
    {
      sections: view.picks.join(","),
    },
  );
  await track(userId, "family_file_exported", { sections: view.picks.length });
  return buildFile(
    view.picks,
    { accounts, checks: view.checks, contacts: view.contacts, documents: view.documents },
    iso(now),
  );
}
