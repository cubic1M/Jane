import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";
import { signInWith } from "./session";
import { simplicity, type Simplicity } from "./simple";

// Gate F, "simple" (mvp-ready.md): each area page a real student with a checking account and a card
// opens. Tree on top, at most three chips, nothing open, nothing said twice, and a word budget.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(10 * 60_000);

const AREAS = ["/money", "/insurance", "/loans", "/taxes", "/investments", "/ahead"];
// Few words: the most an area page says before anything is pressed (11-15 the most was 134, on
// Spending & bills).
const WORDS_MAX = 160;

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("each area page opens simple for a real student", async ({ page, baseURL, isMobile }) => {
  test.skip(isMobile, "the measure is the page's, not the screen's");
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(page.context(), user.sessionToken, baseURL);
  for (const file of ["e2e/fixtures/messy/checking.csv", "e2e/fixtures/messy/card-aug-oct.csv"]) {
    await page.goto("/import");
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
    await waitForImport(page, { open: "/home" });
  }

  const seen: Simplicity[] = [];
  for (const area of AREAS) {
    await page.goto(area);
    await page.locator("main h1").first().waitFor({ timeout: 60_000 });
    await page
      .waitForFunction(
        () => !document.querySelector("main [role=progressbar], main [aria-busy=true]"),
      )
      .catch(() => {});
    seen.push(await simplicity(page));
  }
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/area-pages-simple.json", JSON.stringify(seen, null, 1));
  for (const s of seen) {
    // Investing with no investment accounts has no tree (an empty one would be a dead end, #1828):
    // one line says so.
    if (s.page === "/investments" && !s.hasTree) {
      expect.soft(s.noTreeBecause, `${s.page}: why there's no tree`).toMatch(/No investment/);
      continue;
    }
    expect.soft(s.hasTree, `${s.page}: a tree`).toBe(true);
    expect.soft(s.words, `${s.page}: words`).toBeLessThanOrEqual(WORDS_MAX);
    expect.soft(s.treeFirst, `${s.page}: before the tree: ${s.beforeTree.join(" | ")}`).toBe(true);
    expect.soft(s.chips, `${s.page}: chips`).toBeLessThanOrEqual(3);
    expect.soft(s.openFolds, `${s.page}: open folds`).toBe(0);
    expect.soft(s.repeated, `${s.page}: said twice`).toEqual([]);
  }
});
