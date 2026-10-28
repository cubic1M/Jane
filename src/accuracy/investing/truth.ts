import type { PersonId } from "@/config/people";

// The investing accuracy bench's truth: for every investing detector, which of the eight sample
// people it should reach, written from each person's life (docs/detectors/investing.md, the
// blurbs in src/config/people.ts), not from what the detector does. A person in `yes` should
// get it; one in `maybe` may or may not (either is fine); everyone else must not. A detector with
// no entry here fails its test, so a new one arrives with its truth.
//
// Maya (renter, 24, thin 401(k)), the Reyes (family, kids, mortgage, target-date 401(k)), Sam
// (freelancer, no retirement), Priya (equity: big salary, company stock, idle cash, an HSA),
// Dan and Lena (couple near retirement, big 401(k), old plan, brokerage), Ruth (retiree, IRA,
// annuity), Chris (debt trouble, nothing invested), Jo (small-business owner).

export type Truth = { yes: readonly PersonId[]; maybe?: readonly PersonId[] };

export const INVESTING_TRUTH: Readonly<Record<string, Truth>> = {
  employer_match: { yes: ["renter"] },
  catch_up: { yes: ["preretire"] },
  hsa: { yes: ["equity"] },
  backdoor_roth: { yes: ["equity"] },
  education_529: { yes: ["family"] },
  rmd: { yes: ["retiree"] },
  investment_fees: { yes: ["family", "equity", "preretire", "retiree"] },
  rebalance: { yes: ["family", "preretire", "retiree"], maybe: ["equity"] },
  auto_invest: { yes: ["equity"], maybe: ["preretire", "family"] },
  old_accounts: { yes: ["preretire"] },
  asset_location: { yes: ["equity"] },
  costly_products: { yes: ["retiree"] },
  plan_menu: { yes: ["family", "equity", "preretire"] },
  short_term_cash: { yes: ["equity", "preretire", "retiree"], maybe: ["family"] },
  sudden_money: { yes: ["equity"] },
  values_funds: { yes: ["equity"] },
  beneficiaries: { yes: ["family", "preretire"] },
  invested_cash: { yes: ["equity", "preretire"], maybe: ["family", "retiree"] },
  concentration: { yes: ["equity"] },
  retirement_self_employed: { yes: ["freelancer", "owner"] },
  idle_cash: { yes: ["equity", "preretire", "retiree"], maybe: ["family"] },
  social_security_timing: { yes: ["preretire"] },
};
