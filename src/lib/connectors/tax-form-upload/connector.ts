import type { Connector } from "../types";

// The person's own W-2s and 1099s, as the PDFs they download from their employer, bank or broker
// (./parse.ts): read only, no vendor, no act. Kept apart from ./parse.ts so the registry doesn't
// import the consent code it uses.
export const taxFormUpload: Connector = {
  id: "tax_form_upload",
  name: "Your W-2s and 1099s, from the PDFs you download",
  category: "tax",
  capabilities: ["read"],
  scopes: ["read_accounts"],
  sandbox: false,
  movesMoney: false,
};
