import { BRIEF_FROM_HOUR, MESSAGE_PRIORITY } from "@/config/agent-chat";
import { shortDate, type MessageSource } from "./source";

// Spec step 96: "what we covered", at the top of each week: what the person asked, what they
// said yes and no to, and what Jane finished, the week before. Only after a week with
// something in it; once a week, before the brief.

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const weekSource: MessageSource = {
  key: "week",
  gather(snapshot, { local, trigger }) {
    const week = snapshot.lastWeek;
    if (!week || (local.hour < BRIEF_FROM_HOUR && trigger !== "open")) return [];
    const parts = [
      week.asked > 0 ? count(week.asked, "question you asked", "questions you asked") : null,
      week.yes + week.no > 0
        ? `${count(week.yes + week.no, "decision")} (${week.yes} yes, ${week.no} no)`
        : null,
      week.done > 0 ? count(week.done, "thing I finished", "things I finished") : null,
    ].filter(Boolean);
    if (parts.length === 0) return [];
    return [
      {
        kind: "brief",
        body: `The week of ${shortDate(week.start)}, we covered ${parts.join(", ")}. You can search anything we said, or pin what you want to keep at the top.`,
        refs: {},
        actions: [{ id: "open", label: "Search the chat", kind: "link", href: "/chat/search" }],
        dedupeKey: snapshot.weekStart,
        priority: MESSAGE_PRIORITY.week,
      },
    ];
  },
};
