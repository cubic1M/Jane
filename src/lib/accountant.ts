import { createHash, randomBytes } from "node:crypto";
import {
  ANSWER_MAX,
  DEFAULT_LINK_DAYS,
  LABEL_MAX,
  LARGE_GAINS_CENTS,
  LINK_DAYS_CHOICES,
  MAX_ACTIVE_LINKS,
  MAX_NOTES_PER_LINK,
  NAME_MAX,
} from "@/config/accountant";
import { NOTICE_KINDS } from "@/config/tax-notices";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { dayLabel } from "@/lib/day-label";
import { appBase } from "@/lib/digest/links";
import { formatCents } from "@/lib/money";
import { loadAuditRecords } from "@/lib/audit-records";
import { loadEquityTax, type EquityTaxView } from "@/lib/equity-tax";
import { loadSideIncome, type SideIncomeView } from "@/lib/side-income";
import { loadIdentity, type IdentityView } from "@/lib/tax-identity";
import { loadTaxDocuments } from "@/lib/tax-documents";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import { listTaxNotices, type NoticeView } from "@/lib/tax-notices";
import { loadTaxPack } from "@/lib/tax-pack";
import { complexity, linkState, type LinkState, type Question } from "@/planning/accountant";
import type { TaxPack } from "@/planning/tax-pack";
import { DAY_MS, isoDay as iso } from "@/lib/dates";

// Working with an accountant (spec step 222): a read-only link with the tax pack, the
// documents Jane collected, the questions it has and a place to answer them; the answers
// come back into Jane. The link holds only tax data, expires, can be revoked, and every view
// is in the audit log. Jane never sends anything to the accountant itself: the person makes
// the link and shares it.

type Options = { client?: PrismaClient; now?: Date };

export class AccountantError extends Error {}

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

export type LinkView = {
  id: string;
  label: string;
  state: LinkState;
  expiresOn: string;
  viewCount: number;
  lastViewedAt: string | null;
};

export type NoteView = {
  id: string;
  fromName: string;
  questionText: string | null;
  body: string;
  seen: boolean;
  createdAt: string;
};

export type AccountantPageView = {
  year: number;
  links: LinkView[];
  activeCount: number;
  notes: NoteView[];
  unseen: number;
  complexity: ReturnType<typeof complexity>;
  questions: Question[];
};

// The questions Jane has for an accountant, from what it found: deductions missing their
// proof, a form that doesn't match the accounts, side income not yet called a business or a
// hobby, and a letter still open.
export async function loadQuestions(
  userId: string,
  year: number,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Question[]> {
  const [records, docs, side, notices] = await Promise.all([
    loadAuditRecords(userId, year, { client, now }),
    loadTaxDocuments(userId, year, { client, now }),
    loadSideIncome(userId, { client, now }),
    listTaxNotices(userId, { client }),
  ]);
  const out: Question[] = [];
  for (const item of records.items) {
    if (item.needs.length === 0) continue;
    out.push({
      key: `need:${item.key}`,
      text: `${item.label} (${formatCents(item.claimedCents)}) is still missing: ${item.needs.join(" ")} Is what's there enough to support it?`,
    });
  }
  for (const f of docs.flagged) {
    out.push({
      key: `form:${f.key}`,
      text: `The ${f.form} from ${f.from} is ${formatCents(Math.abs(f.check?.diffCents ?? 0))} apart from the accounts. Which figure should the return use?`,
    });
  }
  if (side.kind === null && (side.gigCents > 0 || side.bothWays)) {
    out.push({
      key: "side_kind",
      text: "Is the side income a business or a hobby? Jane has worked out the tax both ways.",
    });
  }
  for (const n of notices) {
    if (n.status !== "confirmed" || n.handledBy) continue;
    out.push({
      key: `notice:${n.id}`,
      text: `A ${NOTICE_KINDS[n.kind].title} letter is open${n.dueOn ? `, due ${dayLabel(n.dueOn, { year: true })}` : ""}. Should the response be to agree, pay or dispute?`,
    });
  }
  return out;
}

// Whether the return is the kind people usually bring an accountant to: facts only.
// What a caller that already loaded these (Jane's snapshot) passes in, so they are not loaded
// twice.
export type ComplexityLoaded = {
  estimate: TaxEstimateView;
  advice: boolean;
  equity?: EquityTaxView;
  identity?: IdentityView;
  notices?: NoticeView[];
  side?: SideIncomeView;
};

export async function loadComplexity(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: ComplexityLoaded } = {},
): Promise<ReturnType<typeof complexity>> {
  const estimate = loaded?.estimate ?? (await loadTaxEstimate(userId, { client, now }));
  const db = scopedFor(userId, client);
  const advice = loaded ? loaded.advice : await adviceMode(userId, { client });
  const [equity, identity, notices, profile, side] = await Promise.all([
    loaded?.equity ?? loadEquityTax(userId, { client, now, loaded: { estimate, advice } }),
    loaded?.identity ?? loadIdentity(userId, { client, now }),
    loaded?.notices ?? listTaxNotices(userId, { client }),
    db.taxProfiles.findFirst({ select: { homeSoldOn: true } }),
    loaded?.side ?? loadSideIncome(userId, { client, now, loaded: { estimate } }),
  ]);
  const i = estimate.input;
  const r = i.residency;
  return complexity({
    self_employed: i.income.selfEmploymentCents > 0 || side.gigCents > 0,
    rental: side.rental !== null,
    equity: equity.income.events.length > 0 || equity.income.crypto.yearSales.length > 0,
    states: Boolean(r && (r.moves.length > 0 || r.workState)),
    home_sale: Boolean(
      profile?.homeSoldOn && iso(profile.homeSoldOn).startsWith(String(estimate.year)),
    ),
    notice: notices.some((n) => n.status === "confirmed" && !n.handledBy),
    identity: identity.case !== null,
    gains: i.income.shortTermGainsCents + i.income.longTermGainsCents >= LARGE_GAINS_CENTS,
  });
}

