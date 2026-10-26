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
// from the suggestion dock, shows what's happening now, what the overlay would do and how sure it
// is; the switch turns it on, and the paper account then takes the event's trade by itself, which
// comes up in the trade pop-up as done, with OK and Revert. Simulated money and demo advice only.

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

test("the Events box is on by default: it shows the event, and the paper account takes its trade by itself", async ({
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

  // On by default: the page's run acts on the event at the latest close, by itself.
  const box = page.locator("#events");
  await expect(box).toHaveAttribute("data-events-box", "on");
  await expect(box.getByText("EVENTS", { exact: true })).toBeVisible();
  await expect(box.locator("[data-events-watching]")).toContainText("Watching 6 sources");
  await expect(box.getByText(/its backtest showed no clear edge/i)).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.locator("#events [data-events-plan]")).toHaveText(/^→ Did: \+SMH/, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 60_000 });
  await expect(box.locator("[data-events-now] li")).toHaveCount(1);
  await expect(box.locator("[data-events-confidence]")).toHaveText(/^\d+% sure$/);
  await expect(box.locator("[data-events-open]")).toContainText(/SMH|NVDA/);
  await expect(box.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  // Not in the suggestion dock.
  await expect(page.locator("[data-card-dock] #events")).toHaveCount(0);
  const toggle = box.getByRole("switch", { name: "Events overlay" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  // The paper account holds it, and its log says why.
  await page
    .locator("#paper")
    .getByText(/^Trade log/)
    .click();
  await expect(
    page
      .locator("[data-paper-trades] li")
      .filter({ hasText: "Bought" })
      .filter({ hasText: /SMH|NVDA/ }),
  ).toHaveCount(1);
  await expect(page.locator("[data-paper-trades]")).toContainText("A chip boom");

  // The trade pop-up says it was done, once: OK puts it away.
  const popup = page.getByRole("complementary", { name: "Trade alert" });
  await expect(popup).toBeVisible();
  await expect(popup.getByText("[TRADE] EVENTS · DONE FOR YOU")).toBeVisible();
  await expect(popup.locator("[data-trade-headline]")).toHaveText(
    /^\[✓\] Events: added [\d.]+% in (SMH|NVDA)$/,
  );
  await popup.getByRole("button", { name: "OK" }).click();
  await expect(popup).toHaveCount(0);

  // The switch turns it off, and back on.
  await toggle.click();
  await expect(box).toHaveAttribute("data-events-box", "off", { timeout: 30_000 });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(box).toHaveAttribute("data-events-box", "on", { timeout: 30_000 });
});

test("the Events box is never empty: what it watches, and what happened or that nothing did", async ({
  page,
  baseURL,
}) => {
  await signIn(page, baseURL);
  await page.goto("/investments");
  await page.locator("#paper").getByRole("button", { name: "Start paper account" }).click();
  await expect(page.locator("#paper")).toHaveAttribute("data-paper-account", "running", {
    timeout: 60_000,
  });
  const box = page.locator("#events");
  await expect(box.locator("[data-events-watching]")).toHaveText(
    /^Watching 6 sources · (last checked .* UTC|first check under way)/,
  );
  // Either the events of the last five days, or a plain line that nothing big happened.
  await expect(box.locator("[data-events-now]")).toBeVisible();
  await expect(box.locator("[data-events-now]")).not.toHaveText("");
  // The track record is a tap away.
  await expect(box.locator("[data-events-record]")).toHaveCount(1);
});
