import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// "What Jane does" (docs/design/home-hub.md): from the hub, each area's features as a tree.
// Opening a branch zooms onto its features, each with one line and "for you" when it has
// reached this person; the keyboard walks the tree; a picked feature opens its page or asks
// Jane about it in the chat. On a phone too, with nothing sideways.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("the feature map opens branch by branch, by mouse and keyboard", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");
  await page.getByRole("link", { name: "What Jane does ›" }).click();
  await expect(page).toHaveURL("/home/map");
  await expect(page.getByRole("heading", { level: 1, name: "What Jane does" })).toBeVisible();
  // Hub QA: the area chips' screen-reader words widened the page on a 375px phone.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);

  const tree = page.getByRole("tree", { name: "What Jane does: Spending & bills" });
  await expect(tree).toBeVisible();
  // It starts at the branches: no node repeating the area's name (its chip above says it).
  await expect(tree.getByRole("treeitem", { name: /^Spending & bills/ })).toHaveCount(0);
  const branches = tree.locator('[role="treeitem"][aria-level="1"]');
  expect(await branches.count()).toBeGreaterThan(1);
  await expect(tree.locator('[role="treeitem"][aria-level="2"]')).toHaveCount(0);
  // One tab stop.
  await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);

  // The keyboard: on a branch, right opens it and goes in, left comes back out.
  const first = branches.first();
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(first).toHaveAttribute("aria-expanded", "true");
  const features = tree.locator('[role="treeitem"][aria-level="2"]');
  expect(await features.count()).toBeGreaterThan(0);
  await page.keyboard.press("ArrowRight");
  await expect(features.first()).toBeFocused();
  await expect(features.first()).toContainText(/Like: |Comes up when|demo data only/);
  await page.keyboard.press("Enter");
  await expect(features.first()).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: "Open the page ›" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(features).toHaveCount(0);

  // The mouse: a branch with something for this person, opened, zooms onto its features.
  const mine = branches.filter({ hasText: /\d+ for you/ }).first();
  await mine.click();
  await expect(mine).toHaveAttribute("aria-expanded", "true");
  await expect(features.filter({ hasText: "for you" }).first()).toBeVisible();
  await expect(features.first()).toBeInViewport();

  // Ask Jane about a feature: the chat opens with the question in its message box.
  await features.filter({ hasText: "for you" }).first().click();
  await page.getByRole("button", { name: "Ask Jane about this" }).click();
  if (isMobile) await expect(page.getByRole("dialog", { name: "Chat with Jane" })).toBeVisible();
  const chat = page.frameLocator('iframe[title="Chat with Jane"]');
  await expect(chat.getByRole("textbox", { name: "Message Jane" })).toHaveValue(
    /^Tell me about .+: does it apply to me\?$/,
    { timeout: 30_000 },
  );
  if (isMobile) await page.getByRole("dialog").getByRole("button", { name: "Close chat" }).click();

  // Another area's map.
  await page.getByRole("button", { name: /^Taxes/ }).click();
  await expect(page.getByRole("tree", { name: "What Jane does: Taxes" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
