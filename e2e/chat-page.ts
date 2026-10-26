import { expect, type Locator, type Page } from "@playwright/test";

// The chat has no page of its own: /chat opens Home with the side chat open, and Try Jane and
// linking a bank land on Home. The tests that talk to Jane open its chat by itself, as the
// side panel shows it (/chat?embed=1).
export const CHAT = "/chat?embed=1";

// After linking a bank or trying Jane: Home, then the chat.
export async function landInChat(page: Page, timeout = 60_000) {
  await expect(page).toHaveURL(/\/home(\?|$)/, { timeout });
  await page.goto(CHAT);
}

// Jane's answer to what was just typed, found by its own words (every part given): one of its
// own messages, or the result of a tap just before, may land after it, so never "the last
// message". It can take a while on a cold dev server (the answer, then the chat's refresh); a
// failure says what Jane's newest messages said instead.
export async function answerTo(page: Page, ...words: string[]): Promise<Locator> {
  const messages = page.getByRole("list", { name: "Messages" }).getByRole("listitem");
  let found = messages;
  for (const w of words) found = found.filter({ hasText: w });
  try {
    await expect(found.last()).toBeVisible({ timeout: 45_000 });
  } catch (error) {
    const newest = (await messages.allInnerTexts()).slice(-3).map((t) => t.slice(0, 160));
    throw new Error(
      `No answer with ${JSON.stringify(words)}; the newest messages: ${JSON.stringify(newest)}`,
      { cause: error },
    );
  }
  return found.last();
}

// Jane's pop-ups (src/lib/jane-agent/popups.ts): anything it brings up that waits on the
// person floats as a card, not in the chat's list. The card showing, once it's the one with
// this headline (the arrow keys step through the stack), or a failure if it never comes.
export async function popupCard(page: Page, headline: RegExp, timeout = 30_000) {
  const overlay = page.getByRole("region", { name: "Suggestions for you" });
  const showing = overlay.locator('[data-card-state="showing"]');
  const title = showing.getByRole("heading", { level: 3 });
  await expect(overlay).toBeVisible({ timeout });
  await expect(async () => {
    // The cards ignore the arrow keys while someone is typing: out of the message box first
    // (a phone can hold focus there).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 12; i += 1) {
      if (headline.test(((await title.textContent({ timeout: 2_000 })) ?? "").trim())) return;
      await page.keyboard.press("ArrowRight");
    }
    for (let i = 0; i < 12; i += 1) {
      if (headline.test(((await title.textContent({ timeout: 2_000 })) ?? "").trim())) return;
      await page.keyboard.press("ArrowLeft");
    }
    throw new Error(`No card "${headline}"`);
  }).toPass({ timeout });
  return showing;
}
