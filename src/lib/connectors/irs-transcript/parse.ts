import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { consentCovers, usableConnector } from "../consent";
import { irsTranscriptUpload } from "./connector";

// An IRS account transcript (connectors roadmap round 16, irs_transcript_upload): the text of the
// PDF the person downloads from their IRS Online Account. It carries their (partly masked) name,
// SSN and address and each return's document number: this reads it in memory, keeps the tax year,
// the balance and the transactions below by code, and never stores the file or any of those. A
// transaction's explanation is Jane's own words for its code, never the transcript's text.

const TRANSCRIPT_CODES = {
  "150": "Return filed",
  "610": "Payment with the return",
  "670": "Payment",
  "766": "Credit to the account",
  "806": "Withholding",
  "846": "Refund issued",
  "971": "Notice issued",
} as const;

type Code = keyof typeof TRANSCRIPT_CODES;

type TranscriptLine = { code: Code; what: string; on: string; cents: number };

export type Transcript = {
  taxYear: number | null;
  balanceCents: number | null;
  lines: TranscriptLine[];
};

class TranscriptError extends Error {
  constructor(reason: string) {
    super(`That doesn't look like an IRS account transcript: ${reason}.`);
    this.name = "TranscriptError";
  }
}

// "$1,234.00", "-$1,234.00" or "($1,234.00)" -> cents.
function money(value: string): number | null {
  const negative = /^-|^\(/.test(value.trim());
  const cleaned = value.replace(/[$,()\s-]/g, "");
  if (!/^\d+(\.\d{2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return negative ? -cents : cents;
}

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

// A transaction row: the code, its words, maybe a cycle number, the date (MM-DD-YYYY) and the
// amount, which ends the row. A real row is under a hundred characters; a longer line is never
// one, and this pattern on a crafted line of a few hundred thousand characters takes minutes.
const ROW_MAX = 500;
const ROW = /^\s*(\d{3})\s+.+?\s(\d{2})-(\d{2})-(\d{4})\s+(-?\(?\$[\d,]+\.\d{2}\)?)\s*$/;

export function parseTranscript(text: string): Transcript {
  if (text.length > 2_000_000) throw new TranscriptError("too large");
  if (!/account transcript/i.test(text)) throw new TranscriptError("no transcript heading");
  let taxYear: number | null = null;
  let balanceCents: number | null = null;
  const lines: TranscriptLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const period = /tax period(?: ending)?:\s*([a-z]{3})\w*\.?\s+\d{1,2},\s+(\d{4})/i.exec(raw);
    if (period && taxYear === null && MONTHS[period[1]!.toLowerCase()]) taxYear = Number(period[2]);
    const balance = /^\s*account balance:\s*(-?\(?\$[\d,]+\.\d{2}\)?)/i.exec(raw);
    if (balance && balanceCents === null) balanceCents = money(balance[1]!);
    const row = raw.length <= ROW_MAX ? ROW.exec(raw) : null;
    if (!row) continue;
    const code = row[1] as Code;
    if (!(code in TRANSCRIPT_CODES)) continue;
    const cents = money(row[5]!);
    if (cents === null) continue;
    lines.push({ code, what: TRANSCRIPT_CODES[code], on: `${row[4]}-${row[2]}-${row[3]}`, cents });
  }
  if (taxYear === null && lines.length === 0)
    throw new TranscriptError("no tax period or transactions");
  return { taxYear, balanceCents, lines };
}

type Options = { client?: PrismaClient };

// Reads one uploaded transcript for the person, with the connector on for them and their consent.
// The file itself is never kept; what's done with the lines (the refund tracker, estimated payments)
// is the tax lane's.
export async function readTranscriptUpload(
  userId: string,
  text: string,
  { client = defaultClient }: Options = {},
): Promise<Transcript> {
  const connector = await usableConnector(userId, irsTranscriptUpload.id, { client });
  if (!(await consentCovers(userId, connector, { client })))
    throw new TranscriptError("no consent");
  const transcript = parseTranscript(text);
  await logAudit(
    { type: "user", id: userId },
    "irs_transcript_uploaded",
    { type: "user", id: userId },
    { taxYear: transcript.taxYear, lines: transcript.lines.length },
  );
  await track(userId, "irs_transcript_uploaded", { lines: transcript.lines.length });
  return transcript;
}
