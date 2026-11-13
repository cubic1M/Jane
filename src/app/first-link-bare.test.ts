import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Beta walk 11-12: before anything is linked, /connect shows nothing to wander into (no area
// tabs, no chat; #1615). The debugger found its own next step, "Upload your statements" on
// /import, still showed the whole app around an empty account. Every page of the way to a first
// account goes bare until there is one.

const FIRST_LINK_PAGES = ["src/app/connect/page.tsx", "src/app/import/page.tsx"];

describe("the way to a first account", () => {
  it.each(FIRST_LINK_PAGES)("%s shows no tabs or chat while there's no account", (file) => {
    const page = readFileSync(file, "utf8");
    expect(page).toMatch(/<AppHeader user=\{user\} bare=\{[^}]*(=== 0|length === 0)[^}]*\} \/>/);
  });
});
