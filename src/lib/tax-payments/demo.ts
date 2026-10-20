import { createHash } from "node:crypto";
import type { TaxPaymentPartner } from "./types";

// The stand-in for an estimated tax payment. It moves no money and contacts no one: it
// returns a confirmation number the same way every time for the same payment.
export const demoTaxPaymentPartner: TaxPaymentPartner = {
  name: "demo",
  async pay({ userId, dueOn, cents }) {
    const digest = createHash("sha256").update(`${userId}:${dueOn}:${cents}`).digest("hex");
    return {
      confirmation: `DEMO-${dueOn.replaceAll("-", "")}-${digest.slice(0, 8).toUpperCase()}`,
    };
  },
};
