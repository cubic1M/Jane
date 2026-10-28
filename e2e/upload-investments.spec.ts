import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { pickItem } from "./area-tree";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// A real account's investments, from its brokerage's positions download (made up, in Vanguard's
// layout): previewed, saved, then on the investments page and in net worth.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const vanguard = readFileSync("src/data-sources/csv/__fixtures__/positions/vanguard.csv");

test("a Vanguard download shows its holdings on /investments and in net worth", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);

  await page.goto("/import");
  await page.getByRole("link", { name: "Upload your investments" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Upload your investments");

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "ofxdownload.csv", mimeType: "text/csv", buffer: vanguard });
  await page.getByRole("button", { name: "Preview" }).click();
  const preview = page.locator("[data-positions-preview]");
  await expect(preview).toContainText("Vanguard holdings");
  await expect(preview).toContainText("Vanguard Account …0003");
  await expect(preview).toContainText("$20,960.56");
  await expect(preview).toContainText("$1,250.75 of it cash");
  // Vanguard's file doesn't say what kind of account each is: the person says.
  await preview.getByRole("combobox", { name: "Account type" }).nth(1).selectOption("roth");

  await page.getByRole("button", { name: "Import holdings" }).click();
  await expect(page.locator("[data-positions-saved]")).toContainText(
    "Saved 4 holdings in 2 accounts, worth $37,460.56",
  );

  await page.goto("/investments");
  const total = await pickItem(page, "Investing", "What you own", "In total");
  await expect(total.getByText("$37,460.56").first()).toBeVisible();
  const roth = await pickItem(page, "Investing", "What you own", /Vanguard Account …0004/);
  await expect(roth.getByText(/Roth IRA/).first()).toBeVisible();
  await expect(roth.getByText(/Source: Your upload, Vanguard Account …0004/).first()).toBeVisible();

  await page.goto("/net-worth");
  await expect(page.getByText("$37,460.56").first()).toBeVisible();
});
