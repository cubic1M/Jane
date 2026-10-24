import { formatCents } from "@/lib/money";
import { lowersCover } from "./saving-rules";
import type { SavingKind } from "@/config/insurance";

// The yearly insurance review (spec step 202): everything the year's checks found, in one
// message. What Jane did by herself within the person's caps, what needs their tap, and the
// yearly money involved. Pure: the data in, the lines and buttons out.

export type ReviewInput = {
  // The autopilot level for insurance ("all" is Everything allowed).
  level: string;
  // What Jane did by herself lately, within the caps.
  did: string[];
  // What the savings applied lately come to a year, by her or by the person's tap.
  savedYearlyCents: number;
  // Savings offered and waiting (a tap away), by kind.
  savings: { kind: SavingKind; yearlySavingCents: number }[];
  // Renewal calls to the insurer waiting for a yes.
  calls: number;
  risks: number;
  coverChanges: number;
  gaps: number;
  // The coverage checkup's recommendations, and what they would save or cost a year.
  recommendations: { title: string; cost: string; costCents: number; cents: number[] }[];
  claimDrafts: number;
  health: { fsaLeftCents: number; fsaDeadline: string | null; disputes: number } | null;
  // Spec step 280: gaps a life event opened (a new car, a move, a baby), with the reason, and
  // the need's own sentence and figures.
  opened?: {
    kind: string;
    policyId: string | null;
    because: string;
    summary: string;
    cents: number[];
  }[];
};

export type ReviewItem = {
  key: string;
  text: string;
  // The button for it: the one tap that handles it (the review's own), or a link to it.
  button: { label: string; href: string | null };
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);

export function reviewItems(r: ReviewInput): ReviewItem[] {
  const same = r.savings.filter((s) => !lowersCover(s.kind));
  const lower = r.savings.filter((s) => lowersCover(s.kind));
  const items: ReviewItem[] = [];
  if (same.length + r.calls > 0) {
    const parts = [
      ...(same.length > 0
        ? [
            `${same.length} ${plural(same.length, "way", "ways")} to pay less for the same cover, up to ${formatCents(sum(same.map((s) => s.yearlySavingCents)))} a year`,
          ]
        : []),
      ...(r.calls > 0
        ? [`${r.calls} ${plural(r.calls, "renewal", "renewals")} I can call your insurer about`]
        : []),
    ];
    items.push({
      key: "keep_covered",
      text: parts.join(" and "),
      button: { label: "Keep me covered", href: null },
    });
  }
  if (lower.length > 0) {
    items.push({
      key: "deductible",
      text: `a higher deductible would save up to ${formatCents(sum(lower.map((s) => s.yearlySavingCents)))} a year, but lowers your cover`,
      button: { label: "Look at the deductible", href: "/insurance?focus=savings" },
    });
  }
  if (r.risks > 0) {
    items.push({
      key: "risks",
      text: `${r.risks} ${plural(r.risks, "question", "questions")} about how you live`,
      button: { label: "Answer them", href: "/insurance?focus=questions" },
    });
  }
  if (r.coverChanges > 0) {
    items.push({
      key: "cover_changes",
      text: `${r.coverChanges} cover ${plural(r.coverChanges, "change", "changes")} for what's changed in your life`,
      button: { label: "See the changes", href: "/insurance?focus=changes" },
    });
  }
  // One line per life event, with its gaps' own sentences and a button to the first one's options.
  const events = [...new Set((r.opened ?? []).map((o) => o.because))];
  for (const because of events) {
    const gaps = (r.opened ?? []).filter((o) => o.because === because);
    const first = gaps[0];
    items.push({
      key: `opened:${because}`,
      text: `because of ${because}: ${gaps.map((g) => g.summary.replace(/\.$/, "")).join("; ")}`,
      button: {
        label: events.length === 1 ? "See options" : `See options: ${because}`,
        href: `/insurance?need=${first.kind}${first.policyId ? `&policy=${first.policyId}` : ""}#options`,
      },
    });
  }
  if (r.gaps > 0) {
    items.push({
      key: "gaps",
      text: `${r.gaps} ${plural(r.gaps, "gap", "gaps")} in your cover`,
      button: { label: "See the gaps", href: "/insurance?focus=missing" },
    });
  }
  if (r.recommendations.length > 0) {
    items.push({
      key: "checkup",
      text: `${r.recommendations.length} ${plural(r.recommendations.length, "change", "changes")} from your coverage checkup: ${r.recommendations
        .slice(0, 3)
        .map((x) => `${x.title.replace(/\.$/, "")} (${x.cost.toLowerCase()})`)
        .join("; ")}`,
      button: { label: "See the checkup", href: "/insurance/checkup" },
    });
  }
  if (r.claimDrafts > 0) {
    items.push({
      key: "claims",
      text: `${r.claimDrafts} ${plural(r.claimDrafts, "claim", "claims")} ready for you to check`,
      button: { label: "Check the claims", href: "/insurance/claims" },
    });
  }
  if (r.health && (r.health.fsaLeftCents > 0 || r.health.disputes > 0)) {
    items.push({
      key: "health",
      text: [
        ...(r.health.fsaLeftCents > 0
          ? [`${formatCents(r.health.fsaLeftCents)} left in your FSA before it's lost`]
          : []),
        ...(r.health.disputes > 0
          ? [
              `${r.health.disputes} ${plural(r.health.disputes, "bill", "bills")} above your plan's share`,
            ]
          : []),
      ].join(" and "),
      button: { label: "Your health year", href: "/insurance?focus=health" },
    });
  }
  return items;
}

