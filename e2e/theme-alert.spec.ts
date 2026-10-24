import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, addThemeIdea, deleteUser, signedInUser } from "./db";

// A news theme's alert (Phase AW, Stage A): when the practice scan finds a theme idea, Jane puts
// it in the chat as a card with why now, how sure she is, the risk and when it gets out, and Yes
// and No. A sample person gets the card only. Practice money and demo advice only.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("a theme idea comes to the chat as a card to decide", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await expect(page).toHaveURL("/chat", { timeout: 60_000 });
  // The portfolio starts by itself during the first scan.
  await expect(async () => {
    await page.goto("/investments/practice");
    await expect(page.getByText(/^Bought /).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 120_000 });

  await addThemeIdea(user.userId);
  // Opening a practice page runs the light scan, which posts the alert.
  await page.goto("/investments/practice");
  await expect(async () => {
    await page.goto("/chat");
    await expect(page.getByText(/News theme: Try \$400 of ITA/).first()).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 60_000 });
  const card = page
    .getByRole("list", { name: "Messages" })
    .getByRole("listitem")
    .filter({ hasText: "News theme: Try $400 of ITA" })
    .last();
  await expect(card.getByText(/67% sure/)).toBeVisible();
  await expect(card.getByText(/Out after 20 trading days/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Yes, in practice" })).toBeVisible();
  await expect(card.getByRole("button", { name: "No", exact: true })).toBeVisible();
});
