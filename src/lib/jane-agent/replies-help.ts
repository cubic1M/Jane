import { HELP_GROUPS, HELP_MORE_LINKS } from "@/config/help";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Help inside the chat (spec step 140): what Jane can do, in groups, each with its page.

const link = (l: { label: string; href: string }): MessageAction => ({
  id: "open",
  label: l.label,
  kind: "link",
  href: l.href,
});

export function groupedHelpReply(): Reply {
  const lines = [
    "Here's what I can help with. Ask in your own words, and I'll answer with buttons for you to tap; I never act on what you type alone.",
    ...HELP_GROUPS.flatMap((g) => [g.title, ...g.examples.map((e) => `- ${e}`)]),
  ];
  return {
    body: lines.join("\n"),
    actions: [...HELP_GROUPS.map((g) => link(g.link)), ...HELP_MORE_LINKS.map(link)],
    refs: {},
  };
}

// The first-run tour (spec step 140): three things to know, after "Show me around".
export const TOUR_NOTE =
  "Three things to know. Messages with a yellow edge are things I found or did: tap Yes and I'm on it. Ask me anything in the box below, in your own words. And you choose how much I do by myself in Settings. Type help any time.";

export const TOUR_LINKS: readonly MessageAction[] = [
  link({ label: "Open the plan", href: "/plan" }),
  link({ label: "How much Jane does", href: "/settings#autopilot" }),
];
