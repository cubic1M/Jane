import { expect, test } from "@playwright/test";
import {
  E2E_DATABASE_URL,
  addFoundMoney,
  deleteShareInvite,
  deleteUser,
  shareInvite,
  signedInUser,
} from "./db";

// The shareable result card: after the report's findings, Share shows the card as friends will
// see it (the rounded total, nothing else), then the share sheet on a phone or the link copied
// on a computer. The link lands on the invite page, one line and one button, and that goes to
// sign-up with the invite code filled in. Sent and opened are counted.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) {
    await deleteShareInvite(userId);
    await deleteUser(userId);
  }
  userId = undefined;
});

test("share the result card, open the invite, land on sign-up with the code", async ({
  page,
  browser,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await addFoundMoney(user.userId);
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  // Stand-ins for the share sheet and the clipboard, which record what they were given.
  await page.addInitScript(() => {
    const w = window as unknown as { sent: unknown[] };
    w.sent = [];
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: unknown) => void w.sent.push(data),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void w.sent.push(text) },
    });
  });

  await page.goto("/report");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("We found $1,234.56 a year");
  await page.getByRole("button", { name: "Share", exact: true }).click();

  // The preview: the card friends will see, rounded, and what goes out with it.
  const share = page.locator('[data-share="open"]');
  const card = share.getByRole("img", { name: "Jane found me $1,200/yr" });
  await expect(card).toBeVisible();
  await expect(card).toHaveJSProperty("complete", true);
  expect(await card.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1200);
  await expect(share).toContainText("No accounts, merchants, balances or names.");
  await expect(share).not.toContainText("Chase");

  const send = share.locator("[data-share-link]");
  await expect(send).toBeEnabled();
  const link = await send.getAttribute("data-share-link");
  expect(link).toMatch(/\/join\/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await send.click();
  await expect(share.getByRole("status")).toHaveText(
    /^(Shared\.|Link copied\. Paste it to a friend\.)$/,
  );
  const sent = await page.evaluate(() => (window as unknown as { sent: unknown[] }).sent);
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent[0])).toContain(link!);

  // A friend, signed out, opens the link.
  const friend = await browser.newContext();
  const friendPage = await friend.newPage();
  await friendPage.goto(link!);
  await expect(friendPage.getByRole("heading", { level: 1 })).toHaveText(
    "Jane reads your bank accounts and finds the money you're losing.",
  );
  await expect(friendPage.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /\/api\/share\/card\?kind=found&value=1200$/,
  );
  await friendPage.getByRole("link", { name: "Join the beta" }).click();
  await expect(friendPage).toHaveURL(/\/signup\?invite=/);
  const code = link!.split("/join/")[1];
  await expect(friendPage.getByLabel("Invite code")).toHaveValue(code);
  await friend.close();

  // Counted: sent once, opened once.
  await expect
    .poll(async () => shareInvite(user.userId))
    .toEqual({ code, card: "found:1200", sent: 1, opened: 1 });
});
