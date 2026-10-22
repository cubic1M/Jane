import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Founder bug: "every time I type a question, it duplicates, then disappears." From the
// moment a typed question shows, it is on the page exactly once until the answer is in, and
// it is still there once, with the answer, afterwards.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("a typed question shows once and stays", async ({ context, page, baseURL }) => {
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

  const question = "what is my safe to spend";
  // Count the bubbles with exactly the question on every change to the page.
  await page.evaluate((text) => {
    const w = window as unknown as { __counts: number[] };
    w.__counts = [];
    const count = () =>
      [...document.querySelectorAll("p")].filter((p) => p.textContent?.trim() === text).length;
    new MutationObserver(() => {
      const n = count();
      if (w.__counts[w.__counts.length - 1] !== n) w.__counts.push(n);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, question);

  // A slow answer: the question is already stored while the reply is still being written,
  // and a refresh of the page (the scan's, a tap's) lands in that gap.
  await page.route("**/api/chat/send", async (route) => {
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 3000));
    await route.fulfill({ response });
  });
  const ask = page.getByRole("textbox", { name: "Message Jane" });
  await ask.fill(question);
  await ask.press("Enter");
  await page.waitForTimeout(800);
  await page.evaluate(() =>
    (window as unknown as { next: { router: { refresh: () => void } } }).next.router.refresh(),
  );
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);

  const counts = await page.evaluate(() => (window as unknown as { __counts: number[] }).__counts);
  // Never twice, and never gone once it showed; it ends as one.
  expect(Math.max(...counts), JSON.stringify(counts)).toBe(1);
  const firstShown = counts.indexOf(1);
  expect(counts.slice(firstShown).includes(0), JSON.stringify(counts)).toBe(false);
  expect(counts[counts.length - 1]).toBe(1);
});
