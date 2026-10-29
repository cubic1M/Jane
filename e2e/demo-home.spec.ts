import { expect, test, type Locator } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { uploadSampleCard } from "./demo-upload";

// What looked rough on camera on Home and /jane (demo-video list): beside the docked chat at
// 1280 the area tiles broke words ("Spendin g & bills"), the net worth chart had "×N" on nearly
// every dot, and /jane's fold marks stood alone on a line above each heading.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// Words broken across lines: a word whose text draws on more than one line.
const brokenWords = (scope: Locator) =>
  scope.evaluateAll((els) =>
    els.flatMap((el) => {
      const broken: string[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const m of (node.textContent ?? "").matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
          if (tops.size > 1) broken.push(m[0]);
        }
      }
      return broken;
    }),
  );

test("beside the docked chat, Home and /jane keep their words and marks in place", async ({
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(isMobile, "the docked chat is the computer's");
  await page.setViewportSize({ width: 1280, height: 800 });
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  // A checking file: it has balances, so Home draws the net worth chart.
  await uploadSampleCard(page, "e2e/fixtures/messy/checking.csv");

  await page.goto("/home");
  const tiles = page.locator("[data-giant-tree] ul").first().locator("button");
  await expect(tiles.first()).toBeVisible();
  expect(await brokenWords(tiles)).toEqual([]);
  const chart = page.locator("[data-net-worth-chart]");
  await expect(chart).toBeVisible();
  await expect(chart).not.toContainText(/×\d/);
  // The dots drawn on a canvas once every movement has loaded: no counts beside them either
  // (canvas text isn't in the page's text, so the check above can't see it).
  const dots = chart.locator("[data-net-worth-dots]");
  await expect(dots).toBeAttached({ timeout: 30_000 });
  await expect(dots).not.toHaveAttribute("data-counts", "");

  await page.goto("/jane");
  const sections = page.locator("[data-jane-section]");
  await expect(sections.first()).toBeVisible();
  for (const section of await sections.all()) {
    const mark = (await section.locator("[data-fold-mark]").boundingBox())!;
    const heading = (await section.locator("summary h2").boundingBox())!;
    expect(mark.y).toBeGreaterThanOrEqual(heading.y - 4);
    expect(mark.y).toBeLessThan(heading.y + heading.height);
  }
});
