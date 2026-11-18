import type { Connector } from "../types";

// Chart (read connectors, 11-18; developer.trychart.com, read 2026-11-17): a person's IRS account
// transcripts, for the refund tracker and the estimated payments the IRS has credited (the tax
// lane's), through Chart Connect.
//
// SANDBOX ONLY. Chart reads the IRS through the person's own IRS sign-in (or their tax software's,
// or a signed Form 8821) typed into Chart's flow. Whether Jane may send a person to type their IRS
// login into a third party is a question for counsel (connectors-final-A, its counsel list), so
// there is no real Chart connector: none may be registered, and none switched on in
// REAL_CONNECTORS, until counsel answers. Its client (./api.ts) and mapping are built and tested
// against Chart's documented shapes so that day is a registration, not a build. The sandbox twin
// reads Chart's record shape with the demo stand-in's figures, for sample data (./partner.ts).
export const sandboxChartTranscripts: Connector = {
  id: "sandbox_chart_transcripts",
  name: "Your IRS account transcripts, through Chart (sandbox)",
  category: "tax",
  capabilities: ["read"],
  scopes: ["read_accounts"],
  sandbox: true,
  movesMoney: false,
};
