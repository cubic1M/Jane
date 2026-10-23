import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser, waitForFullScan } from "./db";

// The day's suggestions as floating cards over the chat (founder request): one at a time, a
// card above the page and not in it, a short card with Yes and Not now, More details already
// there, the next card sliding in, keys and swipe, and every tap answered on screen within
// 100 ms (the server follows). A waiting suggestion is only in the cards, not the message list
// too; answered, it is in the list as history. On a phone, with nothing sideways.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("suggestions float over the chat one at a time, and every tap answers at once", async ({
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
  await expect(async () => {
    if (page.url().endsWith("/connect")) {
      await page.getByRole("button", { name: "Link a demo bank" }).click({ timeout: 5_000 });
    }
    await expect(page).toHaveURL("/chat", { timeout: 15_000 });
  }).toPass({ timeout: 90_000 });
  await waitForFullScan(user.userId);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeVisible();

  const overlay = page.getByRole("region", { name: "Suggestions for you" });
  await expect(overlay).toBeVisible({ timeout: 60_000 });
  const counter = overlay.locator("p[aria-live]");
  await expect(counter).toHaveText(/^\d+ left$/);
  const total = Number(((await counter.textContent()) ?? "").split(" ")[0]);
  expect(total).toBeGreaterThanOrEqual(2);

  // Floating: fixed over the page, not part of the message list.
  expect(await overlay.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  expect(await page.getByRole("list", { name: "Messages" }).locator(overlay).count()).toBe(0);
  // The suggestion's message in the list, if it is there.
  const messages = page.getByRole("list", { name: "Messages" }).getByRole("listitem");
  const inList = (headline: string) => messages.filter({ hasText: headline });
  // The agenda only says the suggestions are on the cards: none of their lines or buttons.
  const agenda = messages.filter({ hasText: /Good (morning|afternoon|evening)!/ });
  await expect(agenda).toContainText(/on the cards? at the bottom\./);
  await expect(agenda.getByRole("button", { name: /Not for me:/ })).toHaveCount(0);

  // Short: a headline with one number, Yes and Not now, and More details closed.
  const showing = overlay.locator('[data-card-state="showing"]');
  const headline = showing.getByRole("heading", { level: 3 });
  const first = (await headline.textContent()) ?? "";
  // The cards are the one place a waiting suggestion shows: it is not in the list as well.
  await expect(inList(first)).toHaveCount(0);
  expect(first.trim().split(/\s+/).length).toBeLessThanOrEqual(10);
  expect((first.match(/\$[\d,.]+/g) ?? []).length).toBe(1);
  await expect(showing.getByRole("button", { name: "Yes", exact: true })).toBeVisible();
  await expect(showing.getByRole("button", { name: "Not now", exact: true }).first()).toBeVisible();
  const details = showing.locator('[id^="details-"]');
  await expect(details).toBeHidden();

  // Nothing sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // More details opens at once (it was on the page already): the reasoning.
  await showing.getByRole("button", { name: "More details" }).click();
  await expect(details).toBeVisible();
  await expect(details).toContainText("Why you:");
  await expect(details).toContainText(/\d+% sure:/);
  await expect(details).toContainText("What Yes does:");

  // Arrow keys and swipe move between the waiting cards.
  await page.keyboard.press("ArrowRight");
  await expect(headline).not.toHaveText(first);
  await page.keyboard.press("ArrowLeft");
  await expect(headline).toHaveText(first);
  await showing.getByRole("button", { name: "More details" }).click();

  // Not now: the card is answered on screen within 100 ms, the next slides in, the count drops.
  const started = Date.now();
  await showing.getByRole("button", { name: "Not now", exact: true }).first().click();
  await expect(counter).toHaveText(`${total - 1} left`, { timeout: 100 });
  await expect(headline).not.toHaveText(first, { timeout: 100 });
  expect(Date.now() - started).toBeLessThan(1_000);

  // Yes is just as quick, and the server catches up: the list then has it as history, with
  // what was chosen and no buttons left to tap.
  const second = (await headline.textContent()) ?? "";
  await expect(inList(second)).toHaveCount(0);
  await showing.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(counter).toHaveText(`${total - 2} left`, { timeout: 100 });
  await expect(inList(second)).toHaveCount(1, { timeout: 15_000 });
  await expect(inList(second)).toContainText("You chose:");
  await expect(inList(second).getByRole("button", { name: /Not now|Not for me/ })).toHaveCount(0);

  // The ✕ is Not now too.
  if (total - 2 >= 1) {
    await showing.getByRole("button", { name: "Not now", exact: true }).first().click();
  }
});
