import { scopedFor } from "@/lib/db-scoped";
import type { Connector } from "../types";

// The person's own credit report and score (./upload.ts): read only, no vendor, no act. Kept apart
// from ./upload.ts so the registry doesn't import the consent code it uses.
export const creditUpload: Connector = {
  id: "credit_upload",
  name: "Your own credit report and score",
  from: "The report you download and upload yourself",
  category: "credit",
  capabilities: ["read"],
  scopes: ["read_credit"],
  sandbox: false,
  movesMoney: false,
  // Revoked: the reports read from the person's uploads go.
  forget: async ({ userId, client }) =>
    (await scopedFor(userId, client).creditReports.deleteMany({ where: { partner: "upload" } }))
      .count,
};
