import { expect, test } from "@playwright/test";
import { CHAT, landInChat } from "./chat-page";
import { E2E_DATABASE_URL, addThemeIdea, deleteUser, signedInUser } from "./db";

// A news theme's alert (Phase AW, Stage A): when the practice scan finds a theme idea, Jane puts
// it in the chat (the side panel's, /chat?embed=1) as a floating card: the headline, Yes and Not
// now, and behind More details why now, how sure she is, the risk and when it gets out. A sample
// person gets the card only. Practice money and demo advice only.

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
  await landInChat(page);
  // The portfolio starts by itself during the first scan.
  await expect(async () => {
    await page.goto("/investments/practice");
    await expect(page.getByText(/^Bought /).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 120_000 });

  // A theme idea for today (the scan may also find its own from the sample news; either one is
  // the day's alert).
  await addThemeIdea(user.userId);
  // Opening a practice page runs the light scan, which posts the alert as a suggestion: it
  // floats over the chat with the day's other suggestions, one card at a time.
  await page.goto("/investments/practice");
  const theme = /^News theme: Try \$[\d,]+ of [A-Z]+ in practice$/;
  const overlay = page.getByRole("region", { name: "Suggestions for you" });
  const showing = overlay.locator('[data-card-state="showing"]');
  const headline = showing.getByRole("heading", { level: 3 });
  await expect(async () => {
    await page.goto(CHAT);
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    for (let i = 0; i < 8; i += 1) {
      if (theme.test(((await headline.textContent({ timeout: 2_000 })) ?? "").trim())) return;
      await showing.getByRole("button", { name: "Not now", exact: true }).first().click();
    }
    throw new Error("No news theme card yet");
  }).toPass({ timeout: 90_000 });
  await expect(headline).toHaveText(theme);
  await expect(showing.getByRole("button", { name: "Yes", exact: true })).toBeVisible();
  // More details: how sure Jane is, when it gets out, and the demo advice label.
  await showing.getByRole("button", { name: "More details" }).click();
  const details = showing.locator('[id^="details-"]');
  await expect(details.getByText(/\d+% sure/).first()).toBeVisible();
  await expect(details.getByText(/Out after 20 trading days/).first()).toBeVisible();
  await expect(
    details.getByText(/Demo advice: sample data, not financial advice/).first(),
  ).toBeVisible();
});
