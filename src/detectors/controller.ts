import { BOOKS_URGENT_KINDS, BOOKS_WORRYING_KINDS } from "@/config/books";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { dollars, evidence } from "./helpers";

// Detectors for Jane running the money (Phase AP, spec steps 238–244): the books, the
// figures, the paycheck, goals, two people, price rises and the month's close. Pure; see
// ./contract.ts.

// Spec step 238: something in the person's data doesn't add up (a balance off from its
// transactions, transactions that stopped, a link that needs a sign-in or stopped updating,
// the same account linked twice). The figures that rely on it are what's at stake.
const books: Detector = {
  covers: ["books_check"],
  capability: "books",
  topic: "data_problems",
  needs: [],
  detect({ profile, data }) {
    const issues = (data.extras?.books ?? []).filter((i) => BOOKS_WORRYING_KINDS.includes(i.kind));
    if (issues.length === 0) return null;
    const affected = new Set(issues.map((i) => i.accountId).filter((id): id is string => !!id));
    const atStake = data.accounts
      .filter((a) => affected.has(a.id))
      .reduce((s, a) => s + Math.abs(a.balanceCents), 0);
    const first = issues[0];
    const n = issues.length;
    return {
      id: suggestionId("books", "data_problems"),
      capability: "books",
      topic: "data_problems",
      title:
        n === 1
          ? "Fix the one thing in your accounts that doesn't add up"
          : `Fix the ${n} things in your accounts that don't add up`,
      headline:
        atStake > 0
          ? `Check your accounts: ${dollars(atStake)} may be counted wrong`
          : "Check your accounts: something doesn't add up",
      short:
        atStake > 0
          ? `${n} data problem${n === 1 ? "" : "s"}; ${formatCents(atStake)} of your figures rest${n === 1 ? "s" : ""} on ${n === 1 ? "it" : "them"}.`
          : `${n} data problem${n === 1 ? "" : "s"} I check every day.`,
      worthCents: atStake,
      worthKind: "risk",
      confidence: evidence("seen", Math.max(profile.months, 1), n, "data problem"),
      urgency: issues.some((i) => BOOKS_URGENT_KINDS.includes(i.kind)) ? "now" : "soon",
      why: `${first.words || "Something in your accounts doesn't add up."}${
        atStake > 0
          ? ` Until it's fixed, ${formatCents(atStake)} in your figures is marked as unsure.`
          : ""
      }`,
      action: { label: "See what doesn't add up", href: "/net-worth" },
    };
  },
};

export const CONTROLLER_DETECTORS: readonly Detector[] = [books];
