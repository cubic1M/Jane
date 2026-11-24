import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser, waitForFullScan } from "./db";
import { CHAT, landInChat } from "./chat-page";
import { holdSaves, nextSave } from "./waits";
import { signInWith } from "./session";

// The day's suggestions as floating cards (founder request): one at a time, a card above the page
// and not in it, a short card with Yes and Not now, More details already there, the next card
// sliding in, keys and swipe, and every tap answered on screen within 100 ms (the server follows).
// On a phone, with nothing sideways: Home's folded "Jane · N for you", opened. A suggestion is
// never in the chat, waiting or answered (founder 11-24: "suggestions belong only in the
// suggestion box"), so the chat is checked at the end.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("suggestions float on Home one at a time, and every tap answers at once", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(context, user.sessionToken, baseURL);
  await page.goto("/connect");
  await expect(async () => {
    if (page.url().endsWith("/connect")) {
      await page.getByRole("button", { name: "Link a demo bank" }).click({ timeout: 5_000 });
    }
    await landInChat(page, 15_000);
  }).toPass({ timeout: 90_000 });
  await waitForFullScan(user.userId);
  // On a phone the cards wait on Home, folded to one line: a tap opens them.
  const overlay = page.getByRole("region", { name: "Suggestions for you" });
  const unfold = async () => {
    await page.goto("/home");
    await overlay.locator('[data-card-state="folded"]').click({ timeout: 60_000 });
  };
  await unfold();
  await expect(overlay).toBeVisible({ timeout: 60_000 });
  const counter = overlay.locator("p[aria-live]");
  await expect(counter).toHaveText(/^\d+ left$/);
  const total = Number(((await counter.textContent()) ?? "").split(" ")[0]);
  expect(total).toBeGreaterThanOrEqual(2);

  // Floating: fixed over the page.
  expect(await overlay.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");

  // Short: a headline with one number, Yes and Not now, and More details closed.
  const showing = overlay.locator('[data-card-state="showing"]');
  const headline = showing.getByRole("heading", { level: 3 });
  const first = (await headline.textContent()) ?? "";
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

  // Not now: answered on screen before the server replies, the next slides in, the count drops.
  let release = await holdSaves(page);
  await showing.getByRole("button", { name: "Not now", exact: true }).first().click();
  await expect(counter).toHaveText(`${total - 1} left`);
  await expect(headline).not.toHaveText(first);
  await release();

  // Yes is just as quick, and the server catches up. A suggestion never shows in the chat,
  // waiting or answered (founder: "Don't let the suggestion cards repeat in the chat again").
  const second = (await headline.textContent()) ?? "";
  const saved = nextSave(page);
  release = await holdSaves(page);
  await showing.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(counter).toHaveText(`${total - 2} left`);
  await release();
  await saved;
  // Reloaded, the one answered Yes is gone; the ✕ is Not now too.
  if (total - 2 >= 1) {
    await unfold();
    await expect(overlay.getByRole("heading", { level: 3, name: second })).toHaveCount(0);
    await showing.getByRole("button", { name: "Not now", exact: true }).first().click();
  } else {
    await page.goto("/home");
    await expect(overlay).toHaveCount(0);
  }

  // Never in the chat: no card floats over it, and neither suggestion is in its list, answered or
  // put off, nor the agenda.
  await page.goto(CHAT);
  await expect(page.getByRole("textbox", { name: "Message Jane" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Suggestions for you" })).toHaveCount(0);
  const messages = page.getByRole("listitem");
  for (const said of [first, second]) {
    await expect(messages.filter({ hasText: said.trim() })).toHaveCount(0);
  }
  await expect(messages.filter({ hasText: /Good (morning|afternoon|evening)!/ })).toHaveCount(0);
});
