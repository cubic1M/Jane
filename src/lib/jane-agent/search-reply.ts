import type { Reply } from "./replies";
import type { SearchResult } from "./search";

// Spec step 96: "search for Netflix" in the chat: how many messages and the newest few. (The
// chat's own search box and page are gone, founder 2026-10-26.) Pure.

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
    actions: [],
    refs: {},
  };
}
