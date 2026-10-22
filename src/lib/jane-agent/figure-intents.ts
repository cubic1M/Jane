import { FIGURE_IDS, FIGURE_WORDS, type FigureId } from "@/config/figures";

// "How did you get my safe to spend?" (spec step 239), typed. The figure is the one named;
// with none named it's null and Jane asks which. Pure.

export type FigureIntent = { kind: "figure_how"; figure: FigureId | null };

const HOW =
  /\bhow did you (?:get|work out|come up with|calculate|figure out|arrive at)\b|\bhow do you (?:get|work out|calculate)\b|\bwhere did (?:that|this|the|my) (?:number|figure|amount|total)s? come from\b|\bshow (?:me )?(?:your|the) (?:working|workings|math|maths|sums)\b|\bwhy is (?:my|that|the) .* (?:so |that )?(?:high|low|wrong)\b|\bexplain (?:my|that|the) (?:number|figure)\b/;

export function parseFigureHow(text: string): FigureIntent | null {
  if (!HOW.test(text)) return null;
  const figure = FIGURE_IDS.find((id) => FIGURE_WORDS[id].test(text)) ?? null;
  return { kind: "figure_how", figure };
}
