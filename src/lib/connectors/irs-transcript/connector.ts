import type { Connector } from "../types";

// The person's own IRS account transcript, downloaded from their IRS Online Account
// (./parse.ts): read only, no vendor, no act. Kept apart from ./parse.ts so the registry doesn't
// import the consent code it uses.
export const irsTranscriptUpload: Connector = {
  id: "irs_transcript_upload",
  name: "Your IRS account transcript, from your IRS Online Account",
  category: "tax",
  capabilities: ["read"],
  scopes: ["read_accounts"],
  sandbox: false,
  movesMoney: false,
};
