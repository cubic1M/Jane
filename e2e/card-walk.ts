import { expect, type Locator, type Page } from "@playwright/test";

// Steps a card stack (the dock above the chat, or the floating queue) to the card with this
// headline. While it settles the dock reloads its cards (the chat behind catching up after a
// scan) and keeps the card on screen in place, so the counter can jump and a walk step past the
// one it wants: each step waits until it has landed, and a walk that reaches the end without the
// card opens the stack again (`open(attempt)`, settled by then) and walks once more.
export async function walkToCard(
  page: Page,
  open: (attempt: number) => Promise<Locator>,
  headline: string,
  { docked }: { docked: boolean },
): Promise<Locator> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const scope = await open(attempt);
    const showing = scope.locator('[data-card-state="showing"]');
    const heading = showing.getByRole("heading", { level: 3 });
    await expect(showing).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 30; i += 1) {
      const now = ((await heading.textContent()) ?? "").trim();
      if (now === headline) return showing;
      if (docked) await scope.getByRole("button", { name: "Next suggestion" }).click();
      else await page.keyboard.press("ArrowRight");
      // No next card: the end of the stack.
      const moved = await expect(heading)
        .not.toHaveText(now, { timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
      if (!moved) break;
    }
  }
  throw new Error(`The card "${headline}" never came up`);
}
