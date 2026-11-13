import type {
  TreeBranch,
  TreeData,
  TreeLeaf,
  TreeStatus,
} from "@/components/tree/interactive-tree";
import { shortMoney } from "@/lib/hub/view";
import { plural } from "@/lib/plural";

// The area page pattern's shared rules (docs/design/area-pages.md): the copy budget, how a
// branch takes its status from its items, and the "what matters now" chips. Pure, so every
// area's tree builder is held to the same rules by its tests.

export const LABEL_MAX_WORDS = 6;
export const SUMMARY_MAX_SENTENCES = 2;
export const CHIPS_MAX = 3;

// An item as an area builds it: the node, and its detail's summary (two sentences at most).
export type AreaItem = TreeLeaf & { summary: string; cents?: number };
export type AreaBranchInput = { id: string; label: string; items: AreaItem[] };

export type AreaTree = {
  tree: TreeData;
  // The detail summary of each item, by id.
  summaries: Record<string, string>;
  // At most three urgent items with their dollar figure, biggest first.
  chips: { id: string; label: string; figure: string }[];
};

const RANK: Record<TreeStatus, number> = { good: 0, look: 1, act: 2 };

export const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

// Words that lead into what follows: a label cut short never ends on one (debugger 11-12: "Last day
// of open enrollment at" on Plans & goals, its employer cut off).
const LEADS_ON = new Set(
  "at of for to the a an in on with and or by from & - : ,".split(" ").filter(Boolean),
);

// A name or title as a node's label: its first LABEL_MAX_WORDS words, without a dangling end.
export function shortLabel(text: string, max = LABEL_MAX_WORDS): string {
  const all = text.trim().split(/\s+/).filter(Boolean);
  if (all.length <= max) return all.join(" ");
  const kept = all.slice(0, max);
  while (kept.length > 1 && LEADS_ON.has(kept[kept.length - 1]!.toLowerCase())) kept.pop();
  return kept.join(" ");
}
export const sentences = (text: string) =>
  text
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9$"“])/)
    .filter(Boolean).length;

// The first `n` sentences of a text: a detail's summary before "More".
export function firstSentences(text: string, n = SUMMARY_MAX_SENTENCES): string {
  const parts = text.trim().split(/(?<=[.!?])\s+(?=[A-Z0-9$"“])/);
  return parts.slice(0, n).join(" ");
}

// A suggestion's worth on a tree: a risk, or a worth that comes once, is a bare figure; a yearly
// one has "/yr". Its headline says which (headlineOf in src/detectors/helpers.ts: "save $216 a
// year", "get $27,716 back"); rows scanned before headlines existed have none and stay yearly
// (debugger 11-06: PSLF forgiveness, once, read "$28k/yr").
export function worthFigure(s: {
  worthCents: number | null;
  worthKind?: string;
  headline?: string;
}): string | undefined {
  if (!s.worthCents || s.worthCents <= 0) return undefined;
  const yearly = s.worthKind !== "risk" && (!s.headline || /\ba year\b/.test(s.headline));
  return `${shortMoney(s.worthCents)}${yearly ? "/yr" : ""}`;
}

// A suggestion the person said yes to stays on its area's tree, marked as on their list, so
// the step its Yes opens is there (debugger 11-13: Yes on "Drop your mortgage insurance" opened
// /loans?focus=cheaper:pmi_removal, but an answered suggestion was no longer drawn, so nothing
// opened). It's theirs to do now: "good", not one more thing to look at.
export const ON_YOUR_LIST = "On your list";
export const SAID_YES = ["waiting", "selected", "yes"] as const;
export function answeredYes(s: { status?: string }): { status: TreeStatus; badge: string } | null {
  return s.status === "yes" ? { status: "good", badge: ON_YOUR_LIST } : null;
}

// The worst status among items: one urgent item makes its branch urgent.
export function worst(statuses: (TreeStatus | undefined)[]): TreeStatus | undefined {
  return statuses.reduce<TreeStatus | undefined>(
    (w, s) => (s && (!w || RANK[s] > RANK[w]) ? s : w),
    undefined,
  );
}

export function buildAreaTree({
  key,
  label,
  sub,
  branches,
}: {
  key: string;
  label: string;
  sub: (counts: { urgent: number; look: number; items: number }) => string;
  branches: AreaBranchInput[];
}): AreaTree {
  const shown = branches.filter((b) => b.items.length > 0);
  const all = shown.flatMap((b) => b.items);
  const urgent = all.filter((i) => i.status === "act");
  const tree: TreeData = {
    key,
    label,
    sub: sub({
      urgent: urgent.length,
      look: all.filter((i) => i.status === "look").length,
      items: all.length,
    }),
    branches: shown.map((b): TreeBranch => {
      const act = b.items.filter((i) => i.status === "act").length;
      const look = b.items.filter((i) => i.status === "look").length;
      return {
        id: b.id,
        label: b.label,
        status: worst(b.items.map((i) => i.status)),
        line:
          act > 0 ? `${act} urgent` : look > 0 ? `${plural(look, "thing")} to look at` : undefined,
        items: b.items.map((i) => ({
          id: i.id,
          label: i.label,
          line: i.line,
          figure: i.figure,
          status: i.status,
          badge: i.badge,
        })),
      };
    }),
  };
  const chips = [...urgent]
    .sort((a, b) => (b.cents ?? 0) - (a.cents ?? 0))
    .slice(0, CHIPS_MAX)
    .map((i) => ({ id: i.id, label: i.label, figure: i.figure ?? "" }));
  return {
    tree,
    summaries: Object.fromEntries(all.map((i) => [i.id, i.summary])),
    chips,
  };
}
