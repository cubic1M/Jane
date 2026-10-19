import type { Reply } from "./replies";
import type { SearchResult } from "./search";

// Spec step 96: "search for Netflix" in the chat: how many messages, the newest few, and
// a link to them all on the search page. Pure.

const SHOWN = 3;
const day = (d: Date, timezone: string | null) =>
  d.toLocaleDateString("en-US", {
    timeZone: timezone ?? "America/Los_Angeles",
    month: "short",
    day: "numeric",
  });

export function searchReply(
  query: string,
  results: readonly SearchResult[],
  timezone: string | null,
): Reply {
  const all = {
    id: "open" as const,
    label: "See them all",
    kind: "link" as const,
    href: `/chat/search?q=${encodeURIComponent(query)}`,
  };
  if (results.length === 0) {
    return { body: `I didn't find "${query}" anywhere in our chat.`, actions: [], refs: {} };
  }
  return {
    body: [
      `I found ${results.length} ${results.length === 1 ? "message" : "messages"} with "${query}", the newest first.`,
      ...results
        .slice(0, SHOWN)
        .map((r) => `- ${day(r.createdAt, timezone)}: ${r.body.split("\n")[0].slice(0, 80)}`),
    ].join("\n"),
    actions: [all],
    refs: {},
  };
}
