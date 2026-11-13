import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Founder (11-12): "when you click open details or open or whatever for the suggestion box, that
// box just disappears and you get sent to the page with the details, i don't want that". On a
// phone: a card in the chat sheet followed to its page opens the page, and the card is still in
// the chat when it opens again, unanswered, with a Yes that works. The same from Home's card bar.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const showing = (where: Page | FrameLocator) =>
  where.locator('[data-floating-cards] article[data-card-state="showing"]');
const headlineOf = async (card: Locator) =>
  ((await card.locator("h3").first().textContent()) ?? "").trim();

async function openChat(page: Page): Promise<FrameLocator> {
  await page.locator("#jane-fab").click();
  const chat = page.frameLocator('iframe[title="Chat with Jane"]');
  await expect(showing(chat)).toBeVisible({ timeout: 60_000 });
  return chat;
}

// Its details opened in the card, then its first page link followed: the page opens.
async function follow(page: Page, card: Locator): Promise<string> {
  await card.getByRole("button", { name: "More details" }).click();
  const link = card.locator("[id^='details-'] a[href^='/']").first();
  await expect(link).toBeVisible();
  const path = new URL((await link.getAttribute("href"))!, "http://x").pathname;
  await link.click();
  await expect(page).toHaveURL((url) => url.pathname === path, { timeout: 30_000 });
  return path;
}

// Back in the chat: the same card showing, unanswered, and its Yes answers it.
async function stillThereThenYes(page: Page, headline: string) {
  const chat = await openChat(page);
  await expect(showing(chat).locator("h3").first()).toHaveText(headline, { timeout: 30_000 });
  await showing(chat).getByRole("button", { name: "Yes", exact: true }).click();
  await expect(
    chat.locator("[data-floating-cards] article").filter({ hasText: headline }),
  ).toHaveCount(0);
}

test("on a phone, following a card's page keeps the card, and Yes still works", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "the phone's chat sheet and card bar");
  userId = await demoPerson(context, page, baseURL);

  // From an area page, in the chat sheet.
  await page.goto("/money");
  const chat = await openChat(page);
  const inSheet = showing(chat);
  const followed = await headlineOf(inSheet);
  await follow(page, inSheet);
  await stillThereThenYes(page, followed);

  // From Home's card bar: folded to one line, opened, followed.
  await page.goto("/home");
  const bar = page.locator('[data-floating-cards] [data-card-state="folded"]');
  if (await bar.count()) await bar.click();
  const onHome = showing(page);
  await expect(onHome).toBeVisible({ timeout: 30_000 });
  const fromHome = await headlineOf(onHome);
  await follow(page, onHome);
  await stillThereThenYes(page, fromHome);
});
