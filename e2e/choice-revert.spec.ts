import { expect, test } from "@playwright/test";
import { walkToCard } from "./card-walk";
import { E2E_DATABASE_URL, addJaneMessage, autopilotLevel, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// A choice is instant and stays (founder, 2026-10-25: "when you click on it, the button is not
// instant, it should be instant. It should also not just remove the options, just grey them out,
// and there should be a revert button"): tapping one of "how much Jane should handle" marks it
// at once, greys the others, saves the level behind, and Revert puts the previous level back.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const HEADLINE = "How much should I handle on my own?";
const LABELS = ["Handle the safe stuff", "Handle everything allowed", "Ask me first"];

test("a choice shows at once, greys the others, and Revert puts the previous level back", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  userId = await demoPerson(context, page, baseURL);
  const before = await autopilotLevel(userId);
  await addJaneMessage(userId, {
    kind: "decision",
    body: `${HEADLINE}\nI can do the safe things myself, or everything you allow, or ask first.`,
    refs: {},
    actions: [
      { id: "autopilot.safe", label: LABELS[0], kind: "primary" },
      { id: "autopilot.all", label: LABELS[1], kind: "secondary" },
      { id: "autopilot.ask", label: LABELS[2], kind: "secondary" },
    ],
  });
  await page.setViewportSize(isMobile ? { width: 375, height: 812 } : { width: 1440, height: 900 });
  const docked = !isMobile;
  const scope = docked
    ? page.getByRole("complementary", { name: "Chat with Jane" }).locator("[data-card-dock]")
    : page.locator('.floating-cards[data-floating-cards="queue"]');
  const openHome = async () => {
    await page.goto("/home");
    if (isMobile) await page.locator('[data-card-state="folded"]').click({ timeout: 60_000 });
    return scope;
  };
  const card = await walkToCard(page, openHome, HEADLINE, { docked });

  // Chosen: marked within 150 ms, the others still there, greyed and off, and Revert.
  const started = Date.now();
  await card.getByRole("button", { name: LABELS[1] }).click();
  const chosen = card.locator("[data-card-chosen]");
  await expect(chosen).toBeVisible({ timeout: 150 });
  expect(Date.now() - started).toBeLessThan(1_000);
  await expect(chosen.getByRole("button", { name: /Handle everything allowed/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(chosen.getByText("[✓ chosen]")).toBeVisible();
  for (const other of [LABELS[0], LABELS[2]]) {
    const button = chosen.getByRole("button", { name: other, exact: true });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
  }
  // Saved behind the screen.
  await expect.poll(() => autopilotLevel(userId!), { timeout: 30_000 }).toBe("all");

  // Revert: the choices open again at once, and the previous level is back.
  const reverting = Date.now();
  await chosen.getByRole("button", { name: /Revert/ }).click();
  await expect(card.getByRole("button", { name: LABELS[1], exact: true })).toBeEnabled({
    timeout: 150,
  });
  expect(Date.now() - reverting).toBeLessThan(1_000);
  await expect(card.locator("[data-card-chosen]")).toHaveCount(0);
  await expect.poll(() => autopilotLevel(userId!), { timeout: 30_000 }).toBe(before);

  // And it can be chosen again (the dock may have reloaded its cards meanwhile: find it again).
  const again = await walkToCard(page, async (n) => (n ? openHome() : scope), HEADLINE, {
    docked,
  });
  await again.getByRole("button", { name: LABELS[2], exact: true }).click();
  await expect(again.locator("[data-card-chosen]")).toBeVisible({ timeout: 150 });
  await expect.poll(() => autopilotLevel(userId!), { timeout: 30_000 }).toBe("ask");
});
