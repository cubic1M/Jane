import type { ActionType } from "@/generated/prisma/client";

// Referral partners the concierge sends people to. A card shows a disclosure line only
// when its action uses a partner, so leave an entry null until an agreement is signed.
// Open question in the spec: which insurance marketplace and high-yield account to use.

export type ReferralPartner = {
  name: string;
  // Shown on the card, word for word, before the person says yes.
  disclosure: string;
};

export const REFERRAL_PARTNERS: Partial<Record<ActionType, ReferralPartner | null>> = {
  insurance_reshop: null,
  move_idle_cash: null,
};
