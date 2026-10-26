import { expect, test, type Page } from "@playwright/test";
import {
  E2E_DATABASE_URL,
  addMarketEvent,
  deleteMarketEvent,
  deleteUser,
  signedInUser,
  treatAsDemoBank,
} from "./db";

// The events overlay (founder, 2026-10-26): its own Events box on the investments page, apart
// from the suggestion dock, shows what's happening now, what the overlay does and how sure it is.
// It is on by default (#792): once the paper account starts, it takes the event's trade by itself,
// which comes up in the trade pop-up as done, with OK. The switch turns it off (open slices stay)
// and back on (no second trade for the same event). Simulated money and demo advice only.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(150_000);

let userId: string | undefined;
let eventKey: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  if (eventKey) await deleteMarketEvent(eventKey);
});

async function signIn(page: Page, baseURL: string | undefined) {
  const user = await signedInUser("user");
  userId = user.userId;
  await treatAsDemoBank(user.userId);
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
}

test("the Events box is on by default, takes the event's trade by itself, and the switch turns it off and on", async ({
  page,
  baseURL,
}) => {
  await signIn(page, baseURL);
  eventKey = await addMarketEvent();
  await page.goto("/investments");
  await page.locator("#paper").getByRole("button", { name: "Start paper account" }).click();
  await expect(page.locator("#paper")).toHaveAttribute("data-paper-account", "running", {
    timeout: 60_000,
  });

  // On from the start: what's happening, how sure, and the switch says on.
  const box = page.locator("#events");
  await expect(box).toHaveAttribute("data-events-box", "on");
  await expect(box.getByText("EVENTS", { exact: true })).toBeVisible();
  await expect(box.getByText(/^On by default/)).toBeVisible();
  await expect(box.locator("[data-events-now] li")).toHaveCount(1);
  await expect(box.getByText("A chip boom", { exact: false }).first()).toBeVisible();
  await expect(box.locator("[data-events-confidence]")).toHaveText(/^\d+% sure$/);
  await expect(box.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  // Not in the suggestion dock.
  await expect(page.locator("[data-card-dock] #events")).toHaveCount(0);
  const toggle = box.getByRole("switch", { name: "Events overlay" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  // It acts by itself after the page is sent: the next view shows the trade it placed.
  await expect(async () => {
    await page.reload();
    await expect(box.locator("[data-events-plan]")).toHaveText(/^→ Did: \+SMH/, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 90_000 });
  await expect(box.locator("[data-events-open]")).toContainText(/SMH|NVDA/);

  // The paper account holds it, and its log says why.
  const bought = page
    .locator("[data-paper-trades] li")
    .filter({ hasText: "Bought" })
    .filter({ hasText: /SMH|NVDA/ });
  await page
    .locator("#paper")
    .getByText(/^Trade log/)
    .click();
  await expect(bought).toHaveCount(1);
  await expect(page.locator("[data-paper-trades]")).toContainText("A chip boom");

  // The trade pop-up says it was done, once: OK puts it away.
  const popup = page.getByRole("complementary", { name: "Trade alert" });
  await expect(popup).toBeVisible();
  await expect(popup.getByText("[TRADE] EVENTS · DONE FOR YOU")).toBeVisible();
  await expect(popup.locator("[data-trade-headline]")).toHaveText(
    /^\[✓\] Events: added [\d.]+% in (SMH|NVDA)$/,
  );
  await expect(popup.getByText(/^\d+% sure$/)).toBeVisible();
  await popup.getByRole("button", { name: "OK" }).click();
  await expect(popup).toHaveCount(0);

  // Off: no new slices, and the open one stays until its exit.
  await toggle.click();
  await expect(box.locator("[data-events-note]")).toHaveText(
    "Off. Open slices stay until their exit; no new ones.",
    { timeout: 30_000 },
  );
  await expect(box).toHaveAttribute("data-events-box", "off", { timeout: 30_000 });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(box.locator("[data-events-open]")).toContainText(/SMH|NVDA/);

  // On again: the same event isn't traded twice.
  await toggle.click();
  await expect(box.locator("[data-events-note]")).toHaveText(/^On\. /, { timeout: 60_000 });
  await expect(box).toHaveAttribute("data-events-box", "on", { timeout: 30_000 });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await page
    .locator("#paper")
    .getByText(/^Trade log/)
    .click();
  await expect(bought).toHaveCount(1);
  await expect(page.getByRole("complementary", { name: "Trade alert" })).toHaveCount(0);
});
