import type {
  TreeBranch,
  TreeData,
  TreeLeaf,
  TreeStatus,
} from "@/components/tree/interactive-tree";
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
