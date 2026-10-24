import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { MessageSource } from "./source";

// Books that balance (spec step 238): what doesn't add up in the person's data, one message
// per problem, once. A link that needs a sign-in becomes one reconnect message.
export const booksSource: MessageSource = {
  key: "books",
  gather(snapshot) {
    return (snapshot.books?.open ?? []).slice(0, 2).map((issue) => {
      // An imported account whose file ended (real-user QA): a fresh import, not a reconnect.
      const imported = issue.kind === "stale" && issue.accountId !== null && issue.itemId === null;
      return {
        kind: "heads_up" as const,
        body:
          issue.kind === "broken"
            ? `${issue.words} It takes a minute, and nothing changes in your accounts.`
            : imported
              ? issue.words
              : `${issue.words} Figures that rely on it are marked until it's fixed.`,
        refs: {},
        actions: [
          imported
            ? {
                id: "open" as const,
                label: "Import a newer file",
                kind: "link" as const,
                href: "/import",
              }
            : {
                id: "open" as const,
                label: issue.kind === "broken" ? "Reconnect" : "Check my accounts",
                kind: "link" as const,
                href: "/connect",
              },
        ],
        dedupeKey: issue.id,
        priority: MESSAGE_PRIORITY.books,
      };
    });
  },
};
