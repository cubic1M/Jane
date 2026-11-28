import { expect, test } from "@playwright/test";
import { areaTree } from "./area-tree";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";
import { signInWith } from "./session";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("new people land on Connect; once data is in, the hub matches the report @critical", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("admin");
  userId = user.userId;
  await signInWith(context, user.sessionToken, baseURL);

  await page.goto("/home");
  await expect(page).toHaveURL("/connect");

  await page.goto("/import");
  // Adding an account by hand is folded away: a first upload can make its own.
  const addAccount = page.locator("[data-add-account]");
  if ((await addAccount.getAttribute("open")) === null) {
    await addAccount.getByText("Add an account by hand").click();
  }
  await addAccount.getByLabel("Name").fill("Test Card");
  await addAccount.getByLabel("Type").selectOption({ label: "Credit card" });
  await addAccount.getByRole("button", { name: "Add account" }).click();
  // The upload goes into it once it shows as chosen.
  await expect(page.locator('select[name="accountId"] option:checked')).toHaveText(/^Test Card /);
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/sample-card.csv");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /Import \d+ transactions/ }).click();
  await waitForImport(page);

  await page.goto("/home");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeAttached();
  // No Safe to spend or Money found tile on Home (founder 11-28), and no saved tile before
  // anything is saved.
  await expect(page.getByText(/safe to spend|money found/i)).toHaveCount(0);
  await expect(page.locator('[data-hub-tile="saved"]')).toHaveCount(0);
  // "Your plan" opens beside the tile, with the whole plan a link inside (founder: no
  // teleporting to another page).
  await page.getByRole("button", { name: /^Your plan: \d+ things? ›$/ }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Your plan" })
      .getByRole("link", { name: /See the whole plan/ }),
  ).toHaveAttribute("href", "/plan");
  await page.keyboard.press("Escape");
  // No month-ahead strip and no link to last month's close on Home (founder 11-24).
  await expect(page.getByRole("heading", { name: "Next 30 days" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Last month's close/ })).toHaveCount(0);
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
