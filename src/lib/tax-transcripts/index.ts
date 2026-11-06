import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { parseTranscript, type Transcript } from "@/lib/connectors/irs-transcript/parse";
import { demoTranscriptPartner } from "./demo";
import type { TranscriptPartner } from "./types";

// Which partner reads a person's IRS transcripts: the stand-in for people whose data is all the
// demo bank's (the same test as demo advice mode); nobody else until a real partner is contracted.

type Options = { client?: PrismaClient; now?: Date };

export async function transcriptPartnerFor(
  userId: string,
  { client, now = new Date() }: Options = {},
): Promise<TranscriptPartner | null> {
  return (await adviceMode(userId, { client }))
    ? demoTranscriptPartner(now.getUTCFullYear())
    : null;
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
