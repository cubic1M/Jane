import type { Checkup } from "@/lib/insurance/checkups";

// The coverage checkup's words in Jane's chat (spec step 106), for the message Jane posts by
// herself and for "check my insurance". Pure.

// Recommendations said in the chat; the rest are on the checkup page. As many as fit in the
// chars too, so a long one (a business's liability, spec step 201) doesn't make the answer long.
export const CHECKUP_SHOWN = 3;
export const CHECKUP_MAX_CHARS = 650;

const WHY = {
  life_event: "after your life event",
  asked: "as you asked",
  yearly: "for the year",
  // Spec step 150.
  enrollment: "before open enrollment at work",
};

export function checkupBody(checkup: Checkup): string {
  const recs = checkup.recommendations;
  const why = WHY[checkup.reason] ?? WHY.yearly;
  if (recs.length === 0) {
    return `I checked your insurance ${why}: nothing to change. Your deductibles fit your savings and your cover fits what you have.`;
  }
  const head = `I checked your insurance ${why}. ${recs.length === 1 ? "One thing is" : `${recs.length} things are`} worth a look:`;
  const lines: string[] = [];
  for (const r of recs.slice(0, CHECKUP_SHOWN)) {
    const line = `- ${r.title} ${r.cost}. ${r.risk}`;
    const length = [head, ...lines, line].join("\n").length;
    if (lines.length > 0 && length > CHECKUP_MAX_CHARS) break;
    lines.push(line);
  }
  return [
    head,
    ...lines,
    ...(recs.length > lines.length
      ? [`And ${recs.length - lines.length} more on the checkup page.`]
      : []),
    "Nothing changes unless you say so.",
  ].join("\n");
}
