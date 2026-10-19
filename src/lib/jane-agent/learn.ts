import { EXPLAINERS, explainer } from "@/config/learn";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Learn in the chat (spec step 136): "what's an index fund?" answered with the fixed
// explainer, and a "Learn" link Jane adds under her own answers and messages. Pure.

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

export function learnLink(slug: string): MessageAction {
  const e = explainer(slug);
  return {
    id: "open",
    label: `Learn: ${e?.title.toLowerCase() ?? "more"}`,
    kind: "link",
    href: `/learn/${slug}`,
  };
}

export function learnReply(slug: string): Reply {
  const e = explainer(slug);
  if (!e) {
    return {
      body: `I can explain: ${EXPLAINERS.map((x) => x.title.toLowerCase()).join(", ")}.`,
      actions: [{ id: "open", label: "See them all", kind: "link", href: "/learn" }],
      refs: {},
    };
  }
  return {
    body: `${e.summary} ${e.paragraphs[0]}`,
    actions: [{ id: "open", label: "Read more", kind: "link", href: `/learn/${e.slug}` }],
    refs: {},
  };
}
