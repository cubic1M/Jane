import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Debug 3 (11-16, re-walking #1964): a finding's card has its own "Don't suggest again", and it
// left no way back. Now it leaves the same line as Not now: "Put away." with Bring it back, which
// returns the card, showing, and takes the No and the "never" back on the server, so the card is
// still there after a reload. On a phone (Home's page) and in the dock on a computer.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

async function stackOf(page: Page, isMobile: boolean): Promise<Locator> {
  const where = isMobile ? page : page.getByRole("complementary", { name: "Chat with Jane" });
  const stack = where.getByRole("region", { name: "Suggestions for you" });
  await expect(stack).toBeVisible({ timeout: 60_000 });
  const fold = stack.locator('[data-card-state="folded"]');
  if (await fold.count()) await fold.click();
  await expect(stack.locator('[data-card-state="showing"]')).toBeVisible();
  return stack;
}

// Steps through the stack until the showing card has its own "Don't suggest again" (a finding's),
// or has this headline.
async function stepTo(page: Page, stack: Locator, headline?: string): Promise<Locator> {
  for (let i = 0; i < 20; i += 1) {
    const card = stack.locator('[data-card-state="showing"]');
    const title = ((await card.locator("h3").first().textContent()) ?? "").trim();
    const own = await card
      .getByRole("button", { name: "Don't suggest again", exact: true })
      .count();
    if (headline ? title === headline : own > 0) return card;
    const next = stack.locator("[data-dock-header]").getByRole("button", { name: /next/ });
    if (await next.count()) await next.click();
    else {
      await page.locator("body").focus();
      await page.keyboard.press("ArrowRight");
    }
  }
  throw new Error(headline ? `No card "${headline}"` : "No finding's card in the stack");
}

const posted = (page: Page, actionId: string) =>
  page.waitForResponse(
    (r) => r.request().method() === "POST" && !!r.request().postData()?.includes(actionId),
  );

test("a finding's card put away with Don't suggest again comes back, after a reload too", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  await page.setViewportSize(isMobile ? { width: 375, height: 812 } : { width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");
  let stack = await stackOf(page, isMobile);
  const card = await stepTo(page, stack);
  const headline = ((await card.locator("h3").first().textContent()) ?? "").trim();
  const line = stack.locator("[data-card-put-away]");

  const never = posted(page, "suggest.never");
  await card.getByRole("button", { name: "Don't suggest again", exact: true }).click();
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("role", "status");
  await never;

  const back = posted(page, "undo.suggest_never");
  await line.getByRole("button", { name: "Bring it back" }).click();
  await expect(stack.locator('[data-card-state="showing"] h3').first()).toHaveText(headline);
  await expect(line).toHaveCount(0);
  expect((await back).ok()).toBe(true);

  await page.reload();
  stack = await stackOf(page, isMobile);
  await stepTo(page, stack, headline);
});
