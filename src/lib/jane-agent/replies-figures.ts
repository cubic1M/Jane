import { FIGURE_IDS, FIGURE_LABELS } from "@/config/figures";
import type { Working } from "@/lib/figures";
import type { Reply } from "./replies";

// "How did you get that?" in the chat (spec step 239): the working in a few lines, with the
// page that shows all of it and where to say it's wrong.
export function figureReply(working: Working | null): Reply {
  if (!working) {
    return {
      body: "Once your accounts are linked, I can show how I work out every figure.",
      actions: [],
      refs: {},
    };
  }
  const lines = [
    `${working.title} is ${working.value}. ${working.summary}`,
    working.rows
      .slice(0, 6)
      .map((r) => `${r.label}: ${r.value}`)
      .join("; ") + ".",
    working.corrections.length > 0
      ? "If something's wrong, you can fix it on the page and everything that used it updates."
      : null,
  ].filter((l): l is string => Boolean(l));
  return {
    body: lines.join(" "),
    actions: [{ id: "open", label: "See all of it", kind: "link", href: `/figures/${working.id}` }],
    refs: {},
  };
}

// No figure named: which one?
export function whichFigureReply(): Reply {
  return {
    body: "Which figure? I can show how I got any of these: safe to spend, your spending, your income, net worth, your money health score or your debt-free date.",
    actions: FIGURE_IDS.slice(0, 4).map((id) => ({
      id: "open" as const,
      label: FIGURE_LABELS[id],
      kind: "link" as const,
      href: `/figures/${id}`,
    })),
    refs: {},
  };
}
