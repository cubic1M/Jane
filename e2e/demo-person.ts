import { expect, type BrowserContext, type Page } from "@playwright/test";
import { signedInUser, waitForFullScan } from "./db";

// A signed-in person with the demo bank linked and the first scan finished: the starting point
// of the home hub's specs (hub, side chat, feature map).
export async function demoPerson(
  context: BrowserContext,
  page: Page,
  baseURL: string | undefined,
): Promise<string> {
  const user = await signedInUser("user");
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await expect(async () => {
    if (page.url().endsWith("/connect")) {
      await page.getByRole("button", { name: "Link a demo bank" }).click({ timeout: 5_000 });
    }
    await expect(page).not.toHaveURL(/\/connect$/, { timeout: 15_000 });
  }).toPass({ timeout: 90_000 });
  await waitForFullScan(user.userId);
  return user.userId;
}
