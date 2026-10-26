import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, addSavedChange, deleteUser } from "./db";
import { demoPerson } from "./demo-person";
import { expectMarchingLine } from "./marching";

// Home's Safe to spend and Saved tiles open in place (founder: "When you click safe to spend
// till… it should expand first having a summary on why that number is what it is. On the
// bottom, that box should suggest smth like what are u aiming to spend and it would link you to
// the chat on the right with a dotted line … Saved so far should also … expand and show a
// summary of where was saved"). At 1440 wide and on a phone (the mobile project).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const money = (text: string | null) => Number((text ?? "").replace(/[^\d]/g, ""));

// A tile's pop-up sits beside it: never over the tile, the net worth chart or the chat.
async function clearOf(page: Page, popup: Locator, tile: Locator) {
  const box = (await popup.boundingBox())!;
  const others = [
    tile,
    page.locator("[data-net-worth-chart]"),
    page.locator('aside[data-side-chat]:not([data-side-chat="rail"])'),
  ];
  for (const other of others) {
    if ((await other.count()) === 0 || !(await other.first().isVisible())) continue;
    const o = (await other.first().boundingBox())!;
    const overlaps =
      box.x < o.x + o.width - 1 &&
      o.x < box.x + box.width - 1 &&
      box.y < o.y + o.height - 1 &&
      o.y < box.y + box.height - 1;
    expect(
      overlaps,
      `the pop-up covers ${await other.first().evaluate((e) => e.outerHTML.slice(0, 60))}`,
    ).toBe(false);
  }
}

test("safe to spend says why it's that number, and hands what to spend to the chat", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");

  const tile = page.locator('[data-hub-tile="safe"]');
  const open = tile.getByRole("button", { name: /^Safe to spend/ });
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "true");

  // The balance now, less what's held back, equals the number on the tile.
  const why = tile.locator("[data-safe-why]");
  await expect(why).toBeVisible();
  await expect(why).toContainText("In checking now");
  const lines = why.locator("dd");
  const count = await lines.count();
  expect(count).toBeGreaterThanOrEqual(3);
  expect(count).toBeLessThanOrEqual(6);
  const values = await lines.allTextContents();
  const total = money(values.at(-1)!);
  const held = values.slice(1, -1).reduce((sum, v) => sum + money(v), 0);
  // Whole dollars on screen: within a dollar a line for rounding.
  expect(Math.abs(money(values[0]) - held - total)).toBeLessThanOrEqual(count);
  expect(money(await tile.locator('[data-hub-number="safe"]').textContent())).toBe(total);

  // "How it's worked out" stays on Home: a pop-up beside the tile, joined to it by a dashed line,
  // with the sum line by line (each bill on its own) and the full page as a link inside.
  const how = tile.getByRole("button", { name: /How it's worked out/ });
  await how.click();
  const popup = page.getByRole("dialog", { name: "How it's worked out" });
  await expect(popup).toBeVisible();
  await expect(page).toHaveURL(/\/home$/);
  await expect(how).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("[data-popup-line] path")).toHaveAttribute("d", /^M/);
  await expectMarchingLine(page.locator("[data-popup-line]"));
  const steps = await popup.locator("[data-calc-lines] dd").allTextContents();
  await expect(popup.locator("[data-calc-lines] dt").first()).toContainText("In checking today");
  const stepsHeld = steps.slice(1, -1).reduce((sum, v) => sum + money(v), 0);
  expect(Math.abs(money(steps[0]) - stepsHeld - money(steps.at(-1)!))).toBeLessThanOrEqual(
    steps.length,
  );
  expect(money(steps.at(-1)!)).toBe(total);
  await clearOf(page, popup, tile);
  await expect(popup.getByRole("link", { name: /The full working/ })).toHaveAttribute(
    "href",
    "/figures/safe_to_spend",
  );
  // Esc closes it and gives the focus back; so does a click anywhere else.
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(how).toBeFocused();
  await how.click();
  await expect(popup).toBeVisible();
  // The page's own margin, beside the tiles: nothing there to click.
  await page
    .locator("main")
    .first()
    .click({ position: { x: 2, y: 2 } });
  await expect(popup).toHaveCount(0);

  // It closes and opens again in place (before the chat comes up: on a phone its sheet covers
  // the page).
  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await expect(why).toBeHidden();
  await open.click();
  await expect(why).toBeVisible();

  // "What are you aiming to spend?": the chat comes into view with it ready to type, not sent,
  // and a dotted line joins the tile to it.
  await tile.locator("[data-aim-to-spend]").click();
  const box = page
    .frameLocator('iframe[title="Chat with Jane"]')
    .getByRole("textbox", { name: "Message Jane" });
  const chat = page.frameLocator('iframe[title="Chat with Jane"]');
  await expect(box).toHaveValue("I'm aiming to spend $", { timeout: 30_000 });
  await expect(box).toBeFocused();
  await expect(page.locator("[data-chat-line]")).toBeAttached();
  await expectMarchingLine(page.locator("[data-chat-line]"));
  // A greyed clue after the cursor, not part of what's typed.
  const hint = chat.locator("[data-composer-hint]");
  // After the text, or on its own line under the box when the box is too narrow for both.
  await expect(hint).toContainText("[amount] on [what]");
  await expect(hint).toBeVisible();
  // Sent untouched, nothing goes: the sentence waits to be finished.
  await box.press("Enter");
  await expect(box).toHaveValue("I'm aiming to spend $");
  await expect(chat.locator("[data-draft-question]")).toHaveCount(0);
  // Typing takes the clue away.
  await box.pressSequentially("40 on shoes");
  await expect(hint).toHaveCount(0);
  await expect(box).toHaveValue("I'm aiming to spend $40 on shoes");
});

