import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, addAlert, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("alerts show as new once, and a type turned off in settings disappears", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await addAlert(userId, {
    type: "large_charge",
    title: "$1,200.00 at Best Electronics",
    body: "On your card, Oct 14.",
  });

  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "$1,200.00 at Best Electronics" })).toBeVisible();
  await expect(page.getByText("New", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Seen once, it's no longer new.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("New", { exact: true })).toHaveCount(0);
  }).toPass({ timeout: 15_000 });

  await page.goto("/settings#alerts");
  await page.getByLabel("Unusually large charge").selectOption({ label: "Off" });
  await page.getByRole("button", { name: "Save alert settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

  await page.goto("/alerts");
  await expect(page.getByText("No alerts yet.")).toBeVisible();
});
