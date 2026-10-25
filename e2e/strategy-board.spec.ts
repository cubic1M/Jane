import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser, treatAsDemoBank } from "./db";

// The investments page's strategy board (founder: "show the graph showing the different
// investment strategies, and list all the ones you tested right below the specific risk
// tolerance"): the level on top, one graph, every strategy tested right below it; a row brings
// its line forward and opens its evidence, and at the person's own level runs it in practice.
// Demo advice on practice money only. On a computer and at 375 px.

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
  { name: "a computer", width: 1280, height: 900 },
  { name: "a phone", width: 375, height: 812 },
]) {
  test(`the graph and every strategy tested at a level, on ${size.name}`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signIn(page, baseURL);
    await page.goto("/investments");
    const board = page.getByRole("region", { name: "Strategies by risk level" });
    await expect(board).toBeVisible();

    // The level on top, the person's own marked, with what it means in a line.
    const levels = board.getByRole("group", { name: "Risk level" });
    await expect(levels.getByRole("link")).toHaveCount(5);
    const mine = levels.locator('[aria-current="true"]');
    await expect(mine).toContainText("(yours)");
    const label = (await mine.innerText()).replace("(yours)", "").trim();
    await expect(board.locator("[data-level-line]")).toContainText(`${label}:`);

    // One graph: the default bold, the mix dashed, every other strategy a thin line.
    const graph = board.getByRole("img", { name: /^Growth of \$100 in every strategy tested at / });
    await expect(graph).toBeVisible();
    const rows = board.locator("li[data-board-row]");
    const count = await rows.count();
    expect(count).toBeGreaterThan(50);
    await expect(graph.locator("path[data-line]")).toHaveCount(count + 1);
    await expect(graph.locator('path[data-line="mix"]')).toHaveAttribute("stroke-dasharray", "5 4");
    await expect(graph.locator("path[data-active]")).toHaveAttribute("data-line", "default");

    // Right below it, the list: Jane's pick first, each with its status, numbers and line.
    await expect(
      board.getByRole("heading", {
        name: new RegExp(`^Every strategy tested at ${label} \\(\\d+\\)$`),
      }),
    ).toBeVisible();
    const first = rows.first();
    await expect(first).toHaveAttribute("data-board-row", "default");
    await expect(first.getByText("[DEFAULT]")).toBeVisible();
    await expect(first.getByText("■ YOURS")).toBeVisible();
    await expect(board.getByText("[WORTH WATCHING]").first()).toBeVisible();
    await expect(board.getByText("[TESTED, NOT RECOMMENDED]").first()).toBeVisible();
    await expect(first.getByText(/\/yr$/)).toBeVisible();
    await expect(first.getByText(/^Sortino -?\d\.\d\d$/)).toBeVisible();

    // A row brings its line forward and opens its evidence and past regimes.
    // (Managed futures is a sleeve beside the mix: watched, never run on its own.)
    const watch = board
      .locator('li[data-status="watch"]:not([data-board-row="catalog:managed_futures"])')
      .first();
    const key = await watch.getAttribute("data-board-row");
    await watch.getByRole("button").first().click();
    await expect(graph.locator("path[data-active]")).toHaveAttribute("data-line", key!);
    await expect(board.locator("[data-board-active]")).toHaveAttribute("data-board-active", key!);
    await expect(watch.getByText(/Chance the edge is real/)).toBeVisible();
    await expect(watch.getByText(/^Past regimes: /)).toBeVisible();

    // The range chips redraw from $100.
    const ranges = board.getByRole("group", { name: "Range" });
    await ranges.getByRole("button", { name: "Since 2022" }).click();
    await expect(ranges.getByRole("button", { name: "Since 2022" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(graph.locator("text").filter({ hasText: /^2020$/ })).toHaveCount(0);

    // Run it in practice, then back to Jane's pick.
    await watch.getByRole("button", { name: "Use in practice" }).click();
    await expect(rows.filter({ hasText: "■ YOURS" }).first()).toHaveAttribute(
      "data-board-row",
      key!,
    );
    await expect(graph.locator("path[data-active]")).toHaveAttribute("data-line", key!);
    const followed = rows.filter({ hasText: "■ YOURS" }).first();
    await followed.getByRole("button").first().click();
    await expect(followed.getByText("Your practice portfolio follows this")).toBeVisible();
    await followed.getByRole("button", { name: "Back to Jane's pick" }).click();
    await expect(rows.first().getByText("■ YOURS")).toBeVisible();

    // Nothing runs off the side of a phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await graph.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(size.width);

    // Very high, read only from another level: crypto and day trading appear, day trading
    // marked as losing money and never offered; no buttons away from the person's own level.
    await levels.getByRole("link", { name: /^Very high/ }).click();
    await expect(levels.locator('[aria-current="true"]')).toContainText("Very high");
    await expect(rows.filter({ hasText: "Crypto trend" })).toHaveCount(1);
    const day = rows.filter({ hasText: "Day trading: Opening-range break" });
    await expect(day.getByText("[LOST MONEY AFTER COSTS]")).toBeVisible();
    await day.getByRole("button").first().click();
    await expect(day.getByText("Not offered in practice.")).toBeVisible();
    await expect(board.getByRole("button", { name: "Use in practice" })).toHaveCount(0);
    await expect(board.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  });
}
