import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, addSavedChange, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

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
  await expect(tile.getByRole("link", { name: /How it's worked out/ })).toHaveAttribute(
    "href",
    "/figures/safe_to_spend",
  );

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
  await expect(box).toHaveValue("I'm planning to spend $", { timeout: 30_000 });
  await expect(box).toBeFocused();
  await expect(page.locator("[data-chat-line]")).toBeAttached();
  // Nothing was sent: the person types the amount.
  await expect(
    page.frameLocator('iframe[title="Chat with Jane"]').getByText("I'm planning to spend $", {
      exact: true,
    }),
  ).toHaveCount(0);
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
  await expect(tile.locator('[data-hub-number="saved"]')).toContainText("$696");
  await expect(tile.getByRole("link", { name: /See every saving/ })).toHaveAttribute(
    "href",
    "/saved",
  );
});
