import type { Candidate } from "@/lib/investments/short-term";
import { compare, ladder } from "@/planning/short-term";

// A short-term money candidate (spec step 234) as loadShortTerm builds one, twelve months out, for
// `amountCents`: a goal ("goal:g1") or the emergency fund, with or without a ladder of bills.
export const shortCandidate = (
  amountCents: number,
  { key = "goal:g1", name = "House down payment", withLadder = true } = {},
): Candidate => {
  const options = compare({ amountCents, months: 12, fed: 0.24, state: 0.093 });
  const best = options[0];
  const hysa = options.find((o) => o.product.key === "hysa") ?? best;
  return {
    key,
    purpose: key === "emergency" ? "emergency" : "goal",
    goalId: key === "emergency" ? null : key.slice("goal:".length),
    name,
    amountCents,
    months: 12,
    endsOn: "2027-11-24",
    options,
    best,
    ladder: withLadder ? ladder(amountCents, 12) : null,
    gainCents: best.yearlyCents - hysa.yearlyCents,
    hasLadder: false,
  };
};
