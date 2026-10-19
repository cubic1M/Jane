import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Taxes (spec steps 118–127): what Jane found in the demo bank is shown as found, and the
// person's answers are saved from the profile page. No serious accessibility problems.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${page.url()} ${v.id}`);
}

test("the tax profile shows what Jane found and saves the person's answers", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await expect(page).toHaveURL("/chat", { timeout: 60_000 });

  await page.goto("/taxes");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Taxes: 2026");
  const profile = page.getByRole("region", { name: "Your tax profile" });
  await expect(profile.getByText("California")).toBeVisible();
  await expect(profile.getByText("Found by Jane: check it").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "What Jane does by herself" })).toContainText(
    "Nothing is ever filed, signed or paid without your tap.",
  );
  expect(await axe(page)).toEqual([]);

  await profile.getByRole("link", { name: "Finish it" }).click();
  await expect(page).toHaveURL("/taxes/profile");
  await expect(page.getByText("Found by Jane: ACME CORP PAYROLL")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Wages from a job/ })).toBeChecked();
  await page.getByRole("radio", { name: "Head of household" }).check();
  await page.getByLabel("Children under 17 you claim").fill("1");
  await page.getByRole("button", { name: "Save my answers" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved. I'll use these for your taxes.");
  expect(await axe(page)).toEqual([]);

  await page.goto("/taxes");
  await expect(profile.getByText("Head of household")).toBeVisible();
  await expect(profile.getByText("1 under 17, 0 other")).toBeVisible();
  await expect(profile.getByText("Found by Jane: check it")).toHaveCount(0);
});
