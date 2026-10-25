import { expect, test } from "@playwright/test";
import { areaTree } from "./area-tree";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("new people land on Connect; once data is in, the hub matches the report", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("admin");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/home");
  await expect(page).toHaveURL("/connect");

  await page.goto("/import");
  await page.getByLabel("Name").fill("Test Card");
  await page.getByLabel("Type").selectOption({ label: "Credit card" });
  await page.getByRole("button", { name: "Add account" }).click();
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/sample-card.csv");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /Import \d+ transactions/ }).click();
  await expect(page).toHaveURL("/report", { timeout: 30_000 });
  const headline = await page.getByRole("heading", { level: 1 }).textContent();

  await page.goto("/home");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeAttached();
  // The report's "We found $X a year" and the hub's money found are the same number (the hub
  // shows whole dollars).
  const amount = (headline?.match(/\$[\d,.]+/)?.[0] ?? "").replace(/\.\d\d$/, "");
  await expect(page.locator('[data-hub-number="saved"]')).toContainText(amount);
  // It links to the report that shows it (hub QA: it linked to /plan, a bigger total).
  await expect(page.getByRole("link", { name: "Money found", exact: true })).toHaveAttribute(
    "href",
    "/report",
  );
  // "Your plan" opens beside the tile, with the whole plan a link inside (founder: no
  // teleporting to another page).
  await page.getByRole("button", { name: /^Your plan: \d+ things? ›$/ }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Your plan" })
      .getByRole("link", { name: /See the whole plan/ }),
  ).toHaveAttribute("href", "/plan");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Next 30 days" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The area tabs along the top (docs/design/home-hub.md), Home lit up; on a phone they
  // scroll sideways, and the chat is the Jane button, which the end of the page clears.
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const name of [
    "Home",
    "Spending & bills",
    "Insurance",
    "Loans & credit",
    "Taxes",
    "Investing (practice)",
    "Plans & goals",
  ]) {
    await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(1);
  }
  await expect(nav.getByRole("link")).toHaveCount(7);
  await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const jane = page.getByRole("button", { name: /^Chat with Jane/ });
  await expect(jane).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const janeTop = (await jane.boundingBox())?.y ?? 0;
  const footerBottom = await page
    .locator("footer")
    .evaluate((footer) => footer.getBoundingClientRect().bottom);
  expect(footerBottom).toBeLessThanOrEqual(janeTop + 1);

  // What Jane did and Settings are in the profile menu, and light it up.
  await page.getByRole("button", { name: "Your account and settings" }).click();
  await expect(page.getByRole("link", { name: "What Jane did", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL("/settings");
  // Settings is a tree (docs/design/area-pages.md): one branch per kind of setting.
  await expect(areaTree(page, "Settings").locator('[role="treeitem"][aria-level="2"]')).toHaveCount(
    7,
  );
  await expect(nav.getByRole("link", { name: "Home", exact: true })).not.toHaveAttribute(
    "aria-current",
  );
});
