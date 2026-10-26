import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser, treatAsDemoBank } from "./db";
import { expectMarchingLine } from "./marching";

// The investments page laid out like Home (founder: "you can click through the tree graphs
// showcasing the different strategies and choose which one you like"): the hero graph, the
// tiles, the levels as tiles with the person's own open, families as branches, strategies as
// leaves. Picking a leaf shows it in the hero at once, with its panel (a bottom sheet on a
// phone); Use this strategy is instant and saved, and Revert puts it back. Demo advice on
// practice money only. On a computer and at 375 px.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

async function signIn(page: Page, baseURL: string | undefined) {
  const user = await signedInUser("user");
  userId = user.userId;
  // A demo bank only: demo advice is on.
  await treatAsDemoBank(user.userId);
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
}

for (const size of [
  { name: "a computer", width: 1280, height: 900, phone: false },
  { name: "a phone", width: 375, height: 812, phone: true },
]) {
  test(`pick a strategy in the tree, see it in the graph, use it and revert, on ${size.name}`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signIn(page, baseURL);
    await page.goto("/investments");

    // The hero: the strategy the practice portfolio runs, against the level's mix (dashed).
    const hero = page.getByRole("region", { name: "Your practice portfolio" });
    await expect(hero).toBeVisible();
    await expect(hero.locator("[data-hero-line]")).toHaveAttribute("data-hero-line", "default");
    await expect(hero.locator('path[data-graph-line="mix"]')).toHaveAttribute(
      "stroke-dasharray",
      "5 4",
    );
    await expect(hero.locator('path[data-graph-line="default"]')).toBeVisible();
    // The tiles.
    const glance = page.getByRole("list", { name: "At a glance" });
    await expect(glance.getByText("Risk level")).toBeVisible();
    await expect(glance.getByText("Practice ideas")).toBeVisible();

    // The levels, the person's own open, its families as branches.
    const own = page.locator('[data-level-tile][aria-expanded="true"]');
    await expect(own).toHaveCount(1);
    await expect(own).toContainText("Yours");
    const tree = page.locator("[data-level-tree]");
    await expect(tree.locator("[data-branch]").first()).toBeVisible();
    for (const family of ["Steady mixes", "Trend & momentum", "Factor tilts", "Timing rules"])
      await expect(tree.getByText(family, { exact: true })).toBeVisible();
    await expect(tree.getByText("Day trading & crypto", { exact: true })).toHaveCount(0);
    const leaves = tree.locator("[data-strategy-leaf]");
    expect(await leaves.count()).toBeGreaterThan(50);
    await expect(tree.locator('[data-strategy-leaf="default"]')).toContainText("[DEFAULT]");
    await expect(tree.locator('[data-strategy-leaf="default"]')).toContainText("■ YOURS");
    await expect(tree.getByText("[WORTH WATCHING]").first()).toBeVisible();
    await expect(tree.getByText("[NOT RECOMMENDED]").first()).toBeVisible();
    await expect(tree.locator('[data-strategy-leaf="default"]')).toContainText(/[+−]\d+\.\d%\/yr/);

    // Pick a worth-watching leaf: the hero shows it at once, the panel opens beside it.
    const leaf = tree
      .locator('[data-status="watch"]:not([data-strategy-leaf="catalog:managed_futures"])')
      .first();
    const key = (await leaf.getAttribute("data-strategy-leaf"))!;
    const label = (await leaf.locator("span").first().locator("span").first().innerText()).trim();
    await leaf.click();
    await expect(hero.locator("[data-hero-line]")).toHaveAttribute("data-hero-line", key);
    await expect(hero.locator(`path[data-graph-line="${key}"]`)).toBeVisible();
    const panel: Locator = size.phone
      ? page.getByRole("dialog", { name: label })
      : hero.locator("[data-strategy-panel]");
    await expect(panel.getByText(label, { exact: true })).toBeVisible();
    if (!size.phone) {
      await expect(page.locator("[data-panel-line]")).toHaveCount(1);
      await expectMarchingLine(page.locator("[data-panel-line]"));
    }
    await panel.getByText("More", { exact: true }).click();
    await expect(panel.getByText(/^Past regimes: /)).toBeVisible();

    // Use it: marked at once, with Revert; it stays after a reload.
    await panel.getByRole("button", { name: "Use this strategy" }).click();
    await expect(page.getByRole("status")).toHaveText(`Your practice portfolio now runs ${label}.`);
    await expect(leaf).toContainText("■ YOURS");
    await expect(panel.getByText("Your practice portfolio runs this")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Revert" })).toBeVisible();
    await expect(async () => {
      await page.reload();
      await expect(page.locator(`[data-strategy-leaf="${key}"]`).getByText("■ YOURS")).toBeVisible({
        timeout: 3_000,
      });
    }).toPass({ timeout: 30_000 });
    await expect(hero.locator("[data-hero-line]")).toHaveAttribute("data-hero-line", key);

    // Use it and Revert straight away: back to Jane's pick, saved too.
    const steady = page.locator('[data-branch="steady"] [data-strategy-leaf]').nth(1);
    const steadyKey = (await steady.getAttribute("data-strategy-leaf"))!;
    await steady.click();
    const panel2: Locator = size.phone
      ? page.getByRole("dialog")
      : hero.locator("[data-strategy-panel]");
    await panel2.getByRole("button", { name: "Use this strategy" }).click();
    await expect(steady).toContainText("■ YOURS");
    await panel2.getByRole("button", { name: "Revert" }).click();
    await expect(page.getByRole("status")).toHaveText("Reverted.");
    await expect(steady).not.toContainText("■ YOURS");
    await expect(page.locator(`[data-strategy-leaf="${key}"]`)).toContainText("■ YOURS");
    await expect(async () => {
      await page.reload();
      await expect(page.locator(`[data-strategy-leaf="${key}"]`).getByText("■ YOURS")).toBeVisible({
        timeout: 3_000,
      });
      await expect(page.locator(`[data-strategy-leaf="${steadyKey}"]`)).not.toContainText(
        "■ YOURS",
      );
    }).toPass({ timeout: 30_000 });

    // Nothing runs off the side of a phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Very high, read from another level: day trading and crypto appear; day trading lost money
    // and is never offered; this isn't the person's level, so nothing is used from here.
    await page.locator('[data-level-tile="5"]').click();
    const high = page.locator('[data-level-tree="5"]');
    await expect(high.getByText("Day trading & crypto", { exact: true })).toBeVisible();
    const day = high.locator('[data-strategy-leaf="intraday:opening_range"]');
    await expect(day).toContainText("[LOST MONEY]");
    await day.click();
    const panel3: Locator = size.phone
      ? page.getByRole("dialog")
      : hero.locator("[data-strategy-panel]");
    await expect(panel3.getByText(/^Your level is /)).toBeVisible();
    await expect(panel3.getByRole("button", { name: "Use this strategy" })).toHaveCount(0);
    await expect(
      page.getByText("Demo advice: sample data, not financial advice").first(),
    ).toBeVisible();
  });
}
