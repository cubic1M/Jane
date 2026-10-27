import { BOOKS_URGENT_KINDS, BOOKS_WORRYING_KINDS } from "@/config/books";
import { previousMonth } from "@/insights/check-in";
import { formatCents, formatWholeDollars } from "@/lib/money";
import { uncertainOf } from "@/planning/month-close";
import { monthName } from "@/planning/monthly-report";
import { type Detector, suggestionId } from "./contract";
import { evidence, nice } from "./helpers";

// Detectors for Jane running the money (Phase AP, spec steps 238–244): the books, the
// figures, the paycheck, goals, two people, price rises and the month's close. Pure; see
// ./contract.ts.

// Spec step 238: something in the person's data doesn't add up (a balance off from its
// transactions, transactions that stopped, a link that needs a sign-in or stopped updating,
// the same account linked twice). The figures that rely on it are what's at stake.
const books: Detector = {
  // A link that needs a sign-in is also what the connections tool reports when asked.
  covers: ["books_check", "connections"],
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
          ? `Check your accounts: ${formatWholeDollars(atStake)} may be counted wrong`
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

// Spec step 244: last month can't close by itself, because some charges sit in a catch-all
// category Jane isn't sure of. One tap (or a fix) closes it.
const monthClose: Detector = {
  covers: ["month_close"],
  capability: "close",
  topic: "month_close",
  needs: [],
  detect({ profile, data }) {
    if (data.extras?.lastCloseStatus === "closed") return null;
    const month = previousMonth(profile.today);
    const unsure = uncertainOf(
      data.transactions.map((t, i) => ({
        id: String(i),
        date: t.date,
        amountCents: t.amountCents,
        description: t.description,
        pfcPrimary: null,
        pfcDetailed: t.pfc,
        categorySource: null,
      })),
      month,
    );
    if (unsure.length === 0) return null;
    const total = unsure.reduce((s, t) => s + t.amountCents, 0);
    const names = unsure.map((t) => `${nice(t.description)} ${formatCents(t.amountCents)}`);
    return {
      id: suggestionId("close", "month_close"),
      capability: "close",
      topic: "month_close",
      title: `Confirm ${unsure.length === 1 ? "one charge" : `${unsure.length} charges`} so ${monthName(month)} can close`,
      headline: `Confirm ${unsure.length} charge${unsure.length === 1 ? "" : "s"} to close ${monthName(month).split(" ")[0]}: ${formatWholeDollars(total)}`,
      short:
        `${names.join(", ")}: I'm not sure what ${unsure.length === 1 ? "it was" : "they were"}.`.slice(
          0,
          120,
        ),
      worthCents: total,
      worthKind: "risk",
      confidence: evidence("seen", Math.max(profile.months, 1), unsure.length, "unsure charge"),
      urgency: "soon",
      why: `I close each month on the first of the next. In ${monthName(month)}, ${names.join(" and ")} sit in a catch-all category, so I can't tell if ${unsure.length === 1 ? "it's" : "they're"} personal or a business cost. Confirm or fix ${unsure.length === 1 ? "it" : "them"} and the month closes, its figures kept.`,
      action: { label: "Confirm the charges", href: "/monthly#close" },
    };
  },
};

export const CONTROLLER_DETECTORS: readonly Detector[] = [books, monthClose];
