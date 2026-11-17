import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";
import { framesDrawn } from "./waits";

// Mobile pass (founder, 11-16: "build the mobile webpage better"; "the top navigation cut
// mid-word at Lo…"). On a 375 × 812 phone an area page's tree is framed for the phone from the
// moment the page wakes, not drawn for a wide screen with its branches cut off and then zoomed out;
// and the area tabs fade at an edge with more beyond it instead of ending in half a word.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("an area page's tree and tabs fit a phone from the start", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "the phone's layout");
  await page.setViewportSize({ width: 375, height: 812 });
  userId = await demoPerson(context, page, baseURL);

  for (const path of ["/loans", "/money", "/insurance"]) {
    await page.goto(path);
    await page.locator('html[data-taps="ready"]').waitFor({ state: "attached" });
    await page.locator("main [role=tree]").waitFor();
    await framesDrawn(page);
    const tree = await page.evaluate(() => {
      const frame = document.querySelector(".map-view")!.getBoundingClientRect();
      const world = document.querySelector(".map-world")!;
      return {
        moving: world.getAnimations().length,
        cut: [...document.querySelectorAll("main [role=treeitem]")]
          .map((n) => ({ r: n.getBoundingClientRect(), t: (n as HTMLElement).innerText }))
          .filter(({ r }) => r.right > frame.right + 1 || r.left < frame.left - 1)
          .map(({ t }) => t.split("\n")[0]),
      };
    });
    expect(tree, path).toEqual({ moving: 0, cut: [] });
  }

  // The tabs: the row runs past the screen, and that edge fades; scrolled along, both do.
  const row = page.locator(".area-tabs-row");
  const fades = () =>
    row.evaluate((el) => ({
      before: getComputedStyle(el).getPropertyValue("--fade-before").trim(),
      after: getComputedStyle(el).getPropertyValue("--fade-after").trim(),
      masked: getComputedStyle(el).maskImage.includes("gradient"),
      scrolls: el.scrollWidth > el.clientWidth,
    }));
  await page.goto("/home");
  await expect
    .poll(fades)
    .toEqual({ before: "#000", after: "transparent", masked: true, scrolls: true });
  await row.evaluate((el) => el.scrollTo({ left: (el.scrollWidth - el.clientWidth) / 2 }));
  await expect.poll(fades).toEqual({
    before: "transparent",
    after: "transparent",
    masked: true,
    scrolls: true,
  });
});
