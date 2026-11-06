import type { Connector } from "../types";

// The person's own federal student loans, from the "Download My Aid Data" file they get on
// studentaid.gov (./parse.ts): read only, no vendor, no act. Kept apart from ./parse.ts so the
// registry doesn't import the consent code it uses.
export const myAidUpload: Connector = {
  id: "my_aid_upload",
  name: "Your federal student loans, from studentaid.gov",
  category: "credit",
  capabilities: ["read"],
  scopes: ["read_accounts"],
  sandbox: false,
  movesMoney: false,
};
