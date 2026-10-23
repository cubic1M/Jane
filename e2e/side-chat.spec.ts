import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, addJaneMessage, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// The side chat (docs/design/home-hub.md). On a computer the chat is docked beside every page,
// folds to a rail with an unread dot, opens over the whole window and is remembered; changing
// tab keeps it as it is, and a link in it opens in the main window. On a phone it is a sheet
// from the Jane button: half height, dragged to full, closed again, nothing sideways.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("on a computer the chat docks beside the page, folds, expands and stays put", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(isMobile, "phones get the bottom sheet");
  await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);

  await page.goto("/money");
  const panel = page.getByRole("complementary", { name: "Chat with Jane" });
  await expect(panel).toBeVisible();
  const chat = page.frameLocator('iframe[title="Chat with Jane"]');
  await expect(chat.getByRole("textbox", { name: "Message Jane" })).toBeVisible({
    timeout: 30_000,
  });
  // Docked: about 380 wide on the right, and the page makes room for it.
  const docked = (await panel.boundingBox())!;
  expect(Math.round(docked.width)).toBe(380);
  expect(Math.round(docked.x + docked.width)).toBe(1440);
  const main = (await page.locator("main").boundingBox())!;
  expect(main.x + main.width).toBeLessThanOrEqual(docked.x + 1);
  // The chat in the panel has no page header of its own.
  await expect(chat.getByRole("navigation", { name: "Main" })).toHaveCount(0);

  // Changing tab keeps the chat as it is: the frame isn't loaded again.
  await chat.locator("body").evaluate(() => ((window as { kept?: boolean }).kept = true));
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Insurance" })
    .click();
  await expect(page).toHaveURL("/insurance");
  expect(await chat.locator("body").evaluate(() => (window as { kept?: boolean }).kept)).toBe(true);

  // A link inside the chat opens in the main window, and the chat stays docked.
  const link = chat.locator('main a[href^="/"]:not([href^="/chat"])').first();
  const href = (await link.getAttribute("href")) ?? "";
  await link.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(new URL(href, baseURL).pathname);
  await expect(panel).toBeVisible();

  // Folded to a rail, remembered after a reload.
  await panel.getByRole("button", { name: "Collapse chat" }).click();
  const open = panel.getByRole("button", { name: /^Open chat/ });
  await expect(open).toBeVisible();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(56);
  await page.reload();
  await expect(open).toBeVisible();

  // Something new while folded: the rail shows a dot.
  await addJaneMessage(userId, {
    kind: "heads_up",
    body: "Your phone bill went up by $5.",
    refs: {},
    actions: [],
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(panel.getByRole("button", { name: /^Open chat, \d+ new$/ })).toBeVisible({
    timeout: 15_000,
  });

  // Open, then over the whole window, then docked again (Escape works too).
  await page.getByRole("button", { name: /^Chat( \d+ new)?$/ }).click();
  await expect(panel.getByRole("button", { name: "Expand chat" })).toBeVisible();
  await panel.getByRole("button", { name: "Expand chat" }).click();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(1440);
  await panel.getByRole("button", { name: "Dock chat" }).click();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(380);
  await panel.getByRole("button", { name: "Expand chat" }).click();
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "Expand chat" })).toBeVisible();

  // The chat's own page is the chat expanded: no panel beside it.
  await page.goto("/chat");
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeVisible();
  await expect(panel).toHaveCount(0);
});

test("on a phone the chat is a sheet from the Jane button", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "computers get the docked panel");
  await page.setViewportSize({ width: 375, height: 812 });
  userId = await demoPerson(context, page, baseURL);

  await page.goto("/money");
  const button = page.getByRole("button", { name: /^Chat with Jane/ });
  const sheet = page.getByRole("dialog", { name: "Chat with Jane" });
  await expect(sheet).toHaveCount(0);
  await button.click();
  await expect(sheet).toBeVisible();
  const chat = page.frameLocator('iframe[title="Chat with Jane"]');
  await expect(chat.getByRole("textbox", { name: "Message Jane" })).toBeVisible({
    timeout: 30_000,
  });
  // Half the screen, then dragged up to nearly all of it.
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(406);
  const handle = (await sheet.getByText("Jane", { exact: true }).boundingBox())!;
  await page.mouse.move(handle.x + 20, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 20, handle.y - 150, { steps: 5 });
  await page.mouse.move(handle.x + 20, handle.y - 300, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await sheet.boundingBox())!.height).toBeGreaterThan(700);
  // The ⤢ button does the same without a gesture.
  await sheet.getByRole("button", { name: "Shrink chat" }).click();
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(406);

  // Closed, focus goes back to the Jane button; nothing on the page scrolls sideways.
  await sheet.getByRole("button", { name: "Close chat" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(button).toBeFocused();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The area tabs scroll sideways at the top, the current one in view.
  const tabs = page.getByRole("navigation", { name: "Main" });
  await tabs.getByRole("link", { name: "Plans & goals" }).click();
  await expect(page).toHaveURL("/ahead");
  await expect(tabs.getByRole("link", { name: "Plans & goals" })).toBeInViewport();
});
