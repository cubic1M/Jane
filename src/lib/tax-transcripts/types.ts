// IRS transcripts from a partner (connectors roadmap round 16, Stage 4): shaped like Chart, the one
// programmatic path the research found. The person signs in to the IRS through the partner and
// agrees there; then the partner lists their transcripts and hands each over as the IRS's own
// text. There's no partner yet (it needs a contract and 26 USC 6103(c) counsel), so only the demo
// bank's people get a stand-in (./demo.ts); real accounts upload their own transcript instead
// (src/lib/connectors/irs-transcript).

export type TranscriptListing = { id: string; kind: "account"; taxYear: number };

export interface TranscriptPartner {
  readonly name: string;
  // Where the person goes to agree, and the id the partner gives that agreement.
  startConsent(userId: string): Promise<{ consentId: string; url: string }>;
  listTranscripts(consentId: string): Promise<TranscriptListing[]>;
  // The transcript's text, as the IRS lays it out.
  fetchTranscript(consentId: string, id: string): Promise<string>;
}