// Yearly money: what Jane's changes already save, and what is still waiting.
export function reviewMoney(r: ReviewInput): { savedCents: number; waitingCents: number } {
  const checkupSavings = r.recommendations.filter((x) => x.costCents < 0).map((x) => -x.costCents);
  return {
    savedCents: r.savedYearlyCents,
    waitingCents: sum(r.savings.map((s) => s.yearlySavingCents)) + sum(checkupSavings),
  };
}

export function reviewBody(r: ReviewInput): string {
  const items = reviewItems(r);
  const money = reviewMoney(r);
  const lines = ["Your yearly insurance review."];
  lines.push(
    r.did.length > 0
      ? `What I did within your limits:\n${r.did.map((d) => `- ${d}`).join("\n")}`
      : r.level === "all"
        ? "I haven't had to change anything on my own."
        : "I haven't changed anything on my own: nothing that changes a price happens without your tap.",
  );
  lines.push(
    items.length > 0
      ? `What needs your tap:\n${items.map((i) => `- ${i.text}`).join("\n")}`
      : "Nothing needs your tap: your cover looks right.",
  );
  const money_ = [
    ...(money.savedCents > 0
      ? [`about ${formatCents(money.savedCents)} a year already saved`]
      : []),
    ...(money.waitingCents > 0
      ? [`up to ${formatCents(money.waitingCents)} a year waiting for you`]
      : []),
  ];
  if (money_.length > 0) lines.push(`In a year: ${money_.join(", and ")}.`);
  return lines.join("\n");
}

// Every dollar figure in the body, for the guardrails.
export function reviewCents(r: ReviewInput, extra: number[] = []): number[] {
  const money = reviewMoney(r);
  return [
    ...extra,
    money.savedCents,
    money.waitingCents,
    sum(r.savings.filter((s) => !lowersCover(s.kind)).map((s) => s.yearlySavingCents)),
    sum(r.savings.filter((s) => lowersCover(s.kind)).map((s) => s.yearlySavingCents)),
    r.health?.fsaLeftCents ?? 0,
    ...(r.opened ?? []).flatMap((o) => o.cents),
    ...r.recommendations.flatMap((x) => [Math.abs(x.costCents), ...x.cents]),
  ];
}
