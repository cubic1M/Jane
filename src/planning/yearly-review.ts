// The yearly investing review (spec step 216, demo advice). Pure: one list of items, each
// with where it stands, what Jane did on its own within the person's caps, or what waits
// for a tap. The review itself never moves money: it only lists, and every tap is its own.

export type ReviewItem = {
  key:
    | "contributions"
    | "match"
    | "rollover"
    | "rebalance"
    | "harvest"
    | "fees"
    | "goals"
    | "did"
    | "asked";
  // done: Jane handled it; tap: waits for the person; ok: nothing to do; info: for reading.
  status: "done" | "tap" | "ok" | "info";
  line: string;
  // The id of the existing action button that does it, if it needs a tap.
  action?: string;
};

export type ReviewInput = {
  year: number;
  // Why now: the yearly review, or a raise or a new job.
  reason: "yearly" | "raise";
  limits: { label: string; usedCents: number; limitCents: number; roomCents: number }[];
  match: { missedCents: number; tapAvailable: boolean } | null;
  iraTap: { cents: number } | null;
  oldPlans: { employer: string; savedCents: number }[];
  rebalance: { orders: number; summary: string } | null;
  harvest: { count: number; lossCents: number } | null;
  fees: { yearlyCents: number; savingCents: number } | null;
  goals: {
    name: string;
    percent: number;
    monthlyCents: number | null;
    monthsLeft: number | null;
  }[];
  did: string[];
  asked: string[];
};

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildReview(i: ReviewInput): ReviewItem[] {
  const items: ReviewItem[] = [];
  if (i.did.length > 0) {
    items.push({
      key: "did",
      status: "done",
      line: `What I did within your caps: ${i.did.join("; ")}.`,
    });
  }
  if (i.asked.length > 0) {
    items.push({
      key: "asked",
      status: "tap",
      line: `Over your caps, so waiting for you: ${i.asked.join("; ")}.`,
    });
  }
  if (i.limits.length > 0) {
    const open = i.limits.filter((l) => l.roomCents > 0);
    items.push({
      key: "contributions",
      status: i.iraTap ? "tap" : open.length > 0 ? "info" : "ok",
      line:
        open.length === 0
          ? "You've used your retirement account limits this year."
          : `Room left this year: ${open.map((l) => `${l.label} ${dollars(l.roomCents)} of ${dollars(l.limitCents)}`).join("; ")}.`,
      ...(i.iraTap ? { action: "retire.ira" } : {}),
    });
  }
  if (i.match) {
    items.push({
      key: "match",
      status: i.match.missedCents > 0 ? (i.match.tapAvailable ? "tap" : "info") : "ok",
      line:
        i.match.missedCents > 0
          ? `You're leaving about ${dollars(i.match.missedCents)} a year of employer match on the table.`
          : "You're getting the whole employer match.",
      ...(i.match.missedCents > 0 && i.match.tapAvailable ? { action: "retire.match" } : {}),
    });
  }
  for (const p of i.oldPlans) {
    items.push({
      key: "rollover",
      status: "tap",
      line: `${p.employer}'s old 401(k) could come home; moving it would cut fees by about ${dollars(p.savedCents)} a year.`,
      action: "oldplan.rollover",
    });
  }
  items.push(
    i.rebalance && i.rebalance.orders > 0
      ? {
          key: "rebalance",
          status: "tap",
          line: `Your mix has drifted. ${i.rebalance.summary}`,
          action: "invest.rebalance",
        }
      : { key: "rebalance", status: "ok", line: "Your mix is on target." },
  );
  if (i.harvest && i.harvest.count > 0) {
    items.push({
      key: "harvest",
      status: "tap",
      line: `${i.harvest.count === 1 ? "A holding is" : `${i.harvest.count} holdings are`} down by ${dollars(i.harvest.lossCents)} in all; selling into a similar fund would count the loss for taxes and keep you invested.`,
      action: "review.harvest",
    });
  }
  if (i.fees) {
    items.push({
      key: "fees",
      status: "info",
      line: `Investing costs you about ${dollars(i.fees.yearlyCents)} a year${i.fees.savingCents > 0 ? `; similar low-cost funds could save about ${dollars(i.fees.savingCents)} of it` : ""}.`,
    });
  }
  if (i.goals.length > 0) {
    items.push({
      key: "goals",
      status: "info",
      line: `Your goals: ${i.goals
        .map(
          (g) =>
            `${g.name} ${g.percent}% there${g.monthlyCents !== null && g.monthsLeft !== null ? `, ${dollars(g.monthlyCents)} a month for ${g.monthsLeft} months finishes it` : ""}`,
        )
        .join("; ")}.`,
    });
  }
  return items;
}

// The words on top.
export const reviewIntro = (i: Pick<ReviewInput, "year" | "reason">) =>
  i.reason === "raise"
    ? "Congratulations on the raise. Here's what it changes in your investing:"
    : `Your ${i.year} investing review, all in one place:`;
