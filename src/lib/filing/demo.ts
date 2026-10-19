import { DEMO_FILING_ACCEPT_HOURS } from "@/config/tax";
import type { FilingPartner } from "./types";

// The filing partner's stand-in (spec step 126): prepares the return from the package with
// Jane's own estimate as its preview, takes a signed submission, and reports it accepted a
// day later. It files nothing anywhere; it's only offered on demo-bank data.

export const demoFilingPartner: FilingPartner = {
  name: "demo",
  async createReturn(_pkg, preview) {
    return { partnerReturnId: `demo-return-${crypto.randomUUID()}`, preview };
  },
  async submitReturn(_id, signature) {
    if (!signature.name.trim()) throw new Error("A return needs a signature.");
    return { status: "submitted" };
  },
  async status(_id, submittedAt, now) {
    return now.getTime() - submittedAt.getTime() >= DEMO_FILING_ACCEPT_HOURS * 3_600_000
      ? "accepted"
      : "submitted";
  },
};
