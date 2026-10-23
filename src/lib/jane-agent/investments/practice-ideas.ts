import type { PrismaClient } from "@/generated/prisma/client";
import { dollarFigures } from "@/lib/guardrails";
import { practiceIdeasView } from "@/lib/practice/ideas-view";

// The practice_portfolio tool's ideas (Phase AW, Stage A): what Jane is waiting on the person
// for, each with how sure she is; the strategy the autopilot follows today; and what their
// answers changed. The same view as the practice page (src/lib/practice/ideas-view.ts). Every
// dollar figure in an idea's numbers is registered, so Claude may quote it.

export async function practiceIdeasFor(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
  money: (cents: number) => string,
) {
  const view = await practiceIdeasView(userId, { client, now });
  return {
    ideasWaiting: view.ideas.map((i) => {
      const numbers = i.figures.map((f) => `${f.label} ${f.value}`);
      for (const n of numbers) for (const f of dollarFigures(n)) money(f.cents);
      return {
        what: i.headline,
        why: i.short,
        kind: i.label,
        worth: money(i.worthCents),
        confidencePercent: i.confidence.percent,
        confidenceReason: i.confidence.reason,
        numbers,
        yesDoes:
          i.trades > 0
            ? "Places it in the practice portfolio, within the caps."
            : "Opens the practice settings.",
      };
    }),
    ideasNote:
      view.ideas.length === 0
        ? "No ideas waiting: Jane searches every day and when a page opens, and brings the next one unasked."
        : "Each idea is also a suggestion card the person answers with Yes or No, here or on the practice page.",
    strategyToday: view.strategy && {
      strategy: view.strategy.label,
      key: view.strategy.key,
      followed: view.strategy.followed,
      note: view.strategy.note,
    },
    whatYourAnswersChanged:
      view.learned.length === 0
        ? "Nothing yet: a yes brings that kind sooner, a no later (and that idea never again); safety checks still come."
        : view.learned.map((l) => ({ kind: l.label, yes: l.yes, no: l.no, effect: l.says })),
  };
}
