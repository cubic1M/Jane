import type { DocumentContentType } from "@/config/documents";
import {
  NOTICE_FIELDS,
  NOTICE_KINDS,
  isNoticeKind,
  type NoticeFieldKey,
  type NoticeKind,
} from "@/config/tax-notices";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { anthropic, llmModel } from "@/lib/anthropic";
import { logAudit } from "@/lib/audit";
import { conciergeMode } from "@/lib/concierge-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDeadline } from "@/lib/deadlines";
import { log } from "@/lib/log";
import { loadTaxDocuments } from "@/lib/tax-documents";
import {
  centsOf,
  checkAgainstWhatJaneKnows,
  checkNotice,
  draftResponse,
  dueDate,
  type Check,
  type Fields,
  type NoticeFacts,
  type Source,
} from "@/planning/tax-notice";
import { US_STATES } from "@/config/referrals";
import { readNotice } from "./read";
import { meteredClaude } from "@/lib/claude-budget";
import { todayOf } from "@/lib/today";

// A letter from the IRS or the state (spec step 217): read from an uploaded copy for the
// person to confirm; then a deadline, a check against what Jane knows, and a drafted
// response (agree, pay or dispute). The response is sent by the team or by the person, on
// their tap; Jane never pays or sends on its own.

type Options = { client?: PrismaClient; now?: Date };

export class NoticeError extends Error {}

export type Response = "agree" | "pay" | "dispute";

export type NoticeView = {
  id: string;
  documentId: string;
  fileName: string;
  fields: Fields;
  sources: Partial<Record<NoticeFieldKey, Source>>;
  notes: Partial<Record<NoticeFieldKey, string>>;
  status: "waiting" | "confirmed" | "dismissed";
  kind: NoticeKind;
  dueOn: string | null;
  response: Response | null;
  draft: string | null;
  handledBy: "team" | "you" | null;
};

const SELECT = {
  id: true,
  documentId: true,
  fields: true,
  sources: true,
  notes: true,
  status: true,
  response: true,
  draft: true,
  handledBy: true,
  document: { select: { fileName: true } },
} as const;

