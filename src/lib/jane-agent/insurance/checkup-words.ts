import type { Checkup } from "@/lib/insurance/checkups";

// The coverage checkup's words in Jane's chat (spec step 106), for the message Jane posts by
// herself and for "check my insurance". Pure.

// Recommendations said in the chat; the rest are on the checkup page.
export const CHECKUP_SHOWN = 3;

const WHY = { life_event: "after your life event", asked: "as you asked", yearly: "for the year" };

export function checkupBody(checkup: Checkup): string {
  const recs = checkup.recommendations;
  const why = WHY[checkup.reason] ?? WHY.yearly;
  if (recs.length === 0) {
    return `I checked your insurance ${why}: nothing to change. Your deductibles fit your savings and your cover fits what you have.`;
  }
  return [
    `I checked your insurance ${why}. ${recs.length === 1 ? "One thing is" : `${recs.length} things are`} worth a look:`,
    ...recs.slice(0, CHECKUP_SHOWN).map((r) => `- ${r.title} ${r.cost}. ${r.risk}`),
    ...(recs.length > CHECKUP_SHOWN
      ? [`And ${recs.length - CHECKUP_SHOWN} more on the checkup page.`]
      : []),
    "Nothing changes unless you say so.",
  ].join("\n");
}
