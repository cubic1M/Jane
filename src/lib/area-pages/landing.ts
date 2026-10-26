import { hiddenPage } from "@/config/hidden-pages";
import { INVESTING_ANCHORS } from "./investing";
import { loansTopicNode } from "./loans";
import { HIDDEN_TAX_ITEMS, TAXES_ANCHORS } from "./taxes";

// Where a link Jane gives lands (docs/design/area-pages.md): every area page is a tree, so a
// link to an area opens the node it's about. Messages already sent and suggestions already
// stored keep their old links (/taxes#withholding), so this turns them into the node they meant
// wherever a link is shown (the chat, the cards) or a suggestion is stored. Sub-pages are
// left as they are: each is still reached from its node.

export const AREA_ROOTS = ["/insurance", "/loans", "/taxes", "/investments", "/ahead"] as const;
export type AreaRoot = (typeof AREA_ROOTS)[number];
export const isAreaRoot = (path: string): path is AreaRoot =>
  (AREA_ROOTS as readonly string[]).includes(path);

// The old section anchors each area page had, and the node each opens now.
export const AREA_ANCHORS: Readonly<Partial<Record<AreaRoot, Readonly<Record<string, string>>>>> = {
  "/taxes": TAXES_ANCHORS,
  "/investments": INVESTING_ANCHORS,
};

// A suggestion whose button opens its area page lands on its own node: its item where the
// tree draws suggestions (loans, investing), else the branch it belongs in.
const INSURANCE_TOPIC_BRANCH: Readonly<Record<string, string>> = {
  auto_insurance: "missing",
  renters_insurance: "missing",
  umbrella: "missing",
  long_term_care: "missing",
  health_insurance: "health",
  medigap: "health",
  card_cover: "cards",
  cover_change: "changes",
  insurance_negotiation: "renewals",
  insurance_shopping: "savings",
  policy_documents: "documents",
};
const TAXES_TOPIC_NODE: Readonly<Record<string, string>> = {
  estimated_taxes: "soon",
  social_security_tax: "topics:retirement",
};

export type Suggested = { key: string; topic: string };

export function topicNode(root: AreaRoot, s: Suggested): string | null {
  switch (root) {
    case "/loans":
      return loansTopicNode(s.topic);
    case "/investments":
      return `ideas:${s.key}`;
    case "/insurance":
      return INSURANCE_TOPIC_BRANCH[s.topic] ?? null;
    case "/taxes": {
      const node = TAXES_TOPIC_NODE[s.topic] ?? null;
      return node && HIDDEN_TAX_ITEMS.has(node) ? null : node;
    }
    case "/ahead":
      return null;
  }
}

const focusHref = (path: string, node: string, rest: URLSearchParams) => {
  // Readable: "?focus=estimate:withholding", not "%3A".
  const others = rest.toString();
  return `${path}?focus=${node}${others ? `&${others}` : ""}`;
};

// The same link, pointed at its node when it was an old anchor or a suggestion's bare area
// link, or at its area page when the page is hidden. Anything else (another page, a full URL,
// a link with its own focus) is unchanged.
export function landing(link: string, suggestion?: Suggested): string {
  if (!link.startsWith("/") || link.startsWith("//")) return link;
  // A page the read-only beta hides (src/config/hidden-pages.ts) lands on its area page, on the
  // suggestion's own node there when it has one.
  const hidden = hiddenPage(link);
  const href = hidden ? hidden.to : link;
  const [beforeHash, hash = ""] = href.split("#", 2);
  const [path, query = ""] = beforeHash.split("?", 2);
  if (!isAreaRoot(path)) return href;
  const params = new URLSearchParams(query);
  if (params.has("focus")) return href;
  const anchored = hash ? AREA_ANCHORS[path]?.[hash] : undefined;
  if (anchored) return focusHref(path, anchored, params);
  if (!hash && !query && suggestion) {
    const node = topicNode(path, suggestion);
    if (node) return focusHref(path, node, params);
  }
  return href;
}