const obj = (v: unknown) =>
  (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, string>;

function toView(row: {
  id: string;
  documentId: string;
  fields: unknown;
  sources: unknown;
  notes: unknown;
  status: string;
  response: string | null;
  draft: string | null;
  handledBy: string | null;
  document: { fileName: string };
}): NoticeView {
  const fields = obj(row.fields) as Fields;
  return {
    id: row.id,
    documentId: row.documentId,
    fileName: row.document.fileName,
    fields,
    sources: obj(row.sources) as NoticeView["sources"],
    notes: obj(row.notes) as NoticeView["notes"],
    status: row.status as NoticeView["status"],
    kind: isNoticeKind(fields.kind) ? fields.kind : "OTHER",
    dueOn: dueDate(fields),
    response: (row.response as Response | null) ?? null,
    draft: row.draft,
    handledBy: (row.handledBy as NoticeView["handledBy"]) ?? null,
  };
}

export async function readTaxNotice(
  userId: string,
  documentId: string,
  {
    client = defaultClient,
    now = new Date(),
    file = null,
    claude = meteredClaude(userId),
  }: Options & {
    file?: { bytes: Uint8Array; contentType: DocumentContentType } | null;
    claude?: typeof anthropic;
  } = {},
): Promise<NoticeView | null> {
  const db = scopedFor(userId, client);
  const existing = await db.taxNotices.findFirst({ where: { documentId }, select: SELECT });
  if (existing) return toView(existing);
  const document = await db.documents.findFirst({
    where: { id: documentId, kind: "tax_notice" },
    select: { id: true },
  });
  if (!document) return null;
  const fields: Fields = {};
  const sources: Partial<Record<NoticeFieldKey, Source>> = {};
  if (file) {
    const read = await readNotice(file, { claude });
    if (read.kind === "claude") {
      for (const [k, v] of Object.entries(read.fields)) {
        fields[k as NoticeFieldKey] = v;
        sources[k as NoticeFieldKey] = "document";
      }
      await logAudit(
        { type: "user", id: userId },
        "document_read",
        { type: "document", id: document.id },
        { model: llmModel(), tax_notice: true },
      );
    } else if (read.kind === "failed") {
      log.warn("Reading a tax notice failed", { reason: read.reason });
    }
  }
  const checked = checkNotice(fields, sources, { today: await todayOf(userId, { client, now }) });
  try {
    const row = await db.taxNotices.create({
      data: {
        userId,
        documentId,
        fields: checked.fields,
        sources: checked.sources,
        notes: checked.notes,
        createdAt: now,
      },
      select: SELECT,
    });
    await track(userId, "tax_notice_reading_ready", { read: file ? "tried" : "none" });
    return toView(row);
  } catch (error) {
    const again = await db.taxNotices.findFirst({ where: { documentId }, select: SELECT });
    if (again) return toView(again);
    throw error;
  }
}

export async function listTaxNotices(
  userId: string,
  { client = defaultClient, status }: Options & { status?: NoticeView["status"] } = {},
): Promise<NoticeView[]> {
  const rows = await scopedFor(userId, client).taxNotices.findMany({
    where: status ? { status } : {},
    select: SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toView);
}

async function getTaxNotice(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<NoticeView | null> {
  const row = await scopedFor(userId, client).taxNotices.findFirst({
    where: { id },
    select: SELECT,
  });
  return row ? toView(row) : null;
}

// Confirm: the fields (as read, or as the person corrected them) are checked again, then
// the notice's deadline goes on their deadlines. Only a confirmed notice is acted on.
export async function confirmTaxNotice(
  userId: string,
  id: string,
  { client = defaultClient, now = new Date(), fields: typed }: Options & { fields?: Fields } = {},
): Promise<NoticeView> {
  const db = scopedFor(userId, client);
  const reading = await getTaxNotice(userId, id, { client });
  if (!reading || reading.status !== "waiting")
    throw new NoticeError("That one's already been answered.");
  const sources = { ...reading.sources };
  const given = typed ?? reading.fields;
  if (typed) {
    for (const f of NOTICE_FIELDS)
      if (typed[f.key] !== reading.fields[f.key]) sources[f.key] = "you";
  }
  const checked = checkNotice(given, sources, { today: await todayOf(userId, { client, now }) });
  if (Object.keys(checked.notes).some((k) => !(k === "respondBy" && checked.fields.respondBy))) {
    throw new NoticeError(Object.values(checked.notes)[0] ?? "Check the notice's details.");
  }
  if (!checked.fields.kind || !checked.fields.noticeDate) {
    throw new NoticeError("Say which notice it is and the date on it.");
  }
  const claimed = await db.taxNotices.updateMany({
    where: { id, status: "waiting" },
    data: {
      status: "confirmed",
      fields: checked.fields,
      sources: checked.sources,
      notes: checked.notes,
    },
  });
  // Someone else answered it between the read and the write: nothing here was saved, and no
  // deadline is made for it (CodeRabbit sweep).
  if (claimed.count === 0) throw new NoticeError("That one's already been answered.");
  const view = (await getTaxNotice(userId, id, { client }))!;
  if (view.dueOn && view.dueOn >= (await todayOf(userId, { client, now }))) {
    await addDeadline(
      userId,
      {
        title: `${view.kind === "OTHER" ? "Respond to your tax notice" : `Respond to your ${view.kind} notice`}`,
        dueOn: view.dueOn,
        kind: "other",
        note: NOTICE_KINDS[view.kind].what,
      },
      { client, now },
    );
  }
  await logAudit(
    { type: "user", id: userId },
    "tax_notice_confirmed",
    { type: "document", id: view.documentId },
    { kind: view.kind },
  );
  await track(userId, "tax_notice_confirmed", { kind: view.kind });
  return view;
}

export async function dismissTaxNotice(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const res = await scopedFor(userId, client).taxNotices.updateMany({
    where: { id, status: "waiting" },
    data: { status: "dismissed" },
  });
  if (res.count === 0) throw new NoticeError("That one's already been answered.");
}

// What Jane knows that bears on a notice: the forms it collected for its year, the income
// the accounts show from each payer, and payments to the IRS and the state.
// A line that names a state tax agency: its own name, or a state's code in front ("CA FTB", "NYS DTF").
// "NY DTF", "CA TAX": a real state's two-letter code, never a word like TO ("PAYMENT TO TAX COLLECTOR").
const STATE_CODES = US_STATES.map((st) => st.code).join("|");
const STATE_AGENCY = new RegExp(
  String.raw`\b(?:FRANCHISE TAX|FTB|DEPT\.? OF REVENUE|DEPARTMENT OF REVENUE|DEPT\.? OF TAXATION|DEPARTMENT OF TAXATION|TAX BOARD|NYS DTF|STATE TAX|COMPTROLLER|DOR)\b|(?:^|\s)(?:${STATE_CODES}) (?:TAX|REV|DTF|DOR)\b`,
  "i",
);

async function noticeFacts(
  userId: string,
  fields: Fields,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<NoticeFacts> {
  const year =
    Number(fields.taxYear) || Number((await todayOf(userId, { client, now })).slice(0, 4)) - 1;
  const db = scopedFor(userId, client);
  const [docs, income, payments] = await Promise.all([
    loadTaxDocuments(userId, year, { client, now }),
    db.transactions.findMany({
      where: {
        pending: false,
        amountCents: { lt: 0 },
        date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
        pfcDetailed: { startsWith: "INCOME_" },
      },
      select: { amountCents: true, description: true, merchantName: true },
    }),
    db.transactions.findMany({
      where: {
        pending: false,
        amountCents: { gt: 0 },
        pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
        // From the year's start of filing season on, with no end: a notice for an old year is
        // paid when it is paid, which may be years later.
        date: { gte: new Date(Date.UTC(year, 1, 1)) },
      },
      select: { date: true, amountCents: true, description: true, merchantName: true },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
  ]);
  const byPayer = new Map<string, number>();
  for (const t of income) {
    const p = (t.merchantName ?? t.description).trim();
    byPayer.set(p, (byPayer.get(p) ?? 0) - t.amountCents);
  }
  const wantsState = isNoticeKind(fields.kind) && NOTICE_KINDS[fields.kind].issuer === "state";
  const federal = /\b(?:IRS|USATAXPYMT|US TREASURY|U\.S\. TREASURY|EFTPS)\b/i;
  return {
    forms: docs.forms
      .filter((f) => f.document && f.usable)
      .map((f) => ({
        form: f.form,
        from: f.from,
        cents: f.check?.formCents ?? f.amountCents ?? 0,
      })),
    incomeByPayer: [...byPayer.entries()].map(([payer, cents]) => ({ payer, cents })),
    payments: payments
      .filter((t) => {
        const line = `${t.description} ${t.merchantName ?? ""}`;
        // A payment whose line names another tax year ("USATAXPYMT 2025") is for that year's
        // balance: it is not counted toward this notice's.
        // A year inside a date ("PAYMENT DATE 2026-10-06", "10/06/2026") says when it was paid,
        // not which year it is for.
        const named = [
          ...line
            .replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
            .matchAll(/\b(20\d{2})\b/g),
        ].map((m) => Number(m[1]));
        if (named.length > 0 && !named.includes(year)) return false;
        // A federal notice counts federal payments; a state one counts only lines that name a
        // state tax agency, never every payment that is not federal.
        return wantsState ? !federal.test(line) && STATE_AGENCY.test(line) : federal.test(line);
      })
      .map((t) => ({
        date: t.date.toISOString().slice(0, 10),
        payee: (t.merchantName ?? t.description).trim(),
        cents: t.amountCents,
      })),
  };
}

export async function checkNoticeFor(
  userId: string,
  notice: NoticeView,
  options: Options = {},
): Promise<Check & { advice: boolean }> {
  const [facts, advice] = await Promise.all([
    noticeFacts(userId, notice.fields, options),
    adviceMode(userId, { client: options.client }),
  ]);
  const check = checkAgainstWhatJaneKnows(notice.fields, facts);
  // Pointing at a response is a recommendation: demo advice only.
  return { ...check, points: advice ? check.points : null, advice };
}

// The person chooses a response; Jane drafts it, with the documents it'd attach.
export async function chooseResponse(
  userId: string,
  id: string,
  response: Response,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<NoticeView> {
  const notice = await getTaxNotice(userId, id, { client });
  if (!notice || notice.status !== "confirmed")
    throw new NoticeError("Confirm what's on the notice first.");
  if (notice.handledBy) throw new NoticeError("This one's already been sent.");
  if (!NOTICE_KINDS[notice.kind].responses.includes(response)) {
    throw new NoticeError("That isn't a response to this kind of notice.");
  }
  const facts = await noticeFacts(userId, notice.fields, { client, now });
  const attachments = [
    ...facts.forms.map((f) => `Your ${f.form} from ${f.from}`),
    ...facts.payments.slice(0, 4).map((p) => `Proof of payment: ${p.payee}, ${p.date}`),
  ];
  const draft = draftResponse(response, notice.fields, attachments);
  // Only while it is still confirmed and unhandled: a letter sent while the draft was being made
  // keeps the response it was sent with (CodeRabbit sweep).
  const saved = await scopedFor(userId, client).taxNotices.updateMany({
    where: { id, status: "confirmed", handledBy: null },
    data: { response, draft: draft.body },
  });
  if (saved.count === 0) throw new NoticeError("This one's already been sent.");
  await track(userId, "tax_notice_response_drafted", { response });
  return (await getTaxNotice(userId, id, { client }))!;
}

// The person's tap: the team sends it, or they will. Nothing here pays or sends anything
// outside Jane; the team's queue and the person's own copy are what this records. There's no team
// for a real account (src/lib/concierge-mode.ts), and "Jane's team has it" stops the reminders, so
// saying yes would leave a real deadline with nobody on it.
export async function sendResponse(
  userId: string,
  id: string,
  by: "team" | "you",
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<NoticeView> {
  const notice = await getTaxNotice(userId, id, { client });
  if (!notice?.draft || !notice.response) throw new NoticeError("Choose a response first.");
  if (notice.handledBy) throw new NoticeError("This one's already been sent.");
  if (by === "team" && !(await conciergeMode(userId, { client }))) {
    throw new NoticeError(
      "Jane's team can't send letters yet. Please send this one yourself, before the date on the notice.",
    );
  }
  await scopedFor(userId, client).taxNotices.updateMany({
    where: { id, handledBy: null },
    data: { handledBy: by, handledAt: now },
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_notice_response_sent",
    { type: "document", id: notice.documentId },
    { response: notice.response, by },
  );
  await track(userId, "tax_notice_response_sent", { by });
  return (await getTaxNotice(userId, id, { client }))!;
}

export const noticeAmountCents = (n: NoticeView) => centsOf(n.fields, "amount");
