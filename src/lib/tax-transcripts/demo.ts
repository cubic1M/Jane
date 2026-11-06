import { createHash } from "node:crypto";
import type { TranscriptListing, TranscriptPartner } from "./types";

// The transcript partner's stand-in, for the demo bank: the last two tax years' account transcripts
// for a made-up filer, the same every time for the same person. It reaches nobody: no IRS sign-in,
// no partner, nothing collected.

const money = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

// A demo transcript for the year: a return filed in April, withholding, and the refund in May.
export function demoTranscriptText(taxYear: number, seed: string): string {
  const n = Number.parseInt(
    createHash("sha256").update(`${seed}:${taxYear}`).digest("hex").slice(0, 6),
    16,
  );
  const tax = 300_000 + (n % 200_000);
  const withheld = tax + 50_000 + (n % 150_000);
  const refund = withheld - tax;
  const filed = taxYear + 1;
  return [
    "This Product Contains Sensitive Taxpayer Data",
    "Account Transcript",
    "FORM NUMBER: 1040",
    `TAX PERIOD: Dec. 31, ${taxYear}`,
    "TAXPAYER IDENTIFICATION NUMBER: XXX-XX-0000",
    "DEMO FILER",
    "ACCOUNT BALANCE: $0.00",
    "TRANSACTIONS",
    "CODE EXPLANATION OF TRANSACTION CYCLE DATE AMOUNT",
    `150 Tax return filed ${filed}1505 04-15-${filed} ${money(tax)}`,
    `806 W-2 or 1099 withholding 04-15-${filed} ${money(-withheld)}`,
    `846 Refund issued ${filed}1805 05-04-${filed} ${money(refund)}`,
    "",
  ].join("\n");
}

export const demoTranscriptPartner = (thisYear: number): TranscriptPartner => ({
  name: "demo",
  async startConsent(userId) {
    const consentId = `demo-${createHash("sha256").update(userId).digest("hex").slice(0, 12)}`;
    return { consentId, url: "/taxes?transcripts=demo" };
  },
  async listTranscripts(consentId): Promise<TranscriptListing[]> {
    return [thisYear - 1, thisYear - 2].map((taxYear) => ({
      id: `${consentId}:${taxYear}`,
      kind: "account",
      taxYear,
    }));
  },
  async fetchTranscript(consentId, id) {
    const taxYear = Number(id.slice(id.lastIndexOf(":") + 1));
    if (!id.startsWith(`${consentId}:`) || !Number.isInteger(taxYear)) {
      throw new Error("No such transcript");
    }
    return demoTranscriptText(taxYear, consentId);
  },
});
