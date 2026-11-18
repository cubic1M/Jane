import { createHash } from "node:crypto";
import { parseTranscript } from "@/lib/connectors/irs-transcript/parse";
import { demoTranscriptText } from "@/lib/tax-transcripts/demo";
import type { TranscriptListing, TranscriptPartner } from "@/lib/tax-transcripts/types";
import type { ChartRecord } from "./api";
import { accountTranscripts, transcriptText } from "./normalize";

// Chart as the transcript partner #1576 was shaped for (src/lib/tax-transcripts/types.ts): the
// person agrees through Chart Connect, then each account transcript Chart has for them is listed
// and handed over in the IRS's layout, which Jane's transcript reader reads.

export function chartTranscriptPartner({
  name,
  connectUrl,
  records,
}: {
  name: string;
  // Where the person agrees (Chart Connect, or the sandbox's own page).
  connectUrl: string;
  records: () => Promise<ChartRecord[]>;
}): TranscriptPartner {
  const transcripts = async () =>
    (await records()).flatMap((record) =>
      accountTranscripts(record).map((form) => ({ id: `${record.id}:${form.year}`, form })),
    );
  return {
    name,
    async startConsent(userId) {
      const consentId = `chart-${createHash("sha256").update(userId).digest("hex").slice(0, 12)}`;
      return { consentId, url: connectUrl };
    },
    async listTranscripts(): Promise<TranscriptListing[]> {
      return (await transcripts()).flatMap(({ id, form }) => {
        const taxYear = Number(form.year);
        return Number.isInteger(taxYear) ? [{ id, kind: "account" as const, taxYear }] : [];
      });
    },
    async fetchTranscript(_consentId, id) {
      const found = (await transcripts()).find((t) => t.id === id);
      if (!found) throw new Error("No such transcript");
      return transcriptText(found.form);
    },
  };
}

// The sandbox twin's records: Chart's record and ACTR shape (its OpenAPI's Record and
// ACTR_Individual), with the demo stand-in's figures for the last two years (src/lib/tax-transcripts/
// demo.ts), so a sample person's transcripts read the same either way.
export function sampleChartRecords(thisYear: number, seed: string): ChartRecord[] {
  return [thisYear - 1, thisYear - 2].map((year) => {
    const demo = parseTranscript(demoTranscriptText(year, seed));
    return {
      id: `sbx-record-${year}`,
      tax_year: String(year),
      provider_id: "chart-sandbox",
      forms: [
        {
          type: "ACTR",
          year: String(year),
          account_summary: { account_balance: (demo.balanceCents ?? 0) / 100 },
          transactions: demo.lines.map((line) => ({
            code: line.code,
            explanation_of_transaction: line.what,
            date: line.on,
            amount: line.cents / 100,
          })),
        },
      ],
    };
  });
}

export const sandboxChartPartner = (thisYear: number, seed: string): TranscriptPartner =>
  chartTranscriptPartner({
    name: "chart (sandbox)",
    connectUrl: "/taxes?transcripts=chart-sandbox",
    records: async () => sampleChartRecords(thisYear, seed),
  });
