import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// The practice portfolio's settings (Phase AW, Stage A) on the demo bank: plain-language controls
// that change what the autopilot does, shown back as the rules it now follows. Practice money and
// demo advice only.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("practice settings save and change what Jane does", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await expect(page).toHaveURL("/chat", { timeout: 60_000 });

  await page.goto("/investments/practice");
  await page.getByRole("link", { name: /Set your goal, extra moves and what to avoid/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Practice settings");
  const doing = page.getByRole("region", { name: "What Jane does now" });
  await expect(doing.getByText(/trades the practice portfolio herself/)).toBeVisible();
  await expect(doing.getByText("Demo advice: sample data, not financial advice")).toBeVisible();

  await page.getByLabel("Risk level").selectOption("2");
  await page.getByLabel("Oil, gas and coal companies").check();
  await page.getByLabel(/^Off/).check();
  await page.getByLabel(/^Suggest only/).check();
  await page.getByRole("button", { name: "Save settings" }).click();

  await expect(page.getByRole("status")).toHaveText("Saved. Jane uses it from the next run.");
  await expect(doing.getByText(/Suggest only: Jane says what she would do/)).toBeVisible();
  await expect(doing.getByText("The mix is the Low model.")).toBeVisible();
  await expect(doing.getByText("Never bought: Oil, gas and coal companies.")).toBeVisible();
  await expect(doing.getByText("No extra moves: just the model, kept on target.")).toBeVisible();
  await expect(page.getByLabel("Risk level")).toHaveValue("2");

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
});