test("saved so far opens on where the savings came from", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await addSavedChange(userId, { title: "Cancel Hulu", annualCents: 21_600 });
  await addSavedChange(userId, { title: "Cancel the gym", annualCents: 48_000 });
  await page.goto("/home");

  const tile = page.locator('[data-hub-tile="saved"]');
  const open = tile.getByRole("button", { name: /^Saved so far/ });
  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "true");
  const where = tile.locator("[data-saved-where]");
  await expect(where).toBeVisible();
  // Biggest first, each with what kind of saving it was and its amount.
  await expect(where.getByRole("listitem")).toHaveText([
    /^Cancel the gym · you did it\s*\$480\/yr$/,
    /^Cancel Hulu · you did it\s*\$216\/yr$/,
  ]);
  // Saved so far is confirmed money only: these were done by hand and aren't in the
  // transactions yet, so $0 saved, with the $696 a year expected beside it, labelled.
  await expect(tile.locator('[data-hub-number="saved"]')).toContainText("$0");
  await expect(tile.locator("[data-hub-expected]")).toContainText(
    "Expected, not confirmed yet: $696/yr",
  );
  await expect(tile.getByRole("link", { name: /See every saving/ })).toHaveAttribute(
    "href",
    "/saved",
  );

  // "Your plan" stays on Home too: what's saved and where from, what the plan adds, and the goal
  // it goes toward, in a pop-up beside the tile.
  const planButton = tile.getByRole("button", { name: /^Your plan: \d+ things?/ });
  await planButton.click();
  const popup = page.getByRole("dialog", { name: "Your plan" });
  await expect(popup).toBeVisible();
  await expect(page).toHaveURL(/\/home$/);
  const lines = popup.locator("[data-calc-lines] > div");
  await expect(lines.nth(0)).toContainText("Cancel the gym");
  await expect(lines.filter({ hasText: "Expected so far" })).toContainText("$696");
  await expect(lines.last()).toContainText("Expected, plus your plan if you say yes");
  await expect(popup.locator("[data-plan-goal]")).toBeVisible();
  await expect(page.locator("[data-popup-line] path")).toHaveAttribute("d", /^M/);
  await expectMarchingLine(page.locator("[data-popup-line]"));
  await clearOf(page, popup, tile);
  await expect(popup.getByRole("link", { name: /See the whole plan/ })).toHaveAttribute(
    "href",
    "/plan",
  );
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(planButton).toBeFocused();
});
