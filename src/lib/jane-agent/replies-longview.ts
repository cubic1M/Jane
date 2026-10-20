import { formatCents } from "@/lib/money";
import type { LongView } from "@/lib/long-view";
import type { Reply } from "./replies";

// The long view in the chat (spec step 209): the 10, 20 and 30 year ranges and that it's
// a range with assumptions; for demo-advice people also what moves it most (labelled by the
// chat as advice), with the link to the page where the assumptions can be changed.
export function longViewReply(view: LongView | null): Reply {
  if (!view) {
    return {
      body: "Once your accounts are linked, I can show where your net worth could be in 10, 20 and 30 years.",
      actions: [],
      refs: {},
    };
  }
  const lines = [
    `If things carry on as they are, your net worth could be ${view.horizons
      .map((h) => `${formatCents(h.lowCents)} to ${formatCents(h.highCents)} in ${h.years} years`)
      .join(", ")}, in today's dollars.`,
    "That's a range from a low to a high return, not a promise; the assumptions are on the page and you can change them.",
  ];
  if (view.advice && view.levers[0]) {
    const top = view.levers[0];
    lines.push(
      `What moves it most: ${top.words.toLowerCase()} adds about ${formatCents(Math.abs(top.deltaCents))} at the low end after 30 years.`,
    );
  }
  return {
    body: lines.join(" "),
    actions: [{ id: "open", label: "See the long view", kind: "link", href: "/long-view" }],
    refs: view.advice && view.levers[0] ? { advice: true } : {},
  };
}
