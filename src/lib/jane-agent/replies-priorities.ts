import { TOP_THINGS } from "@/config/priorities";
import type { Ranked } from "@/planning/priorities";
import type { Reply } from "./replies";

// "What should I do first?" (spec step 143): the one to three things that matter most, each
// with why it's there.
export function prioritiesReply(ranked: Ranked[]): Reply {
  const top = ranked.slice(0, TOP_THINGS);
  if (top.length === 0) {
    return {
      body: "Nothing needs you right now. I'll tell you here when something does.",
      actions: [],
      refs: {},
    };
  }
  return {
    body: [
      top.length === 1
        ? "One thing matters most right now."
        : `These ${top.length} matter most right now.`,
      ...top.map((r, i) => `${i + 1}. ${r.title}. ${r.why}`),
    ].join("\n"),
    actions: top.map((r) => ({
      id: "open" as const,
      label: r.title.slice(0, 40),
      kind: "link" as const,
      href: r.href,
    })),
    refs: {},
  };
}
