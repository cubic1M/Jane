import type { DocumentContentType } from "@/config/documents";
import { NOTICE_FIELDS, NOTICE_KINDS } from "@/config/tax-notices";
import { anthropic } from "@/lib/anthropic";
import { readFields, type ReadResult } from "@/lib/read-fields";
import type { Fields } from "@/planning/tax-notice";

// Claude reads a tax notice off a photo or upload (spec step 217): which notice it is, the
// dates and the amount. The answer is held to a JSON schema and goes through the reading
// rules (src/planning/tax-notice.ts) before the person sees it. Without a key, nothing is
// read and the person types it from the notice. Never log the file or the answer.

const prompt = [
  "This is a notice or letter the person got from the IRS or a state tax agency. Read these values.",
  `kind: one of ${Object.keys(NOTICE_KINDS).join(", ")} (the notice code printed at the top, such as CP2000; STATE_PROPOSED or STATE_BALANCE for a state letter; OTHER if unsure).`,
  "issuer: irs, or the two-letter state code.",
  "taxYear: the four-digit tax year it is about.",
  "noticeDate and respondBy: as YYYY-MM-DD; respondBy is the date to respond or pay by.",
  "amount: in dollars as a plain number: the balance due, or the proposed additional tax.",
  "payer: for income that doesn't match, the payer named. reportedIncome: the income that payer reported, in dollars.",
  "reason: what the notice says in one plain line, with no advice.",
  "Leave any field you can't find as an empty string. Never guess.",
].join("\n");

export type NoticeReadResult = ReadResult<Fields>;

export async function readNotice(
  file: { bytes: Uint8Array; contentType: DocumentContentType },
  { claude = anthropic }: { claude?: typeof anthropic } = {},
): Promise<NoticeReadResult> {
  return readFields(file, {
    keys: NOTICE_FIELDS.map((f) => f.key),
    prompt,
    maxTokens: 700,
    claude,
  });
}
