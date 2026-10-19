import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { MessageSource } from "./source";

// The first-run conversation (spec step 140): the very first time Jane talks to someone,
// before anything else, a short hello with "Show me around" and "help". Once: only while
// the person has no messages yet, and never again after (its key).
export const welcomeSource: MessageSource = {
  key: "welcome",
  gather: (snapshot) =>
    snapshot.firstChat
      ? [
          {
            kind: "brief",
            body: "Hi, I'm Jane. I look at your money every day, bring you what matters here, and do the work when you say yes. Below is what I found so far. Ask me anything in the box at the bottom, or type help to see what I can do.",
            refs: {},
            actions: [
              { id: "welcome.tour", label: "Show me around", kind: "primary" },
              { id: "open", label: "See today", kind: "link", href: "/home" },
            ],
            dedupeKey: "hello",
            priority: MESSAGE_PRIORITY.welcome,
          },
        ]
      : [],
};
