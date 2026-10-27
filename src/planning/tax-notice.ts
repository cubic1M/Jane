import {
  NOTICE_KINDS,
  NOTICE_YEARS_BACK,
  isNoticeKind,
  type NoticeFieldKey,
  type NoticeKind,
} from "@/config/tax-notices";
import { parseMoneyToCents, formatCents } from "@/lib/money";
import { addDays } from "@/lib/dates";

// A tax notice from the IRS or the state (spec step 217). Pure.
// - The reading rules: what Jane read off a notice, checked before the person sees it.
// - The check: what the notice says against what Jane knows (the forms it collected, the
//   income in the accounts, the payments to the tax agency), and which response that
//   points to (demo advice; the person decides).
// - The drafts: the response letter for agreeing, paying or disputing.

export type Fields = Partial<Record<NoticeFieldKey, string>>;
export type Source = "document" | "you";
export const SOURCE_WORDS: Record<Source, string> = {
  document: "from the notice",
  you: "as you typed it",
};
export type CheckedNotice = {
  fields: Fields;
  sources: Partial<Record<NoticeFieldKey, Source>>;
  notes: Partial<Record<NoticeFieldKey, string>>;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function checkNotice(
  given: Fields,
  from: Partial<Record<NoticeFieldKey, Source>>,
  { today }: { today: string },
): CheckedNotice {
  const fields: Fields = { ...given };
  const sources = { ...from };
  const notes: CheckedNotice["notes"] = {};
  const drop = (key: NoticeFieldKey, note: string) => {
    delete fields[key];
    delete sources[key];
    notes[key] = note;
  };
  if (fields.kind !== undefined && !isNoticeKind(fields.kind))
    drop("kind", "Pick which notice it is.");
  const year = Number(today.slice(0, 4));
  if (fields.taxYear !== undefined) {
    const y = Number(fields.taxYear);
    if (!Number.isInteger(y) || y > year || y < year - NOTICE_YEARS_BACK) {
      drop("taxYear", "I couldn't read the tax year.");
    }
  }
  for (const key of ["noticeDate", "respondBy"] as const) {
    const v = fields[key];
    if (v !== undefined && (!DATE.test(v) || Number.isNaN(Date.parse(v)))) {
      drop(key, "I couldn't read that date. Type it as YYYY-MM-DD.");
    }
  }
  for (const key of ["amount", "reportedIncome"] as const) {
    const v = fields[key];
    if (v === undefined || v === "") continue;
    const cents = parseMoneyToCents(v);
    if (cents === null || cents < 0 || cents > 100_000_000_00) {
      drop(key, "I couldn't read that amount. Type it from the notice.");
    }
  }
  if (fields.noticeDate && fields.respondBy && fields.respondBy < fields.noticeDate) {
    notes.respondBy = "That's before the notice's own date: check it.";
  }
  return { fields, sources, notes };
}

export const centsOf = (fields: Fields, key: "amount" | "reportedIncome"): number =>
  (fields[key] ? parseMoneyToCents(fields[key]!) : null) ?? 0;

// The date to respond or pay by: the notice's own, else its date plus the usual days.
export function dueDate(fields: Fields): string | null {
  if (fields.respondBy) return fields.respondBy;
  if (!fields.noticeDate) return null;
  const kind = isNoticeKind(fields.kind) ? fields.kind : "OTHER";
  return addDays(fields.noticeDate, NOTICE_KINDS[kind].days);
}

export type NoticeFacts = {
  // Forms Jane collected for the notice's year that check out.
  forms: { form: string; from: string; cents: number }[];
  // What the accounts show each payer paid in the year.
  incomeByPayer: { payer: string; cents: number }[];
  // Payments to the tax agency seen in the accounts.
  payments: { date: string; payee: string; cents: number }[];
};

export type Check = {
  lines: string[];
  // Which response the facts point to; null when they don't.
  points: "agree" | "pay" | "dispute" | null;
  why: string;
};

const same = (a: string, b: string) => {
  const w = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const [x, y] = [w(a), w(b)];
  if (x.length < 3 || y.length < 3) return false;
  if (x.includes(y) || y.includes(x)) return true;
  // The same first two words ("acme freelance llc" and "acme freelance").
  const [a2, b2] = [x.split(" ").slice(0, 2).join(" "), y.split(" ").slice(0, 2).join(" ")];
  return a2 === b2 && a2.includes(" ");
};
const close = (a: number, b: number) =>
  Math.abs(a - b) <= Math.max(100, Math.round(Math.abs(b) * 0.01));

export function checkAgainstWhatJaneKnows(fields: Fields, facts: NoticeFacts): Check {
  const kind: NoticeKind = isNoticeKind(fields.kind) ? fields.kind : "OTHER";
  const rule = NOTICE_KINDS[kind];
  const lines: string[] = [];
  if (kind === "CP2000" || kind === "STATE_PROPOSED") {
    const payer = fields.payer;
    const reported = centsOf(fields, "reportedIncome");
    if (!payer || reported <= 0) {
      return {
        lines,
        points: null,
        why: "The notice doesn't say which payer or how much income, so I can't check it.",
      };
    }
    const form = facts.forms.find((f) => same(f.from, payer));
    const seen = facts.incomeByPayer.find((p) => same(p.payer, payer));
    if (form) lines.push(`I have the form from ${form.from}: ${formatCents(form.cents)}.`);
    if (seen) lines.push(`Your accounts show ${seen.payer} paid you ${formatCents(seen.cents)}.`);
    if (!form && !seen) lines.push(`I can't find ${payer} in your forms or accounts.`);
    const known = form?.cents ?? seen?.cents ?? null;
    if (known !== null && close(known, reported)) {
      return {
        lines,
        points: "agree",
        why: `${formatCents(reported)} matches what I see from ${payer}. If it wasn't on your return, the notice is probably right.`,
      };
    }
    return {
      lines,
      points: "dispute",
      why:
        known === null
          ? `I can't find that income anywhere, so it's worth asking ${payer} for proof.`
          : `The notice says ${formatCents(reported)}, but I see ${formatCents(known)}.`,
    };
  }
  if (rule.amount === "owed") {
    const owed = centsOf(fields, "amount");
    const paid = facts.payments.reduce((s, p) => s + p.cents, 0);
    for (const p of facts.payments.slice(0, 4))
      lines.push(`You paid ${formatCents(p.cents)} to ${p.payee} on ${p.date}.`);
    if (owed > 0 && paid >= owed) {
      return {
        lines,
        points: "dispute",
        why: `You've paid ${formatCents(paid)}, which covers ${formatCents(owed)}: the payment may not have been applied. Send proof of payment.`,
      };
    }
    if (owed > 0) {
      return {
        lines,
        points: "pay",
        why: `Nothing I can see in your accounts covers the ${formatCents(owed)}.`,
      };
    }
  }
  return { lines, points: null, why: "I don't have enough to check this one against." };
}

export type Draft = { response: "agree" | "pay" | "dispute"; body: string };

// The response letter. Placeholders in [brackets] are the person's own details, which Jane
// never fills in.
export function draftResponse(
  response: "agree" | "pay" | "dispute",
  fields: Fields,
  attachments: string[],
): Draft {
  const kind: NoticeKind = isNoticeKind(fields.kind) ? fields.kind : "OTHER";
  const rule = NOTICE_KINDS[kind];
  const agency =
    rule.issuer === "irs" ? "Internal Revenue Service" : fields.issuer || "State tax agency";
  const re = `Re: ${kind === "OTHER" ? "your notice" : `${kind} notice`} dated ${fields.noticeDate ?? "[date]"}, tax year ${fields.taxYear ?? "[year]"}`;
  const head = `[Your name]\n[Your address]\n[Your taxpayer ID, last four digits only]\n\n${agency}\n\n${re}\n\n`;
  if (response === "agree") {
    return {
      response,
      body: `${head}I have reviewed this notice and agree with the proposed changes${fields.amount ? ` of $${fields.amount}` : ""}. I have signed the response form and am returning it by the date requested.\n\n[Your signature]\n[Date]`,
    };
  }
  if (response === "pay") {
    return {
      response,
      body: `${head}I am paying the balance of ${fields.amount ? `$${fields.amount}` : "[amount]"} shown on this notice. Payment is made by ${rule.issuer === "irs" ? "IRS Direct Pay" : "the agency's online payment page"} on [date paid], confirmation [number].\n\n[Your signature]\n[Date]`,
    };
  }
  const list =
    attachments.length > 0
      ? attachments.map((a) => `- ${a}`).join("\n")
      : "- [Documents that support your position]";
  return {
    response,
    body: `${head}I disagree with this notice${fields.payer ? ` about income from ${fields.payer}` : ""}${fields.reason ? ` (${fields.reason.replace(/\.$/, "")})` : ""}. My records show a different amount, and I am sending the documents below to support them.\n\nDocuments attached:\n${list}\n\nPlease review them and correct your records. I can be reached at [phone].\n\n[Your signature]\n[Date]`,
  };
}
