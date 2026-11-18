import { connectorsOn } from "@/config/connectors";
import type { PrismaClient } from "@/generated/prisma/client";
import { sandboxChartPartner } from "@/lib/connectors/chart/partner";
import { ConsentError, consentCovers, usableConnector } from "@/lib/connectors/consent";
import { db as defaultClient } from "@/lib/db";
import { adviceMode } from "@/lib/advice-mode";
import { parseTranscript, type Transcript } from "@/lib/connectors/irs-transcript/parse";
import { demoTranscriptPartner } from "./demo";
import type { TranscriptPartner } from "./types";

// Which partner reads a person's IRS transcripts: Chart's sandbox twin for a sample person who
// allowed it, else the stand-in for people whose data is all the demo bank's (the same test as demo
// advice mode); nobody else until a real partner is contracted and counsel has answered.

type Options = { client?: PrismaClient; now?: Date };

export async function transcriptPartnerFor(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TranscriptPartner | null> {
  // Chart's sandbox twin for a sample person who allowed it, with connectors on (never in
  // production yet). There's no real Chart connector until counsel answers (src/lib/connectors/chart/).
  if (connectorsOn() && (await allowedChart(userId, client))) {
    return sandboxChartPartner(now.getUTCFullYear(), userId);
  }
  return (await adviceMode(userId, { client }))
    ? demoTranscriptPartner(now.getUTCFullYear())
    : null;
}

async function allowedChart(userId: string, client: PrismaClient): Promise<boolean> {
  try {
    const connector = await usableConnector(userId, "sandbox_chart_transcripts", { client });
    return await consentCovers(userId, connector, { client });
  } catch (error) {
    if (error instanceof ConsentError) return false;
    throw error;
  }
}

// Every transcript the partner has for the person, read the same way as an upload: codes and
// amounts only. Null without a partner.
export async function partnerTranscripts(
  userId: string,
  options: Options = {},
): Promise<Transcript[] | null> {
  const partner = await transcriptPartnerFor(userId, options);
  if (!partner) return null;
  const { consentId } = await partner.startConsent(userId);
  const listed = await partner.listTranscripts(consentId);
  const texts = await Promise.all(listed.map((t) => partner.fetchTranscript(consentId, t.id)));
  return texts.map(parseTranscript);
}

export type { TranscriptPartner } from "./types";
