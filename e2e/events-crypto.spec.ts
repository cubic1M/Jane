import { expect, test, type Page } from "@playwright/test";
import {
  E2E_DATABASE_URL,
  addCryptoEvents,
  deleteMarketEvent,
  seedCryptoRecord,
  deleteUser,
  signedInUser,
  treatAsDemoBank,
} from "./db";

// The events layer on the 24-hour agent's crypto strategies (founder, 2026-10-26): crypto events
// (here a liquidation cascade and a stablecoin losing its peg, public a few hours ago) reach a crypto
// day-trading account as the agent's own signals, so its catch-up takes the event's trade at the
// next bar after the event was public, with the event's reason. The Events box shows the crypto
// events. Sample bars (PAPER_SAMPLE_PRICES=1); simulated money and demo advice only.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(150_000);

let userId: string | undefined;
let keys: string[] = [];
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  for (const k of keys) await deleteMarketEvent(k);
  keys = [];
});

async function signIn(page: Page, baseURL: string | undefined) {
  const user = await signedInUser("user");
  userId = user.userId;
  await treatAsDemoBank(user.userId);
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
}

test("a crypto day-trading account takes a crypto event's trade on its catch-up", async ({
  page,
  baseURL,
}) => {
  await signIn(page, baseURL);
  keys = await addCryptoEvents();
  await page.goto("/investments");
  const paper = page.locator("#paper");
  await paper.getByRole("button", { name: "Start paper account" }).click();
  await expect(paper).toHaveAttribute("data-paper-account", "running", { timeout: 60_000 });
  await seedCryptoRecord(userId!);

  // Bitcoin and ether, every 15 minutes: it catches up on the last day at once.
  const agent = page.getByRole("region", { name: "24-hour agent" });
  await agent.getByLabel("Bitcoin and ether, around the clock").check();
  await agent.getByLabel("15 minutes").check();
  await agent
    .getByLabel("Strategy for the 24-hour agent")
    .selectOption("catalog:vol_target@BTC/USD");
  await agent.getByRole("button", { name: "Start the 24-hour agent" }).click();
  await expect(agent.getByText(/Caught up to the bar at .* ET\./)).toBeVisible({
    timeout: 60_000,
  });

  // Among its trades, the events layer's: bitcoin, with the event's reason.
  const rows = agent
    .getByRole("table", { name: "The 24-hour agent's trades" })
    .locator("tbody tr")
    .filter({ hasText: /A (crypto liquidation cascade|stablecoin loses its peg)/ });
  await expect(rows.first()).toBeVisible();
  await expect(rows.first()).toContainText(/(Bought|Sold) [\d.]+ (BTC|ETH)/);

  // The Events box shows the crypto events, on by default, with how sure.
  const box = page.locator("#events");
  await expect(box).toHaveAttribute("data-events-box", "on");
  await expect(box.locator("[data-events-now]")).toContainText(
    /A (crypto liquidation cascade|stablecoin loses its peg)/,
  );
  await expect(box.locator("[data-events-confidence]").first()).toHaveText(/^\d+% sure$/);
  await expect(box.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
});
