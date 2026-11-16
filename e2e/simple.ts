import type { Page } from "@playwright/test";

// Gate F, "simple" (mvp-ready.md; docs/design/area-pages.md): an area page as it first opens, before
// anything is pressed. The tree comes before the page's other content; at most three "What matters
// now" chips; nothing open; no line said twice; and how many words it takes.
export type Simplicity = {
  page: string;
  hasTree: boolean;
  // Without a tree, the line that says why.
  noTreeBecause: string;
  treeFirst: boolean;
  // What comes before the tree, besides the heading, its line and the page links.
  beforeTree: string[];
  chips: number;
  openFolds: number;
  repeated: string[];
  words: number;
};

export async function simplicity(page: Page): Promise<Simplicity> {
  return page.evaluate(() => {
    const main = document.querySelector("main")!;
    const header = main.querySelector("header");
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const tree = main.querySelector("[role=tree]");
    // The page's top-level blocks, in order, without the header.
    const blocks = [...main.querySelectorAll(":scope > *, :scope > * > *")].filter(
      (el) => el !== header && !header?.contains(el) && visible(el),
    );
    const beforeTree: string[] = [];
    if (tree) {
      for (const el of blocks) {
        if (el.contains(tree) || el === tree) break;
        if (el.contains(main.querySelector("h1")!) || el.matches("h1, p, nav, [role=group]"))
          continue;
        if (el.querySelector("h1, [role=tree]")) continue;
        const said = (el as HTMLElement).innerText.trim().replace(/\s+/g, " ");
        if (said) beforeTree.push(said.slice(0, 80));
      }
    }
    const text = [...main.children]
      .filter((el) => el !== header)
      .map((el) => (el as HTMLElement).innerText)
      .join("\n");
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      // Sentences, not a node's count ("1 thing to look at" under two branches is two statuses).
      .filter((l) => l.split(/\s+/).length >= 4 && !/^\d/.test(l));
    const repeated = [...new Set(lines.filter((l, i) => lines.indexOf(l) !== i))];
    const chips = main.querySelectorAll(
      '[role=group][aria-label="What matters now"] a, [role=group][aria-label="What matters now"] button',
    ).length;
    const openFolds = [...main.querySelectorAll("details[open]")].filter(
      (d) => !header?.contains(d),
    ).length;
    return {
      page: location.pathname,
      hasTree: !!tree,
      noTreeBecause: tree ? "" : (text.split("\n").find((l) => /\byet\b/.test(l)) ?? "").trim(),
      treeFirst: !!tree && beforeTree.length === 0,
      beforeTree,
      chips,
      openFolds,
      repeated: repeated.map((r) => r.slice(0, 100)),
      words: text.split(/\s+/).filter(Boolean).length,
    };
  });
}
