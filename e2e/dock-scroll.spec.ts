import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, addJaneMessage, deleteUser, signedInUser } from "./db";
import { uploadSampleCard } from "./demo-upload";

// Founder: "for the suggestion cards, you can't scroll down with mouse wheel, make that a
// feature." The dock above the chat is one scroller for a card and its details: the wheel moves
// a long card from anywhere over it, to its last line, the page and the chat behind stay put,
// and the keys scroll it too. On a phone the import chip keeps clear of the folded card bar.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const LAST = "That's the whole of it.";
const LONG = [
  "Your Netflix plan went up to $17.99.",
  ...Array.from(
    { length: 24 },
    (_, i) => `Line ${i + 1}: what changed, when, and what it costs you over a year.`,
  ),
  LAST,
].join("\n");

test("the wheel scrolls a long card in the dock to its end, and nothing behind it", async ({
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(isMobile, "the dock is the computer's");
  await page.setViewportSize({ width: 1280, height: 800 });
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  await addJaneMessage(userId, {
    kind: "decision",
    body: LONG,
    refs: {},
    actions: [
      { id: "finding.yes", label: "Show me how", kind: "primary" },
      { id: "snooze", label: "Not now", kind: "secondary" },
    ],
  });

  await page.goto("/report");
  const dock = page.locator("[data-card-dock]");
  const card = dock.locator("article[data-card-state='showing']");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "More details" }).click();
  const scroller = page.locator("[data-dock-scroll]");
  const top = () => scroller.evaluate((el) => el.scrollTop);
  const chatTop = () =>
    page
      .frameLocator('iframe[title="Chat with Jane"]')
      .locator("html")
      .evaluate(() => document.scrollingElement?.scrollTop ?? 0)
      .catch(() => 0);
  const before = { page: await page.evaluate(() => window.scrollY), chat: await chatTop() };

  // Over the headline, not the details: the card still scrolls, all the way to its last line,
  // with its buttons in sight the whole way.
  const headline = card.locator("h3").first();
  const box = (await headline.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.wheel(0, 400);
  await expect.poll(top).toBeGreaterThan(0);
  for (let i = 0; i < 10; i += 1) await page.mouse.wheel(0, 400);
  await expect(card.getByText(LAST)).toBeInViewport();
  await expect(card.getByRole("button", { name: "Show me how" })).toBeInViewport();

  // Past its end: the page and the chat behind don't move.
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(before.page);
  expect(await chatTop()).toBe(before.chat);

  // The keys: back to the top with Home, down again with Page Down.
  await scroller.focus();
  await page.keyboard.press("Home");
  await expect.poll(top).toBe(0);
  await page.keyboard.press("PageDown");
  await expect.poll(top).toBeGreaterThan(0);
});

test("on a phone, the import chip keeps clear of the folded card bar", async ({
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "the phone's folded bar");
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  await uploadSampleCard(page);
  // Jane's cards are posted once the chat has opened: open it once, then Home has them.
  await page.goto("/home");
  await page.locator("#jane-fab").click();
  await expect(
    page.frameLocator('iframe[title="Chat with Jane"]').locator("[data-chat-embed]").first(),
  ).toBeAttached({ timeout: 60_000 });
  const bar = page.locator('[data-card-state="folded"]');
  await expect(async () => {
    await page.goto("/home");
    await expect(bar).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
  await expect(page.locator("[data-import-chip]")).toBeVisible();
  const b = (await bar.boundingBox())!;
  const onTop = await page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-card-state="folded"]'),
    [b.x + b.width / 2, b.y + b.height / 2],
  );
  expect(onTop).toBe(true);
  await bar.click();
  await expect(page.locator('[data-card-state="showing"]')).toBeVisible();
});
