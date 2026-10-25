import { expect, test } from "@playwright/test";
import { CHAT, popupCard } from "./chat-page";

// Spec step 138: a visitor tries Jane with sample data, without signing up, and lands in
// Jane's chat as their own sample person. Needs the scratch database (see e2e/db.ts).
test.skip(!process.env.E2E_DATABASE_URL, "needs E2E_DATABASE_URL");

test("'Try it with sample data' opens Jane's chat with a sample person", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Try it with sample data" });
  await expect(button).toBeVisible();
  await page.getByRole("checkbox").check();
  const clicked = Date.now();
  await button.click();

  // Try Jane opens Home, with the chat beside it, saying this is a sample person.
  await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 });
  await expect(page.getByRole("note").filter({ hasText: "sample person" })).toContainText(
    "deleted after a day",
  );
  // While Jane reads the sample person's accounts, a loading bar across the top of the page
  // says how far she's got, and goes when she's done; the chat never says "still going
  // through your accounts" (founder: "remove this one from the chat"). On a fast run the scan
  // may be over before the page is drawn: then there's no bar to see.
  const bar = page.locator("[data-scan-bar]");
  if ((await bar.count()) > 0) {
    await expect(bar).toHaveAttribute("role", "progressbar");
    await expect(bar).toHaveText(/^\[[█░]{16}\] \d{1,3}% · \S/);
  }
  await expect(bar).toHaveCount(0, { timeout: 120_000 });
  const panelChat = page.frameLocator('iframe[title="Chat with Jane"]');
  for (const path of ["/home", "/insurance"]) {
    await page.goto(path);
    await expect(page.getByText(/still (going|looking) through your accounts/)).toHaveCount(0);
    if ((await page.locator('iframe[title="Chat with Jane"]').count()) > 0) {
      await expect(panelChat.getByText(/still (going|looking) through your accounts/)).toHaveCount(
        0,
      );
    }
  }
  // Her chat by itself for the checks below.
  await page.goto(CHAT);
  // Jane's first brief shows on the open page by itself (no reload here) within 25 seconds of
  // the click, as one of her pop-ups: it was in the database long before it showed, once.
  await popupCard(
    page,
    /^Good (morning|afternoon|evening)!/,
    Math.max(1000, 25_000 - (Date.now() - clicked)),
  );

  // The banner's "Sign up" reaches the form to start their own account, not back to the chat.
  await page.goto("/home");
  await page
    .getByRole("note")
    .filter({ hasText: "sample person" })
    .getByRole("link", { name: "Sign up" })
    .click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Email me a sign-up link" })).toBeVisible();
});

// Five fresh visitors in a row (each their own browser and address): every click reaches the
// chat within 8 seconds and shows Jane's first brief, by itself, within 25 seconds of the
// click. One in three clicks once never left the landing page.
test("five tries in a row each reach the chat in 8 seconds and the brief in 25", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  for (let i = 1; i <= 5; i++) {
    const context = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": `10.20.${i}.${Math.floor(Math.random() * 200) + 1}` },
    });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("checkbox").check();
    const clicked = Date.now();
    await page.getByRole("button", { name: "Try it with sample data" }).click();
    await expect(page, `try ${i} reaches Home`).toHaveURL(/\/home$/, { timeout: 8000 });
    await page.goto(CHAT);
    await popupCard(
      page,
      /^Good (morning|afternoon|evening)!/,
      Math.max(1000, 25_000 - (Date.now() - clicked)),
    );
    await context.close();
  }
});
