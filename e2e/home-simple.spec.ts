import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";
import { openHomeMore } from "./home-more";

// The home redesign (founder 11-12: "way too many options the users can click on … Jane is
// supposed to watch your finances 24/7, proactively search for opportunities where you can save
// money, and then find you the solution and prefill the step"). Home is where you stand, what
// Jane found with a yes or not now, and what needs you; everything else is one tap away.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("Home is net worth, what Jane found and what needs you, and little else to click", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");

  await expect(page.locator('[data-net-worth-chart] [data-hub-number="net-worth"]')).toBeVisible({
    timeout: 60_000,
  });
  const found = page.locator("[data-jane-found]");
  await expect(found.getByRole("heading", { name: "Jane found" })).toBeVisible();
  // The decisions: in the page on a phone, in the dock beside the chat on a computer.
  const cards = isMobile
    ? found.locator("[data-home-cards]")
    : page.getByRole("complementary", { name: "Chat with Jane" }).locator("[data-card-dock]");
  const card = cards.locator('[data-card-state="showing"]');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByRole("button", { name: "Yes", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Not now", exact: true })).toBeVisible();
  // Never twice on a computer.
  if (!isMobile) await expect(found.locator("[data-home-cards]")).toBeHidden();

  // Off Home: they live on Spending & bills, in Settings, or nowhere a student needs them.
  const main = page.getByRole("main");
  await expect(main.locator('[data-hub-tile="safe"]')).toHaveCount(0);
  await expect(main.getByRole("group", { name: /^Next 30 days:/ })).toHaveCount(0);
  await expect(main.getByRole("region", { name: "Getting started" })).toHaveCount(0);
  await expect(main.getByText("How much should Jane do on its own?")).toHaveCount(0);
  await expect(main.getByText(/Data last updated/)).toHaveCount(0);
  await expect(main.locator("[data-home-close]")).toHaveCount(0);

  // The six areas' tree is one tap away, folded.
  await expect(main.locator("[data-giant-tree]")).toBeHidden();
  const visibleClickables = () =>
    main
      .locator("a[href], button, summary, input, select")
      .evaluateAll((els) =>
        els.filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
        }),
      )
      .then((els) => els.length);
  // Before the redesign Home had about 80 things to click; now the area tabs, the chart's own
  // controls, a card's buttons and the fold.
  expect(await visibleClickables()).toBeLessThanOrEqual(40);
  await openHomeMore(page);
  await expect(main.locator("[data-giant-tree] [data-giant-area-tile]")).toHaveCount(6, {
    timeout: 60_000,
  });

  // Nothing sideways on a phone.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});
