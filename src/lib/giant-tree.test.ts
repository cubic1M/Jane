import { describe, expect, it } from "vitest";
import type { AreaMap } from "@/lib/feature-map";
import { buildAreaTree } from "@/lib/area-pages/tree";
import { giantAreas } from "./giant-tree";

// The "What Jane does" tree: the areas as tiles, each opening into its branches and features.

const feature = (id: string, forYou = false) => ({
  id,
  name: id,
  line: `About ${id}`,
  forYou,
  href: `/${id}`,
  ask: `Tell me about ${id}`,
});

const maps: AreaMap[] = [
  {
    key: "money",
    name: "Spending & bills",
    href: "/money",
    features: 3,
    forYou: 1,
    branches: [
      {
        id: "subs",
        name: "Subscriptions",
        forYou: 1,
        features: [feature("a", true), feature("b")],
      },
      { id: "fees", name: "Bank fees", forYou: 0, features: [feature("c")] },
    ],
  },
  {
    key: "insurance",
    name: "Insurance",
    href: "/insurance",
    features: 1,
    forYou: 0,
    branches: [{ id: "gaps", name: "Gaps", forYou: 0, features: [feature("d")] }],
  },
];

describe("the areas as tiles", () => {
  const areas = giantAreas(maps);

  it("has every area in order, with no Jane above them", () => {
    expect(areas.map((a) => a.key)).toEqual(["money", "insurance"]);
    expect(areas[0]).toMatchObject({
      label: "Spending & bills",
      line: "3 things · 1 for you",
      forYou: true,
      href: "/money",
    });
    expect(areas[1].forYou).toBe(false);
  });

  it("lists each branch's features under it, in order, with the question for Ask Jane", () => {
    expect(areas[0].branches.map((b) => [b.label, b.line, b.items.map((i) => i.id)])).toEqual([
      ["Subscriptions", "1 for you", ["a", "b"]],
      ["Bank fees", "1 thing", ["c"]],
    ]);
    expect(areas[0].branches[0].items[0]).toMatchObject({
      label: "a",
      forYou: true,
      href: "/a",
      ask: "Tell me about a",
    });
  });
});

describe("an area with its own tree", () => {
  const insurance = buildAreaTree({
    key: "insurance",
    label: "Insurance",
    sub: ({ urgent }) => `${urgent} urgent`,
    branches: [
      {
        id: "missing",
        label: "Cover that looks missing",
        items: [
          {
            id: "missing:life",
            label: "Life cover",
            status: "act",
            figure: "Missing",
            summary: "No life cover on file.",
          },
        ],
      },
    ],
  });
  const areas = giantAreas(maps, { insurance });
  const area = areas.find((a) => a.key === "insurance")!;

  it("shows that tree's branches and items, never drifting from the page", () => {
    expect(area).toMatchObject({ status: "act", line: "1 urgent" });
    expect(area.branches[0]).toMatchObject({
      label: "Cover that looks missing",
      status: "act",
      href: "/insurance?focus=missing",
    });
    expect(area.branches[0].items[0]).toMatchObject({
      label: "Life cover",
      figure: "Missing",
      status: "act",
      line: "No life cover on file.",
      href: "/insurance?focus=missing%3Alife",
      ask: 'What should I do about "Life cover" (Missing)?',
    });
    // The feature map's branches are gone for that area; the others keep theirs.
    expect(area.branches.map((b) => b.id)).toEqual(["missing"]);
    expect(areas[0].branches.map((b) => b.id)).toEqual(["subs", "fees"]);
  });
});