export async function loadAccountantPage(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
    withQuestions = true,
  }: Options & { loaded?: ComplexityLoaded; withQuestions?: boolean } = {},
): Promise<AccountantPageView> {
  const estimate = loaded?.estimate ?? (await loadTaxEstimate(userId, { client, now }));
  const db = scopedFor(userId, client);
  const [links, notes, comp, questions] = await Promise.all([
    db.accountantLinks.findMany({ orderBy: [{ createdAt: "desc" }, { id: "asc" }] }),
    db.accountantNotes.findMany({ orderBy: [{ createdAt: "desc" }, { id: "asc" }] }),
    loadComplexity(userId, { client, now, loaded: loaded && { ...loaded, estimate } }),
    withQuestions ? loadQuestions(userId, estimate.year, { client, now }) : Promise.resolve([]),
  ]);
  const views = links.map((l) => ({
    id: l.id,
    label: l.label,
    state: linkState(l, now),
    expiresOn: iso(l.expiresAt),
    viewCount: l.viewCount,
    lastViewedAt: l.lastViewedAt ? iso(l.lastViewedAt) : null,
  }));
  return {
    year: estimate.year,
    links: views,
    activeCount: views.filter((l) => l.state === "active").length,
    notes: notes.map((n) => ({
      id: n.id,
      fromName: n.fromName,
      questionText: n.questionText,
      body: n.body,
      seen: n.seenAt !== null,
      createdAt: iso(n.createdAt),
    })),
    unseen: notes.filter((n) => n.seenAt === null).length,
    complexity: comp,
    questions,
  };
}

// A new link. The token is returned once, in the URL; only its hash is stored.
export async function createAccountantLink(
  userId: string,
  input: { label: string; days: number },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ url: string; expiresOn: string }> {
  const label = input.label.trim().slice(0, LABEL_MAX);
  if (!label) throw new AccountantError("Say who it's for, like your accountant's name.");
  if (!(LINK_DAYS_CHOICES as readonly number[]).includes(input.days)) {
    throw new AccountantError(`Pick ${LINK_DAYS_CHOICES.join(", ")} days.`);
  }
  const db = scopedFor(userId, client);
  const live = (
    await db.accountantLinks.findMany({ select: { expiresAt: true, revokedAt: true } })
  ).filter((l) => linkState(l, now) === "active").length;
  if (live >= MAX_ACTIVE_LINKS) {
    throw new AccountantError("You have enough live links. Revoke one first.");
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + input.days * DAY_MS);
  const link = await db.accountantLinks.create({
    data: { userId, tokenHash: hashOf(token), label, expiresAt },
  });
  await logAudit(
    { type: "user", id: userId },
    "accountant_link_created",
    { type: "accountant_link", id: link.id },
    { days: input.days },
  );
  await track(userId, "accountant_link_created", { days: input.days });
  return { url: `${appBase()}/accountant/${token}`, expiresOn: iso(expiresAt) };
}

export async function revokeAccountantLink(
  userId: string,
  id: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).accountantLinks.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: now },
  });
  if (count === 0) throw new AccountantError("That link isn't live.");
  await logAudit({ type: "user", id: userId }, "accountant_link_revoked", {
    type: "accountant_link",
    id,
  });
  await track(userId, "accountant_link_revoked", {});
}

export async function markNotesSeen(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const { count } = await scopedFor(userId, client).accountantNotes.updateMany({
    where: { seenAt: null },
    data: { seenAt: now },
  });
  return count;
}

// ---- The accountant's side: the token is the credential. ----

const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;

async function findLink(token: string, client: PrismaClient, now: Date) {
  if (!TOKEN.test(token)) return null;
  const link = await client.accountantLink.findUnique({ where: { tokenHash: hashOf(token) } });
  if (!link || linkState(link, now) !== "active") return null;
  return link;
}

