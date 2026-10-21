import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// The day's suggestions as one card at a time over the chat (founder request): "1 of N",
// Back and Next, the arrow keys and a swipe, the short form on each card, Hide to a chip
// that opens it again, and a Yes that answers the card. On a phone, with nothing sideways.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("suggestions come one card at a time, by buttons, arrow keys and swipe", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/connect");
  await expect(async () => {
    if (page.url().endsWith("/connect")) {
      await page.getByRole("button", { name: "Link a demo bank" }).click({ timeout: 5_000 });
    }
    await expect(page).toHaveURL("/chat", { timeout: 15_000 });
  }).toPass({ timeout: 90_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeVisible({
    timeout: 60_000,
  });

  const stack = page.getByRole("region", { name: "Suggestions for you" });
  await expect(stack).toBeVisible({ timeout: 60_000 });
  const counter = stack.locator("p[aria-live]");
  await expect(counter).toHaveText(/^1 of \d+$/);
  const total = Number(((await counter.textContent()) ?? "").split(" of ")[1]);
  expect(total).toBeGreaterThanOrEqual(2);

  // The short form: a headline, why you, and how sure.
  await expect(stack.getByRole("heading", { level: 3 })).toBeVisible();
  await expect(stack).toContainText("Why you:");
  await expect(stack.getByRole("button", { name: /\d+% sure/ })).toBeVisible();
  await expect(stack.getByRole("button", { name: "Previous suggestion" })).toBeDisabled();
  const first = await stack.getByRole("heading", { level: 3 }).textContent();

  // Nothing sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // Next, Back.
  await stack.getByRole("button", { name: "Next suggestion" }).click();
  await expect(counter).toHaveText(`2 of ${total}`);
  await expect(stack.getByRole("heading", { level: 3 })).not.toHaveText(first ?? "");
  await stack.getByRole("button", { name: "Previous suggestion" }).click();
  await expect(counter).toHaveText(`1 of ${total}`);

  // Arrow keys.
  await page.keyboard.press("ArrowRight");
  await expect(counter).toHaveText(`2 of ${total}`);
  await page.keyboard.press("ArrowLeft");
  await expect(counter).toHaveText(`1 of ${total}`);

  // A swipe left moves on, a swipe right goes back.
  const swipe = (from: number, to: number) =>
    stack.evaluate(
      (el, [x1, x2]) => {
        const touch = (x: number) =>
          new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 });
        const fire = (type: string, x: number) =>
          el.dispatchEvent(
            new TouchEvent(type, {
              bubbles: true,
              touches: type === "touchend" ? [] : [touch(x)],
              changedTouches: [touch(x)],
            }),
          );
        fire("touchstart", x1);
        fire("touchend", x2);
      },
      [from, to],
    );
  await swipe(300, 100);
  await expect(counter).toHaveText(`2 of ${total}`);
  await swipe(100, 300);
  await expect(counter).toHaveText(`1 of ${total}`);

  // The reason behind the percentage, on a tap.
  await stack.getByRole("button", { name: /\d+% sure/ }).click();
  await expect(stack).toContainText("Based on");

  // Why? shows the whole explanation in the card.
  await stack.getByRole("button", { name: "Why?" }).click();
  await expect(stack.getByRole("button", { name: "Why?" })).toHaveCount(0);
  await expect(
    stack.getByRole("button", { name: /^(?!Previous|Next|Hide)/ }).first(),
  ).toBeVisible();

  // Hide leaves a chip that opens it again.
  await stack.getByRole("button", { name: "Hide" }).click();
  await expect(stack).toHaveCount(0);
  const chip = page.getByRole("button", { name: /^\d+ suggestions?$/ });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(stack).toBeVisible();

  // Not for me answers the card; the chip's count drops.
  await stack.getByRole("button", { name: "Not for me" }).click();
  await expect(stack.getByRole("status")).toContainText("You chose: Not for me");
});
