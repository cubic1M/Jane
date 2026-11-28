import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, signedInUser, waitForFullScan } from "./db";
import { CHAT, landInChat } from "./chat-page";
import { signInWith } from "./session";

// Founder 11-28: "taking way longer to load the chat". Opening the chat shows what is stored at
// once; when Jane owes the person a turn (nothing posted yet today) it runs after the page is sent,
// and what it posts reaches the open page by itself (the pulse, src/app/chat/scan-refresher.tsx),
// with no reload of the page.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

async function owner<T>(work: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

test("the first open of the day gets Jane's turn after the page, without a reload", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(context, user.sessionToken, baseURL);
  await page.goto("/connect");
  await expect(async () => {
    if (page.url().endsWith("/connect")) {
      await page.getByRole("button", { name: "Link a demo bank" }).click({ timeout: 5_000 });
    }
    await landInChat(page, 15_000);
  }).toPass({ timeout: 90_000 });
  await waitForFullScan(user.userId);

  // The first visit may have started a turn of its own: let it finish before the reset below.
  await expect
    .poll(
      () =>
        owner(
          async (c) =>
            (
              await c.query(
                "SELECT value->>'state' AS state FROM jane_preferences WHERE user_id = $1 AND key = 'open_run'",
                [user.userId],
              )
            ).rows[0]?.state ?? "none",
        ),
      { timeout: 120_000, intervals: [1_000] },
    )
    .not.toBe("running");

  // A new day for this person: nothing Jane said, and no turn remembered.
  await owner(async (c) => {
    await c.query("DELETE FROM jane_messages WHERE user_id = $1", [user.userId]);
    await c.query("DELETE FROM jane_preferences WHERE user_id = $1 AND key = 'open_run'", [
      user.userId,
    ]);
  });

  let loads = 0;
  page.on("load", () => (loads += 1));
  const refreshes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/chat") && r.url().includes("_rsc")) refreshes.push(r.url());
  });
  await page.goto(CHAT);
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeAttached();

  // Jane's turn ran after the page was sent: its messages are there...
  await expect
    .poll(
      () =>
        owner(async (c) =>
          Number(
            (
              await c.query("SELECT count(*) AS n FROM jane_messages WHERE user_id = $1", [
                user.userId,
              ])
            ).rows[0].n,
          ),
        ),
      { timeout: 120_000, intervals: [1_000] },
    )
    .toBeGreaterThan(0);
  // ...and the open page picked them up by itself: a soft refresh, and one load of the page only.
  await expect
    .poll(() => refreshes.length, { timeout: 60_000, intervals: [1_000] })
    .toBeGreaterThan(0);
  expect(loads).toBe(1);

  // Opened again the same day, with nothing new: no second turn is started.
  const marker = async () =>
    owner(
      async (c) =>
        (
          await c.query(
            "SELECT value FROM jane_preferences WHERE user_id = $1 AND key = 'open_run'",
            [user.userId],
          )
        ).rows[0]?.value as { state: string; at: string } | undefined,
    );
  await expect.poll(async () => (await marker())?.state, { timeout: 120_000 }).toBe("done");
  const first = await marker();
  await page.goto(CHAT);
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeAttached();
  await page.waitForLoadState("networkidle");
  expect((await marker())?.at).toBe(first?.at);
});
