import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Founder (11-16): "there should be an option to go back to the suggestion that they just clicked
// close". A suggestion put away (Not now, or "Don't suggest this again") leaves a line in its
// place; its button brings the same card back, showing, and the server takes the put-away back
// too, so the card is still there after a reload. On a phone the cards are in Home's page; on a
// computer, in the dock above the chat. The line is announced and works from the keyboard.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// The stack, opened: in the page on a phone (folded to one line until tapped), in the dock.
async function stackOf(page: Page, isMobile: boolean): Promise<Locator> {
  const where = isMobile ? page : page.getByRole("complementary", { name: "Chat with Jane" });
  const stack = where.getByRole("region", { name: "Suggestions for you" });
  await expect(stack).toBeVisible({ timeout: 60_000 });
  const fold = stack.locator('[data-card-state="folded"]');
  if (await fold.count()) await fold.click();
  await expect(stack.locator('[data-card-state="showing"]')).toBeVisible();
  return stack;
}

// Steps through the stack until the showing card is a suggestion, or the one with this headline.
async function stepTo(page: Page, stack: Locator, headline?: string): Promise<Locator> {
  for (let i = 0; i < 15; i += 1) {
    const card = stack.locator('[data-card-state="showing"]');
    const title = ((await card.locator("h3").first().textContent()) ?? "").trim();
    // A suggestion, not another of Jane's cards: its details say what Yes does (cardOf).
    const suggestion = (await card.getByText("Yes opens the page where you do it").count()) > 0;
    if (headline ? title === headline : suggestion) {
      return card;
    }
    const next = stack.locator("[data-dock-header]").getByRole("button", { name: /next/ });
    if (await next.count()) await next.click();
    else {
      await page.locator("body").focus();
      await page.keyboard.press("ArrowRight");
    }
  }
  throw new Error(headline ? `No card "${headline}" in the stack` : "No suggestion in the stack");
}

const posted = (page: Page, actionId: string) =>
  page.waitForResponse(
    (r) => r.request().method() === "POST" && !!r.request().postData()?.includes(actionId),
  );

test("a suggestion put away comes back from the line in its place, after a reload too", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  await page.setViewportSize(isMobile ? { width: 375, height: 812 } : { width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");
  let stack = await stackOf(page, isMobile);
  let card = await stepTo(page, stack);
  const headline = ((await card.locator("h3").first().textContent()) ?? "").trim();
  const line = stack.locator("[data-card-put-away]");

  // Not now: the card goes, a line in its place says so, announced.
  const snoozed = posted(page, "snooze");
  await card.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("role", "status");
  await expect(line).toContainText("Put away.");
  await expect(
    stack.locator('[data-card-state="showing"] h3').filter({ hasText: headline }),
  ).toHaveCount(0);
  await snoozed;

  // Brought back from the keyboard: the same card, showing, and the line gone.
  const unsnoozed = posted(page, "undo.snooze");
  const back = line.getByRole("button", { name: "Bring it back" });
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(stack.locator('[data-card-state="showing"] h3').first()).toHaveText(headline);
  await expect(line).toHaveCount(0);
  expect((await unsnoozed).ok()).toBe(true);

  // The server has it open again: after a reload it's still in the stack.
  await page.reload();
  stack = await stackOf(page, isMobile);
  card = await stepTo(page, stack, headline);

  // "Don't suggest this again", then brought back with a tap: still offered after a reload.
  const declined = posted(page, "suggestion.no");
  await card.getByRole("button", { name: "More details" }).click();
  await card.getByRole("button", { name: "Don't suggest this again" }).click();
  await expect(line).toBeVisible();
  await declined;
  const undeclined = posted(page, "undo.never");
  await line.getByRole("button", { name: "Bring it back" }).click();
  await expect(stack.locator('[data-card-state="showing"] h3').first()).toHaveText(headline);
  expect((await undeclined).ok()).toBe(true);
  await page.reload();
  stack = await stackOf(page, isMobile);
  await stepTo(page, stack, headline);
});
