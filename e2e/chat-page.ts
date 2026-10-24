import { expect, type Page } from "@playwright/test";

// The chat has no page of its own: /chat opens Home with the side chat open, and Try Jane and
// linking a bank land on Home. The tests that talk to Jane open her chat by itself, as the
// side panel shows it (/chat?embed=1).
export const CHAT = "/chat?embed=1";

// After linking a bank or trying Jane: Home, then the chat.
export async function landInChat(page: Page, timeout = 60_000) {
  await expect(page).toHaveURL(/\/home(\?|$)/, { timeout });
  await page.goto(CHAT);
}
