import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { consentCovers, usableConnector } from "../consent";
import { myAidUpload } from "./connector";

// The studentaid.gov "Download My Aid Data" file (connectors roadmap round 15): plain text, one
// "name:value" pair per line, always in the same order (the NSLDS layout, dated 2022-10-31). It
// also holds the person's name, address, phone and email: this reads it in memory, keeps the loan
// fields below and nothing else, and never stores the file. The layout doesn't pin down value
// formats, so money, rates and dates are read loosely, and an unknown plan code stays as it is:
// RAP and Tiered Standard codes aren't in the 2022 layout.

export type AidLoan = {
  typeCode: string | null;
  type: string | null;
  principalCents: number | null;
  interestCents: number | null;
  rateType: string | null;
  rateBps: number | null;
  planCode: string | null;
  plan: string | null;
  planBegan: string | null;
  scheduledCents: number | null;
  idrAnniversary: string | null;
  nextDue: string | null;
  pslfMonths: number | null;
  status: string | null;
  loanDate: string | null;
  disbursedCents: number | null;
  servicer: string | null;
};

// The file's own names (round 15, verbatim from the layout), to the fields above.
const FIELDS: Record<string, keyof AidLoan> = {
  "loan type code": "typeCode",
  "loan type description": "type",
  "loan outstanding principal balance": "principalCents",
  "loan outstanding interest balance": "interestCents",
  "loan interest rate type code": "rateType",
  "loan interest rate": "rateBps",
  "loan repayment plan type code": "planCode",
  "loan repayment plan type code description": "plan",
  "loan repayment plan begin date": "planBegan",
  "loan repayment plan scheduled amount": "scheduledCents",
  "loan repayment plan idr plan anniversary date": "idrAnniversary",
  "loan next payment due date": "nextDue",
  "loan pslf cumulative matched months": "pslfMonths",
  "current loan status": "status",
  "loan date": "loanDate",
  "loan disbursed amount": "disbursedCents",
};
const MONEY = new Set<keyof AidLoan>([
  "principalCents",
  "interestCents",
  "scheduledCents",
  "disbursedCents",
]);
const DAYS = new Set<keyof AidLoan>(["planBegan", "idrAnniversary", "nextDue", "loanDate"]);
// The longest a loan's text field may be: a code or a description, not a paragraph.
const MAX_TEXT = 80;

export class MyAidError extends Error {
  constructor(reason: string) {
    super(`That doesn't look like a My Aid file: ${reason}.`);
    this.name = "MyAidError";
  }
}

const blank = (): AidLoan => ({
  typeCode: null,
  type: null,
  principalCents: null,
  interestCents: null,
  rateType: null,
  rateBps: null,
  planCode: null,
  plan: null,
  planBegan: null,
  scheduledCents: null,
  idrAnniversary: null,
  nextDue: null,
  pslfMonths: null,
  status: null,
  loanDate: null,
  disbursedCents: null,
  servicer: null,
});

function money(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

function day(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return value;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!us) return null;
  return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
}

function rateBps(value: string): number | null {
  const cleaned = value.replace(/[%\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const bps = Math.round(Number(cleaned) * 100);
  return bps <= 5000 ? bps : null;
}

// Every loan in the file, its loan fields only. A new loan starts at each "Loan Type Code".
export function parseMyAid(text: string): AidLoan[] {
  if (text.length > 2_000_000) throw new MyAidError("too large");
  const loans: AidLoan[] = [];
  let current: AidLoan | null = null;
  let contactType = "";
  for (const raw of text.split(/\r?\n/)) {
    const at = raw.indexOf(":");
    if (at < 1) continue;
    const name = raw.slice(0, at).trim().toLowerCase();
    const value = raw.slice(at + 1).trim();
    if (name === "loan type code") {
      current = blank();
      loans.push(current);
    }
    if (!current) continue;
    // The servicer is the loan's contact whose type is its current servicer.
    if (name === "loan contact type") contactType = value.toLowerCase();
    if (name === "loan contact name" && contactType.includes("servicer") && !current.servicer) {
      current.servicer = value.slice(0, MAX_TEXT) || null;
    }
    const field = FIELDS[name];
    if (!field || !value) continue;
    if (MONEY.has(field)) (current[field] as number | null) = money(value);
    else if (DAYS.has(field)) (current[field] as string | null) = day(value);
    else if (field === "rateBps") current.rateBps = rateBps(value);
    else if (field === "pslfMonths") {
      current.pslfMonths = /^\d{1,3}$/.test(value) ? Number(value) : null;
    } else (current[field] as string | null) = value.slice(0, MAX_TEXT);
  }
  if (loans.length === 0) throw new MyAidError("no loans in it");
  return loans;
}

// What Claude may see (round 15, with round 11's minimisation): numbers, codes and the plan's and
// status's names. Never the servicer's or the person's name, nor any date beyond the month.
export function myAidForLlm(loans: readonly AidLoan[]) {
  return loans.map((loan) => ({
    type: loan.type ?? loan.typeCode,
    principalCents: loan.principalCents,
    interestCents: loan.interestCents,
    rateBps: loan.rateBps,
    rateType: loan.rateType,
    plan: loan.plan ?? loan.planCode,
    scheduledCents: loan.scheduledCents,
    nextDueMonth: loan.nextDue?.slice(0, 7) ?? null,
    pslfMonths: loan.pslfMonths,
    status: loan.status,
  }));
}

type Options = { client?: PrismaClient };

// Reads one uploaded file for the person, with the connector on for them and their consent. The
// file itself is never kept; what's done with the loans is the student-loan lane's.
export async function readMyAidUpload(
  userId: string,
  text: string,
  { client = defaultClient }: Options = {},
): Promise<AidLoan[]> {
  const connector = await usableConnector(userId, myAidUpload.id, { client });
  if (!(await consentCovers(userId, connector, { client }))) throw new MyAidError("no consent");
  const loans = parseMyAid(text);
  await logAudit(
    { type: "user", id: userId },
    "my_aid_uploaded",
    { type: "user", id: userId },
    { loans: loans.length },
  );
  await track(userId, "my_aid_uploaded", { loans: loans.length });
  return loans;
}
