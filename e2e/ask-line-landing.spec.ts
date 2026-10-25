import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Founder bugs on live /home (2026-10-25): the "Ask Jane" box at the end of the tree always draws
// its dotted line to the chat, and asked already it still works (finding the earlier answer);
// and coming from the landing page, Home is never left with the landing's white background.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

test("Ask Jane always draws its line, and asked again finds the earlier answer", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");
  const tree = page.locator("[data-giant-tree]");
  await tree.locator('[data-giant-area-tile="taxes"]').click({ timeout: 60_000 });
  const feature = tree.locator('[data-giant-area="taxes"] [data-giant-feature]').first();
  await feature.getByRole("button").first().click();
  const ask = feature.locator("[data-ask-jane]");
  const line = page.locator("[data-ask-line]");
  const chat = page.frameLocator('iframe[title="Chat with Jane"]');
  const messages = chat.getByRole("list", { name: "Messages" }).getByRole("listitem");

  // First ask: the line to the question as it lands.
  await ask.click();
  await expect(line).toBeVisible({ timeout: 30_000 });
  await expect(ask).toContainText("ASKED ✓ · TAP TO SEE", { timeout: 60_000 });
  const count = await messages.count();
  if (isMobile) await page.getByRole("button", { name: "Close chat" }).click();

  // Asked already: still a button, and pressed it draws the line to the earlier answer and
  // marks it, with nothing asked again.
  await expect(ask).toBeEnabled();
  await ask.click();
  await expect(ask).toHaveAttribute("data-ask-state", "finding");
  await expect(line).toBeVisible({ timeout: 10_000 });
  await expect(chat.locator(".ask-found")).toHaveCount(1);
  await expect(ask).toHaveAttribute("data-ask-state", "done", { timeout: 5_000 });
  expect(await messages.count()).toBe(count);

  // With the chat folded away (a computer's rail): it opens, and the line still draws.
  if (!isMobile) {
    const panel = page.getByRole("complementary", { name: "Chat with Jane" });
    await panel.getByRole("button", { name: "Collapse chat" }).click();
    await expect(panel.getByRole("button", { name: /^Open chat/ })).toBeVisible();
    await ask.click();
    await expect(line).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByRole("button", { name: "Collapse chat" })).toBeVisible();
    expect(await messages.count()).toBe(count);
  }
});

test("from the landing page, Home keeps the app's own background, back and forward too", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // The app's own dark background, from a page that isn't the landing.
  await page.goto("/privacy");
  const appBg = await bodyBg();

  await page.goto("/");
  await expect(page.locator("html[data-landing]")).toHaveCount(1);
  const landingBg = await bodyBg();
  expect(landingBg).not.toBe(appBg);

  // Into the app by a click (no reload): Try it with sample data lands on Home.
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Try it with sample data" }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 });
  await expect(page.locator("html[data-landing]")).toHaveCount(0);
  await expect.poll(bodyBg).toBe(appBg);

  // Back to the landing and forward again, still without a reload.
  await page.goBack();
  if (new URL(page.url()).pathname === "/" && (await page.locator(".landing").isVisible())) {
    await expect.poll(bodyBg).toBe(landingBg);
    await page.goForward();
    await expect(page).toHaveURL(/\/home$/);
    await expect.poll(bodyBg).toBe(appBg);
  }
});
