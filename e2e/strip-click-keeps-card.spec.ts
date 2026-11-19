import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";
import { hydrated } from "./waits";

// Home's cash-flow strip (debugger 11-19, #2096's red runs): a marker's card opens as the pointer
// arrives, and the click that came with it closed the card again. So a click on a marker showed
// nothing, and so did a phone's near tap once the first days' markers crowded the strip's left
// edge (a tap 20 px off one landed on its neighbour). The click keeps the card; a second closes it.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// React has drawn whatever the last click changed.
const settled = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

test("a click on a strip marker keeps its card open, and a second click closes it", async ({
  context,
  page,
  baseURL,
}) => {
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");
  const strip = page.getByRole("group", { name: /^Next 30 days/ });
  await strip.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const mark = strip.locator("button[id^=cash-event-]").last();
  await hydrated(mark);
  const m = (await mark.boundingBox())!;
  const centre = { x: m.x + m.width / 2, y: m.y + m.height / 2 };
  const tip = page.locator("#cash-tip");

  await page.mouse.move(centre.x, centre.y);
  await expect(tip).toBeVisible();
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await expect(tip).toBeVisible();
  await page.mouse.click(centre.x, centre.y);
  await expect(tip).toBeHidden();
});
