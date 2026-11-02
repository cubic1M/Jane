import { REAL_ACCOUNT_ADVICE } from "@/config/advice";
import { requireGrant } from "@/lib/permission/gate";

// Investment recommendations through a registered adviser (Stage 4: recommendations first, with any
// automatic management after that). An interface and a mock only: no adviser exists yet. The plan is
// a Jane-owned, state-registered adviser that gives advice only, non-discretionary (connector-plan.md),
// which needs a registration, a principal's Series 65 or waiver, and counsel. It can't override
// REAL_ACCOUNT_ADVICE: while that's false, a real account gets none, whatever partner is given.

export type Recommendation = {
  title: string;
  // Who stands behind it: the adviser's registered name, shown with it.
  adviserName: string;
  rationale: string;
};

export interface AdviserPartner {
  readonly name: string;
  // The person must have accepted the adviser's own agreement and disclosure first.
  recommend(person: { accountIds: readonly string[] }): Promise<Recommendation[]>;
}

export class AdviceOff extends Error {
  constructor() {
    super("Real accounts don't get investment recommendations.");
    this.name = "AdviceOff";
  }
}

// The only door to one, for a real account.
export async function realAccountRecommendations(
  partner: AdviserPartner | null,
  person: { accountIds: readonly string[] },
): Promise<Recommendation[]> {
  if (!(REAL_ACCOUNT_ADVICE as boolean) || !partner) throw new AdviceOff();
  requireGrant("brokerage");
  return partner.recommend(person);
}
