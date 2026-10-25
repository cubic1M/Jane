import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// The side chat's layout (founder: "I want the chat to be exactly at the bottom right corner,
// where the place to type is fixed at the bottom right, and not leaving a blank space down
// below"): on a computer the message box is at the very bottom of the panel at any window size;
// the card dock above the chat steps between suggestions from its own header line, keeping a
// card's details open; on a phone the sheet always has the message box, above any card.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const FRAME = 'iframe[title="Chat with Jane"]';

test("on a computer the message box sits at the very bottom of the panel", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(isMobile, "the phone's sheet is checked below");
  userId = await demoPerson(context, page, baseURL);
  // 1152 x 720 is 1440 x 900 zoomed to 125%.
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 1152, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/home");
    const box = page.frameLocator(FRAME).getByRole("textbox", { name: "Message Jane" });
    await expect(box).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(
        async () => {
          const frame = (await page.locator(FRAME).boundingBox())!;
          const input = (await box.boundingBox())!;
          return Math.round(frame.y + frame.height - (input.y + input.height));
        },
        { message: `${size.width}x${size.height}` },
      )
      .toBeLessThanOrEqual(20);
    const frame = (await page.locator(FRAME).boundingBox())!;
    expect(Math.round(frame.y + frame.height)).toBe(size.height);
  }
});

test("the dock steps between suggestions from its header, details staying open", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(isMobile, "the dock is on a computer");
  await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");
  const dock = page.locator("[data-card-dock]");
  const header = dock.locator("[data-dock-header]");
  await expect(header).toHaveText(/^JANE · 1 of (\d+) suggestions/, { timeout: 60_000 });
  const total = Number(/of (\d+)/.exec((await header.textContent()) ?? "")![1]);
  test.skip(total < 3, "needs a few suggestions");
  const showing = dock.locator('[data-card-state="showing"]');
  const headline = showing.getByRole("heading", { level: 3 });

  // Opened, then next: the dock stays, the next card comes in opened, every choice in view.
  await showing.getByRole("button", { name: "More details" }).click();
  const first = (await headline.textContent()) ?? "";
  await dock.getByRole("button", { name: "Next suggestion" }).click();
  await expect(header).toContainText(`2 of ${total} suggestions`);
  await expect(headline).not.toHaveText(first);
  await expect(dock).toBeVisible();
  await expect(showing.getByRole("button", { name: "More details" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(showing.locator('[id^="details-"]')).toBeVisible();
  const card = (await showing.boundingBox())!;
  for (const button of await showing.locator("[data-card-actions] button").all()) {
    await expect(button).toBeVisible();
    const b = (await button.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(card.x + card.width + 1);
  }

  // The arrow keys on a card's own button do nothing; on the header they step.
  const second = (await headline.textContent()) ?? "";
  await showing.locator("[data-card-actions] button").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(headline).toHaveText(second);
  await header.focus();
  await page.keyboard.press("ArrowRight");
  await expect(header).toContainText(`3 of ${total} suggestions`);
  await page.keyboard.press("ArrowLeft");
  await expect(headline).toHaveText(second);
});

test("on a phone the sheet always has the message box: type, send, see it", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "the phone's sheet");
  userId = await demoPerson(context, page, baseURL);
  for (const [i, size] of [
    { width: 375, height: 812 },
    { width: 412, height: 880 },
  ].entries()) {
    await page.setViewportSize(size);
    await page.goto("/home");
    await page.getByRole("button", { name: /^Chat with Jane/ }).click();
    const chat = page.frameLocator(FRAME);
    const box = chat.getByRole("textbox", { name: "Message Jane" });
    await expect(box).toBeVisible({ timeout: 60_000 });
    // In view, at the bottom of the sheet, and no card over it.
    const input = (await box.boundingBox())!;
    expect(input.y + input.height).toBeLessThanOrEqual(size.height);
    const sheet = (await page.getByRole("dialog", { name: "Chat with Jane" }).boundingBox())!;
    expect(sheet.y + sheet.height - (input.y + input.height)).toBeLessThanOrEqual(24);
    const card = chat.locator('[data-card-state="showing"]');
    if ((await card.count()) > 0 && (await card.isVisible())) {
      const c = (await card.boundingBox())!;
      expect(c.y + c.height).toBeLessThanOrEqual(input.y);
    }
    const question = `How much is safe to spend? (${i + 1})`;
    await box.fill(question);
    await box.press("Enter");
    await expect(chat.getByText(question).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Close chat" }).click();
  }
});
