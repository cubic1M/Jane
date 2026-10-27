import { formatCents, formatWholeDollars } from "@/lib/money";
import { tradeoffs } from "@/planning/goal-tradeoffs";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, monthlySpendCents, weakest } from "./helpers";

// Goals that trade off openly (spec step 241), brought to the person unasked: savings goals
// that together need more each month than there is room for, so one has to wait. Pure; see
// ./contract.ts.

const goalTradeoffs: Detector = {
  covers: ["goal_tradeoffs"],
  capability: "tradeoffs",
  topic: "goal_tradeoffs",
  needs: ["monthly_income"],
  detect({ profile, data }) {
    const goals = data.extras?.goals ?? [];
    if (goals.length < 2) return null;
    const income = profile.facts.monthly_income;
    // The year plan's room when it's been kept; otherwise what's left of income after spending.
    const planned = data.extras?.goalRoomCents;
    const room =
      typeof planned === "number"
        ? planned
        : Math.max(
            0,
            (typeof income.value === "number" ? income.value : 0) -
              monthlySpendCents(data, profile.months),
          );
    const view = tradeoffs([...goals], [room], profile.today.slice(0, 7));
    if (!view.competing || !view.suggested) return null;
    const needed = goals.reduce((s, g) => s + g.monthlyCents, 0);
    const short = Math.max(0, needed - room);
    const late = view.suggested.dates.find((d) => (d.lateMonths ?? 0) > 0);
    return {
      id: suggestionId("tradeoffs", "goal_tradeoffs"),
      capability: "tradeoffs",
      topic: "goal_tradeoffs",
      title: "Choose which goal comes first, with each one's date in front of you",
      headline: `Plan your goals' order: ${formatWholeDollars(short * 12)} a year short`,
      short: `Your goals need ${formatCents(needed)} a month; there's room for ${formatCents(room)}.`,
      worthCents: short * 12,
      worthKind: "risk",
      confidence: weakest([
        typeof planned === "number"
          ? evidence("seen", Math.max(profile.months, 1), goals.length, "goal")
          : factEvidence(income),
        evidence("seen", Math.max(profile.months, 1), profile.months, "month of spending"),
      ]),
      urgency: "soon",
      why: `${goals.map((g) => g.name).join(" and ")} need ${formatCents(needed)} a month together to be on time, and there's room for about ${formatCents(room)}. ${view.reason}${late ? ` Pick the order and I'll fund them that way.` : ""}`,
      action: { label: "Compare the orders", href: "/goals#tradeoffs" },
    };
  },
};

export const TRADEOFF_DETECTORS: readonly Detector[] = [goalTradeoffs];
