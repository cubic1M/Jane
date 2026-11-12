import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
// A computer, where Jane's cards sit docked beside the page.
test.use({ viewport: { width: 1280, height: 800 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// Debugger 11-12: at the end of a new person's first sync the page reloaded its numbers, but the
// card dock stayed empty until a reload (it looked again only a minute later). The first yes/no
// card shows as the scan ends, with no reload.
test("the first scan's yes/no card shows as the scan ends, without a reload", async ({
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
  await expect(page).toHaveURL(/\/home(\?|$)/, { timeout: 60_000 });
  // The scan bar fades out once the scan is done.
  await expect(page.locator("[data-scan-bar]")).toHaveCount(0, { timeout: 60_000 });

  const dock = page.getByRole("region", { name: "Jane's suggestions, scrollable" });
  await expect(dock.getByRole("button", { name: "Not now" }).first()).toBeVisible({
    timeout: 15_000,
  });
});
