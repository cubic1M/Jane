import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// A brand-new upload-only person (one card statement, no checking): every page in the menu says
// what's there or, when nothing is yet, a line and the one next step. No "–" rows, no $0.00 lists.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(300_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const MENU = [
  "/home",
  "/money",
  "/bills",
  "/subscriptions",
  "/budgets",
  "/insights",
  "/transactions",
  "/net-worth",
  "/insurance",
  "/loans",
  "/debt",
  "/taxes",
  "/taxes/tags",
  "/tax-pack",
  "/investments",
  "/ahead",
  "/goals",
  "/deadlines",
  "/jane",
  "/settings",
];

test("an upload-only person's pages each say what's there or the next step", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  await page.goto("/import");
  await page
    .locator('input[type="file"]')
    .setInputFiles("src/data-sources/csv/__fixtures__/chase-credit-card.csv");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
  await waitForImport(page, { open: "/subscriptions" });

  // Nothing found yet: a line and the next step, not "$0.00 a year".
  const empty = page.locator("[data-empty-state]");
  await expect(empty.first()).toContainText("None found yet.");
  await expect(empty.getByRole("link", { name: "Add older statements" })).toHaveAttribute(
    "href",
    "/import",
  );
  await page.goto("/taxes/tags");
  await expect(page.locator("[data-empty-state]")).toContainText("Nothing tagged in");
  await page.goto("/tax-pack");
  await expect(page.locator("[data-empty-state]")).toContainText("Nothing for");
  // The card is known, its balance isn't: said so, not "we didn't find credit cards".
  await page.goto("/debt");
  await expect(page.locator("[data-empty-state]")).toContainText(
    "Jane knows your Chase card, but not what you owe on it yet.",
  );
  await expect(page.getByText("We didn't find credit cards")).toHaveCount(0);

  for (const path of MENU) {
    await page.goto(path);
    const main = page.locator("main").first();
    await expect(main).toBeVisible();
    const text = await main.innerText();
    expect(text, `${path} has a "–" row`).not.toMatch(/^\s*[–-]\s*$/m);
    expect(text, `${path} shows $0.00`).not.toContain("$0.00");
  }
});
