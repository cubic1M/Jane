import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// The chat never scrolls the page (founder: "when you scroll to the bottom and have no more
// place to scroll, you shouldn't cause the whole screen to scroll down. Never let the chat
// scroll affect the whole screen scroll"): a wheel or trackpad over the docked chat, or a
// finger in the phone's sheet, moves the chat and stops at its ends; the page stays put.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("scrolling the chat past its ends never scrolls the page", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");
  if (isMobile) await page.getByRole("button", { name: /^Chat with Jane/ }).click();
  const frame = page.locator('iframe[title="Chat with Jane"]');
  await expect(
    page
      .frameLocator('iframe[title="Chat with Jane"]')
      .getByRole("textbox", { name: "Message Jane" }),
  ).toBeVisible({ timeout: 60_000 });
  const pageY = () => page.evaluate(() => window.scrollY);
  // Home is long enough to scroll, so a scroll handed on would show.
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
  const box = (await frame.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  if (isMobile) {
    // A finger dragging up and down in the sheet, well past the chat's ends.
    const cdp = await context.newCDPSession(page);
    for (const yDistance of [-1500, 1500]) {
      const before = await pageY();
      await cdp.send("Input.synthesizeScrollGesture", {
        x,
        y,
        yDistance,
        gestureSourceType: "touch",
        speed: 3000,
      });
      await page.waitForTimeout(500);
      expect(await pageY()).toBe(before);
    }
  } else {
    // The wheel (a trackpad sends the same events) down past the end, then up past the top.
    await page.mouse.move(x, y);
    for (const step of [400, -400]) {
      const before = await pageY();
      for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, step);
      await page.waitForTimeout(500);
      expect(await pageY()).toBe(before);
    }
    // The page itself still scrolls with the wheel over it.
    await page.mouse.move(200, 600);
    await page.mouse.wheel(0, 600);
    await expect.poll(pageY).toBeGreaterThan(0);
  }
});
