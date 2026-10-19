import { DEMO_CARDS, DEMO_CARD_ACCOUNTS } from "@/data-sources/demo/demo-credit-cards";
import type { CreditCardPartner, CreditBand } from "./partner";

// The stand-in card partner for the demo bank (spec step 174). It keeps no state: an
// application is approved when the person's band meets the card's, else declined.

const RANK: Record<CreditBand, number> = { fair: 0, good: 1, excellent: 2 };
const byId = (id: string) => DEMO_CARDS.find((c) => c.id === id) ?? null;

export const demoCreditCards: CreditCardPartner = {
  name: "Demo card marketplace",
  async identify(accountName) {
    const id = DEMO_CARD_ACCOUNTS[accountName];
    return id ? byId(id) : null;
  },
  async catalog({ creditBand }) {
    return DEMO_CARDS.filter((c) => RANK[creditBand] >= RANK[c.minBand]);
  },
  async product(id) {
    return byId(id);
  },
  async apply({ product, creditBand }) {
    const status = RANK[creditBand] >= RANK[product.minBand] ? "approved" : "declined";
    return { applicationId: `demo-card-${product.id}-${crypto.randomUUID()}`, status };
  },
};
