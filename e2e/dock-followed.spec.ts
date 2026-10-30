import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Founder: "Whenever I switch to a page based on the suggestion card's suggestion, the
// suggestion just reappears." A card followed to its page, or answered, leaves the dock and
// doesn't come back: not on that page, not on the next, not after a reload; and once its answer
// is in, not in a fresh tab either (src/lib/dock-gone.ts and the cards route's ?skip).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const showingIn = (page: Page) =>
  page.locator("[data-card-dock] article[data-card-state='showing']");
const cardNamed = (page: Page, headline: string) =>
  page
    .locator("[data-card-dock] article")
    .filter({ has: page.getByText(headline, { exact: true }) });

// The dock has loaded (its cards come once the chat has opened: a later load shows them).
async function dockReady(page: Page) {
  await expect(async () => {
    await page.reload();
    await expect(showingIn(page)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
}

// Steps through the dock until `has` is on the showing card.
async function stepTo(page: Page, has: (card: Locator) => Locator): Promise<Locator> {
  for (let i = 0; i < 15; i += 1) {
    const card = showingIn(page);
    if (await has(card).count()) return card;
    await page.locator("[data-dock-header]").getByRole("button", { name: /next/ }).click();
  }
  throw new Error("No card in the dock had it");
}

const headlineOf = async (card: Locator) =>
  ((await card.locator("h3").first().textContent()) ?? "").trim();

test("a card followed to its page, or answered, doesn't come back", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(isMobile, "the dock is the computer's");
  await page.setViewportSize({ width: 1280, height: 800 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/report");
  await dockReady(page);

  // Followed to its page: the page opens and the card is gone, there and after.
  await showingIn(page).getByRole("button", { name: "More details" }).click();
  const linked = await stepTo(page, (card) => card.locator("a[href^='/']"));
  const followed = await headlineOf(linked);
  const href = (await linked.locator("a[href^='/']").first().getAttribute("href"))!;
  await linked.locator("a[href^='/']").first().click();
  const path = new URL(href, "http://x").pathname;
  await expect(page).toHaveURL((url) => url.pathname === path);
  await expect(cardNamed(page, followed)).toHaveCount(0);
  await page.waitForTimeout(2_000);
  await expect(cardNamed(page, followed)).toHaveCount(0);
  await page.goto("/money");
  await page.waitForTimeout(2_000);
  await expect(cardNamed(page, followed)).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(2_000);
  await expect(cardNamed(page, followed)).toHaveCount(0);

  // Answered Yes, then off to another page: gone, and still gone after a reload.
  const yes = await stepTo(page, (card) => card.getByRole("button", { name: "Yes", exact: true }));
  const answered = await headlineOf(yes);
  await yes.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(cardNamed(page, answered)).toHaveCount(0);
  // The next card is on screen at once.
  await expect(showingIn(page)).toBeVisible();
  await page.goto("/taxes");
  await page.waitForTimeout(2_000);
  await expect(cardNamed(page, answered)).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(2_000);
  await expect(cardNamed(page, answered)).toHaveCount(0);

  // On the ledger a Yes is "You said yes", never Done, with the page where it's done (manager
  // decision 10-30, honest labels).
  await page.goto("/saved");
  const said = page.locator('[data-ledger-entry="said_yes"]');
  await expect(said.first()).toBeVisible({ timeout: 30_000 });
  await expect(said.first().locator("summary")).toContainText("[You said yes]");
  await said.first().locator("summary").click();
  const open = said.first().locator("[data-ledger-open]");
  await expect(open).toBeVisible();
  expect(await open.getAttribute("href")).toMatch(/^\/(?!chat)/);

  // A fresh tab knows nothing of this one: the server has the answer, so it isn't served.
  const fresh = await context.newPage();
  await fresh.setViewportSize({ width: 1280, height: 800 });
  await fresh.goto("/report");
  await expect(showingIn(fresh)).toBeVisible({ timeout: 30_000 });
  await fresh.waitForTimeout(2_000);
  await expect(cardNamed(fresh, answered)).toHaveCount(0);
});
