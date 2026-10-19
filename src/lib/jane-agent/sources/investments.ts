import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { PROFILE_QUESTIONS } from "@/config/investing";
import { formatCents } from "@/lib/money";
import { nextQuestion, profileSummary } from "@/planning/investor-profile";
import { asking, PROFILE_INTRO } from "../investments/profile-question";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Investments in the chat (spec step 128 on). What Jane does by herself, at every autopilot
// level:
// - Step 128: keeps the holdings up to date on each sync, and says once that she can see
//   them. Nothing to approve.
// - Step 129: in demo advice mode, asks the four investor-profile questions once she can see
//   holdings, and again a year after they were answered. She never answers or changes them
//   herself; nothing uses the profile until all four are in.

const list = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export const investmentsSource: MessageSource = {
  key: "investments",
  gather(snapshot) {
    const inv = snapshot.investments;
    if (!inv || inv.holdingCount === 0) return [];
    const out: Candidate[] = [
      {
        kind: "heads_up",
        body: `I can see what's in your investment accounts now: ${inv.holdingCount} ${inv.holdingCount === 1 ? "holding" : "holdings"} worth ${formatCents(inv.totalCents)} in ${list(inv.accounts.map((a) => a.name))}. Every number shows where it came from, and I'll keep it up to date.`,
        refs: {},
        actions: [
          { id: "open", label: "See what you own", kind: "link", href: "/investments" },
          snoozeButton(),
        ],
        dedupeKey: "holdings",
        priority: MESSAGE_PRIORITY.investments,
      },
    ];
    if (inv.advice) {
      const next = nextQuestion(inv.profile);
      const summary = profileSummary(inv.profile, snapshot.asOf);
      // A year on, all four again (a new key each year).
      const again = summary.complete && summary.stale;
      const question = next ?? (again ? PROFILE_QUESTIONS[0] : null);
      if (question) {
        const ask = asking(question, again);
        out.push({
          kind: "decision",
          body: again
            ? "It's been a year since you told me what your investments are for. Has anything changed? Tap your answers again; the rest stays as it was."
            : PROFILE_INTRO,
          refs: ask.refs,
          actions: [...ask.actions, snoozeButton()],
          dedupeKey: again ? `profile:${snapshot.asOf.slice(0, 4)}` : "profile",
          priority: MESSAGE_PRIORITY.investment_profile,
        });
      }
    }
    return out;
  },
};
