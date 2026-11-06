import type { Connector } from "../types";

// The person's own credit report and score (./upload.ts): read only, no vendor, no act. Kept apart
// from ./upload.ts so the registry doesn't import the consent code it uses.
export const creditUpload: Connector = {
  id: "credit_upload",
  name: "Your own credit report and score",
  category: "credit",
  capabilities: ["read"],
  scopes: ["read_credit"],
  sandbox: false,
  movesMoney: false,
};
