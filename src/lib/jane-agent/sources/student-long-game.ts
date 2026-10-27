import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { LONG_GAME } from "@/config/student-loans";
import { dayLabel } from "@/lib/day-label";
import { STUDENT_PAGE } from "../student-long-game-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";
import { daysBetween } from "@/lib/dates";

// Student loans, the long game (spec step 225): a reminder LONG_GAME.remindDays before the
// employer certification and the income-driven recertification, each once for its date.

export const studentLongGameSource: MessageSource = {
  key: "student_long_game",
  gather: (snapshot): Candidate[] => {
    const g = snapshot.studentLongGame;
    if (!g?.available) return [];
    const out: Candidate[] = [];
    const asOf = snapshot.asOf;
    for (const [on, what, key] of [
      [g.certifyOn, "certify your employer for Public Service Loan Forgiveness", "certify"],
      [g.recertifyOn, "recertify your income-driven student loan plan", "recertify"],
    ] as const) {
      if (!on || daysBetween(asOf, on) > LONG_GAME.remindDays) continue;
      out.push({
        kind: "heads_up",
        body: `Your student loan paperwork is due: ${what} by ${dayLabel(on, { year: true })} (${daysBetween(asOf, on)} days). ${key === "certify" ? "The PSLF Help Tool at studentaid.gov takes a few minutes." : "Missing it can raise your payment."} It's on your deadlines.`,
        refs: {},
        actions: [STUDENT_PAGE, snoozeButton()],
        dedupeKey: `student_${key}:${on}`,
        priority: MESSAGE_PRIORITY.student_paperwork,
      });
    }
    return out;
  },
};
