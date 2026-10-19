import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { PROFILE_QUESTIONS } from "@/config/investing";
import { formatCents } from "@/lib/money";
import { nextQuestion, profileSummary } from "@/planning/investor-profile";
import { equivalentLine, switchSummary } from "../investments/fees-copy";
import { matchLine, projectionLine } from "../investments/retirement-copy";
import { asking, PROFILE_INTRO } from "../investments/profile-question";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Investments in the chat (spec step 128 on). What Jane does by herself, at every autopilot
// level:
// - Step 128: keeps the holdings up to date on each sync, and says once that she can see
//   them. Nothing to approve.
// - Step 129: in demo advice mode, asks the four investor-profile questions once she can see
//   holdings, and again a year after they were answered. She never answers or changes them
//   herself; nothing uses the profile until all four are in.
// - Step 130: in demo advice mode, finds what investing costs and a lower-cost equivalent
//   for each costly fund, and says so once (again if the funds change). Switching moves
//   money, so it always waits for the person's tap (step 133).
// - Step 131: in demo advice mode, once the profile is complete, reviews the mix against
//   its target and says what to change and why (again when that changes).
// - Step 132: in demo advice mode, once the profile is complete, checks the retirement
//   projection and the employer match, and says so when the person is behind or missing
//   match money (again when that changes). Raising a contribution is done at the
//   employer's plan, so Jane says how and checks the next contributions herself.

const list = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export const investmentsSource: MessageSource = {
  key: "investments",
  gather(snapshot) {
    const inv = snapshot.investments;
    if (!inv || inv.holdingCount === 0) return [];
    const out: Candidate[] = [
      {
        kind: "heads_up",
        body: `I can see what's in your investment accounts now: ${inv.holdingCount} ${inv.holdingCount === 1 ? "holding" : "holdings"} worth ${formatCents(inv.totalCents)} in ${list(inv.accounts.map((a) => a.name))}. Every number shows where it came from, and I'll keep it up to date.`,
        refs: {},
        actions: [
          { id: "open", label: "See what you own", kind: "link", href: "/investments" },
          snoozeButton(),
        ],
        dedupeKey: "holdings",
        priority: MESSAGE_PRIORITY.investments,
      },
    ];
    if (inv.advice) {
      const next = nextQuestion(inv.profile);
      const summary = profileSummary(inv.profile, snapshot.asOf);
      // A year on, all four again (a new key each year).
      const again = summary.complete && summary.stale;
      const question = next ?? (again ? PROFILE_QUESTIONS[0] : null);
      if (question) {
        const ask = asking(question, again);
        out.push({
          kind: "decision",
          body: again
            ? "It's been a year since you told me what your investments are for. Has anything changed? Tap your answers again; the rest stays as it was."
            : PROFILE_INTRO,
          refs: ask.refs,
          actions: [...ask.actions, snoozeButton()],
          dedupeKey: again ? `profile:${snapshot.asOf.slice(0, 4)}` : "profile",
          priority: MESSAGE_PRIORITY.investment_profile,
        });
      }
    }
    const fees = inv.fees;
    if (inv.advice && fees.equivalents.length > 0) {
      const tickers = fees.equivalents.map((e) => `${e.holding.ticker}>${e.ticker}`).sort();
      out.push({
        kind: "heads_up",
        body: `Your investments cost about ${formatCents(fees.totalYearlyCents)} a year in fees. ${equivalentLine(fees.equivalents[0])}${fees.equivalents.length > 1 ? ` I found ${fees.equivalents.length - 1} more like it.` : ""} ${switchSummary(fees.equivalents, fees.years)}`,
        refs: { advice: true },
        actions: [
          { id: "open", label: "See the fees", kind: "link", href: "/investments/fees" },
          snoozeButton(),
        ],
        dedupeKey: `fees:${tickers.join(",")}`,
        priority: MESSAGE_PRIORITY.investment_fees,
      });
    }
    const review = inv.review;
    if (inv.advice && review && review.recommendations.length > 0) {
      const [first, ...rest] = review.recommendations;
      out.push({
        kind: "heads_up",
        body: `I've reviewed your investments against your ${review.riskLabel.toLowerCase()} profile. ${first.what} ${first.why}${rest.length > 0 ? ` And ${rest.length} more ${rest.length === 1 ? "change" : "changes"} on the review.` : ""}`,
        refs: { advice: true },
        actions: [
          { id: "open", label: "See the review", kind: "link", href: "/investments/review" },
          snoozeButton(),
        ],
        dedupeKey: `review:${review.riskLevel}:${review.recommendations.map((r) => r.kind).join(",")}`,
        priority: MESSAGE_PRIORITY.investment_review,
      });
    }
    const retirement = inv.retirement;
    if (
      inv.advice &&
      retirement &&
      (retirement.status === "behind" ||
        retirement.status === "maybe" ||
        (retirement.match !== null && !retirement.match.captured))
    ) {
      const match = matchLine(retirement);
      const first = retirement.changes[0];
      out.push({
        kind: "heads_up",
        body: [projectionLine(retirement), match, first ? `First step: ${first.what}` : null]
          .filter(Boolean)
          .join(" "),
        refs: { advice: true },
        actions: [
          {
            id: "open",
            label: "See your retirement plan",
            kind: "link",
            href: "/investments/retirement",
          },
          snoozeButton(),
        ],
        dedupeKey: `retirement:${retirement.status}:${retirement.match?.captured ?? "none"}`,
        priority: MESSAGE_PRIORITY.retirement,
      });
    }
    return out;
  },
};
