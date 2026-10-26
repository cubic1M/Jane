import { EXPLAINERS, explainer } from "@/config/learn";
import type { Reply } from "./replies";

// Learn in the chat (spec step 136): "what's an index fund?" answered with the fixed
// explainer. Pure. (The /learn pages were removed on 2026-10-26, and their links with them.)

export type LearnIntent = { kind: "learn"; slug: string };

// What people call each explainer.
const WORDS: readonly [RegExp, string][] = [
  [/index funds?/, "index-funds"],
  [/expense ratios?|(?:investment|investing|fund) fees/, "fees"],
  [/(?:employer |401\(?k\)? |company )?match(?:ing)?(?: work)?/, "the-match"],
  [
    /roth(?: ira| 401\(?k\)?)?|traditional (?:ira|401\(?k\)?)|roth (?:vs\.?|or|versus) traditional/,
    "roth-vs-traditional",
  ],
  [/rebalanc\w*/, "rebalancing"],
  [/refinanc\w*/, "refinancing"],
  [/deductibles?/, "deductibles"],
  [/(?:the )?standard deduction/, "standard-deduction"],
];

const ASK =
  /^(?:so )?(?:what(?:'s| is| are| does)|whats|explain|tell me (?:about|what)|how do(?:es)?|what do you mean by|define|meaning of) (?:an? |the )?(?!my |your |our )(.+?)(?: mean| work| is)?$/;

export function parseLearnIntent(text: string): LearnIntent | null {
  const asked = ASK.exec(text);
  if (!asked) return null;
  const subject = asked[1];
  const hit = WORDS.find(([pattern]) => new RegExp(`^(?:${pattern.source})$`).test(subject));
  return hit ? { kind: "learn", slug: hit[1] } : null;
}

export function learnReply(slug: string): Reply {
  const e = explainer(slug);
  if (!e) {
    return {
      body: `I can explain: ${EXPLAINERS.map((x) => x.title.toLowerCase()).join(", ")}.`,
      actions: [],
      refs: {},
    };
  }
  return {
    body: `${e.summary} ${e.paragraphs[0]}`,
    actions: [],
    refs: {},
  };
}