// Only tax data: the figures, the pack, the forms, the proof behind each deduction, the
// questions and the answers. No balances, no spending outside the tax tags, no contact
// details.
export type AccountantView = {
  label: string;
  year: number;
  expiresOn: string;
  summary: {
    totalIncomeCents: number;
    agiCents: number;
    taxableCents: number;
    totalTaxCents: number;
    paidCents: number;
    refundCents: number;
  };
  pack: Pick<TaxPack, "charity" | "preparer" | "income" | "forms" | "states" | "rental">;
  collected: { form: string; from: string; boxes: Record<string, number>; matches: string }[];
  deductions: { label: string; claimedCents: number; sources: number; needs: string[] }[];
  complexity: string | null;
  questions: (Question & { answers: { fromName: string; body: string; at: string }[] })[];
  notes: { fromName: string; body: string; at: string }[];
};

export async function viewByToken(
  token: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ state: "unavailable" } | { state: "ok"; view: AccountantView }> {
  const link = await findLink(token, client, now);
  if (!link) return { state: "unavailable" };
  const userId = link.userId;
  const estimate = await loadTaxEstimate(userId, { client, now });
  const year = estimate.year;
  const [pack, docs, records, questions, comp, notes] = await Promise.all([
    loadTaxPack(userId, year, { client, now }),
    loadTaxDocuments(userId, year, { client, now }),
    loadAuditRecords(userId, year, { client, now }),
    loadQuestions(userId, year, { client, now }),
    loadComplexity(userId, { client, now }),
    scopedFor(userId, client).accountantNotes.findMany({
      where: { linkId: link.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  await client.accountantLink.update({
    where: { id: link.id },
    data: { viewCount: { increment: 1 }, lastViewedAt: now },
  });
  await logAudit(
    SYSTEM_ACTOR,
    "accountant_link_viewed",
    { type: "accountant_link", id: link.id },
    {
      user_id: userId,
    },
  );
  const e = estimate.estimate;
  return {
    state: "ok",
    view: {
      label: link.label,
      year,
      expiresOn: iso(link.expiresAt),
      summary: {
        totalIncomeCents: e.totalIncomeCents,
        agiCents: e.agiCents,
        taxableCents: e.taxableCents,
        totalTaxCents: e.totalTaxCents,
        paidCents: e.paidCents,
        refundCents: e.refundCents,
      },
      pack: {
        charity: pack.charity,
        preparer: pack.preparer,
        income: pack.income,
        forms: pack.forms,
        states: pack.states,
        rental: pack.rental,
      },
      collected: docs.forms
        .filter((f) => f.document)
        .map((f) => ({
          form: f.form,
          from: f.from,
          boxes: f.document!.boxes as Record<string, number>,
          matches: f.check?.status ?? "unchecked",
        })),
      deductions: records.items.map((i) => ({
        label: i.label,
        claimedCents: i.claimedCents,
        sources: i.evidence.length,
        needs: i.needs,
      })),
      complexity: comp.text,
      questions: questions.map((q) => ({
        ...q,
        answers: notes
          .filter((n) => n.questionKey === q.key)
          .map((n) => ({ fromName: n.fromName, body: n.body, at: iso(n.createdAt) })),
      })),
      notes: notes
        .filter((n) => n.questionKey === null)
        .map((n) => ({ fromName: n.fromName, body: n.body, at: iso(n.createdAt) })),
    },
  };
}

// An answer to one of Jane's questions, or a note of their own, from the accountant's page.
export async function answerByToken(
  token: string,
  input: { questionKey: string | null; name: string; body: string },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const link = await findLink(token, client, now);
  if (!link) throw new AccountantError("This link isn't available any more.");
  const fromName = input.name.trim().slice(0, NAME_MAX);
  const body = input.body.trim();
  if (!fromName) throw new AccountantError("Add your name.");
  if (!body) throw new AccountantError("Write an answer.");
  if (body.length > ANSWER_MAX) {
    throw new AccountantError(`Keep it under ${ANSWER_MAX} characters.`);
  }
  const userId = link.userId;
  const db = scopedFor(userId, client);
  if ((await db.accountantNotes.count({ where: { linkId: link.id } })) >= MAX_NOTES_PER_LINK) {
    throw new AccountantError("This link has all the answers it can take.");
  }
  let questionText: string | null = null;
  if (input.questionKey !== null) {
    const estimate = await loadTaxEstimate(userId, { client, now });
    const q = (await loadQuestions(userId, estimate.year, { client, now })).find(
      (x) => x.key === input.questionKey,
    );
    if (!q) throw new AccountantError("That question isn't open any more.");
    questionText = q.text;
  }
  await db.accountantNotes.create({
    data: {
      userId,
      linkId: link.id,
      questionKey: input.questionKey,
      questionText,
      fromName,
      body,
      createdAt: now,
    },
  });
  await logAudit(
    SYSTEM_ACTOR,
    "accountant_link_answered",
    { type: "accountant_link", id: link.id },
    {
      user_id: userId,
    },
  );
  await track(userId, "accountant_answered", {});
}

export const DEFAULT_DAYS = DEFAULT_LINK_DAYS;
