import type { CoverChangeKind, CoverEvent, PolicyKind } from "@/config/insurance";

// Cover changes with life events (spec step 154): which changes each event needs, given the
// person's policies. Pure.

export type PolicyLite = { id: string; kind: PolicyKind; status: string };

export type PlannedChange = {
  change: CoverChangeKind;
  policyId: string | null;
  detail: Record<string, string | number>;
};

const active = (policies: PolicyLite[], ...kinds: PolicyKind[]) =>
  policies.filter((p) => p.status === "active" && kinds.includes(p.kind));

// Pure: the changes for one event. A car: added to the car policy, or car insurance to get.
// A move: the address on every home, renters and car policy. A baby: added to the health
// plan, and life cover checked. A marriage: the spouse added to the car and health policies,
// and life cover checked. A new job: the benefits there, and life cover checked.
export function changesFor(
  event: CoverEvent,
  policies: PolicyLite[],
  detail: Record<string, string | number> = {},
): PlannedChange[] {
  const each = (change: CoverChangeKind, kinds: PolicyKind[]) =>
    active(policies, ...kinds).map((p) => ({ change, policyId: p.id, detail }));
  const review = (change: CoverChangeKind): PlannedChange => ({ change, policyId: null, detail });
  switch (event) {
    case "car_bought": {
      const cars = each("add_vehicle", ["auto"]);
      return cars.length > 0 ? cars : [review("get_auto")];
    }
    case "moving":
      return each("address", ["home", "renters", "auto"]);
    case "new_baby":
      return [...each("add_dependant", ["health"]), review("review_life")];
    case "married":
      return [...each("add_spouse", ["auto", "health"]), review("review_life")];
    case "new_job":
      return [review("review_benefits"), review("review_life")];
  }
}
