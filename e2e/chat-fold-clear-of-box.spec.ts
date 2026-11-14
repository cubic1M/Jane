import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { CHAT } from "./chat-page";
import { demoPerson } from "./demo-person";

// Debugger 11-13, the chat on a phone: after a message the cards fold to one line,
// "[JANE] 11 for you", and it sat on the message box, so a tap on the box's start opened the cards.
// The folded line sits above the box, and the box's start is the box.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const clear = (page: Page) =>
  page.evaluate(() => {
    const fold = document.querySelector('[data-card-state="folded"]')!.getBoundingClientRect();
    const box = document.querySelector("textarea")!.getBoundingClientRect();
    const atStart = document.elementFromPoint(box.left + 12, box.top + box.height / 2);
    return {
      overlaps: !(fold.bottom <= box.top || box.bottom <= fold.top),
      startIsTheBox: atStart?.closest("textarea, [data-chat-composer]") !== null,
    };
  });

test("on a phone, the folded card line sits above the message box", async ({
  context,
  page,
  baseURL,
}) => {
  userId = await demoPerson(context, page, baseURL);
  await page.goto(CHAT);
  const overlay = page.getByRole("region", { name: "Suggestions for you" });
  await expect(overlay.locator('[data-card-state="showing"]')).toBeVisible({ timeout: 60_000 });

  const ask = page.getByRole("textbox", { name: "Message Jane" });
  await ask.fill("safe to spend");
  await ask.press("Enter");
  await expect(overlay.locator('[data-card-state="folded"]')).toBeVisible();

  expect(await clear(page)).toEqual({ overlaps: false, startIsTheBox: true });
});
