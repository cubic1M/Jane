import { spawn, type ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import {
  ACCOUNT_NUMBER_MARKER,
  FakeRobinhood,
} from "../src/lib/robinhood/__fixtures__/fake-robinhood";
import { E2E_AUTH_SECRET, E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Connect and disconnect through a real browser, against a fake Robinhood. The switch is off for the
// suite's own server, and nothing turns it on anywhere, so this starts a second server of the same
// production build with ROBINHOOD_LINK=1, just for itself.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.skip(process.env.E2E_PROD !== "1", "needs a production build to start its own server");
test.setTimeout(180_000);
// One server of its own, on one port, for the whole file: never two workers at once.
test.describe.configure({ mode: "serial" });

const PORT = Number(process.env.E2E_ROBINHOOD_PORT ?? 3197);
const BASE = `http://localhost:${PORT}`;

function appLogin(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.username = "jane_app";
  url.password = "jane_app_local_only";
  return url.toString();
}

async function waitFor(check: () => Promise<boolean>, what: string) {
  for (let i = 0; i < 240; i += 1) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

test.describe("the Robinhood connection", () => {
  let fake: FakeRobinhood;
  let server: ChildProcess;
  let userId: string | undefined;

  test.beforeAll(async ({}, info) => {
    test.skip(info.project.name !== "chromium", "one browser is enough: it starts its own server");
    fake = await new FakeRobinhood().start();
    server = spawn("npx", ["next", "start", "-p", String(PORT)], {
      stdio: "ignore",
      detached: true,
      env: {
        ...process.env,
        ROBINHOOD_LINK: "1",
        ROBINHOOD_MCP_URL: fake.mcpUrl,
        DATABASE_URL: appLogin(E2E_DATABASE_URL ?? ""),
        DIRECT_URL: E2E_DATABASE_URL,
        AUTH_SECRET: E2E_AUTH_SECRET,
        AUTH_URL: BASE,
        AUTH_TRUST_HOST: "true",
        TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
        ANTHROPIC_API_KEY: "",
        CHAT_FAKE_CLAUDE: "1",
        PAPER_SAMPLE_PRICES: "1",
        EVENTS_REFRESH: "off",
        RESEND_API_KEY: "",
      },
    });
    await waitFor(async () => (await fetch(`${BASE}/api/health`)).status < 500, "the server");
  });

  test.afterAll(async () => {
    if (server?.pid) {
      try {
        process.kill(-server.pid);
      } catch {
        // Already gone.
      }
    }
    await fake?.stop();
  });

  test.afterEach(async () => {
    if (userId) await deleteUser(userId);
    userId = undefined;
  });

  test("connects on Robinhood's page, reads only, shows what it read, and disconnects", async ({
    context,
    page,
  }) => {
    const user = await signedInUser("admin");
    userId = user.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: user.sessionToken, url: BASE },
    ]);

    await page.goto(`${BASE}/investments`);
    const box = page.locator("[data-robinhood]");
    await expect(box).toContainText("sign in on Robinhood's own page");
    await expect(box).toContainText("Jane only reads");
    await expect(box).toContainText("don't open it for Jane");

    await box.getByRole("link", { name: "Connect Robinhood" }).click();
    await page.waitForURL(`${fake.origin}/oauth**`);
    await page.locator("#allow").click();
    await page.waitForURL(`${BASE}/investments?robinhood=connected`);

    await expect(box).toContainText("Robinhood is connected.");
    await expect(box).toContainText("Last updated");
    await expect(box.getByText("Disconnect", { exact: true })).toBeVisible();
    await expect(box.getByRole("link", { name: "Connect Robinhood" })).toHaveCount(0);

    // Read tools only, from a server that offers place_equity_order.
    expect(new Set(fake.toolCalls())).toEqual(
      new Set(["get_accounts", "get_portfolio", "get_equity_positions", "get_equity_orders"]),
    );
    expect(await page.content()).not.toContain(ACCOUNT_NUMBER_MARKER);

    const client = new Client({ connectionString: E2E_DATABASE_URL });
    await client.connect();
    const held = async () =>
      (await client.query("SELECT count(*)::int AS n FROM holdings WHERE user_id = $1", [userId]))
        .rows[0].n as number;
    const connections = async () =>
      (
        await client.query(
          "SELECT count(*)::int AS n FROM robinhood_connections WHERE user_id = $1",
          [userId],
        )
      ).rows[0].n as number;
    try {
      expect(await held()).toBe(3);
      expect(await connections()).toBe(1);

      await box.getByText("Disconnect", { exact: true }).click();
      await box.getByRole("button", { name: "Yes, disconnect" }).click();
      await page.waitForURL(`${BASE}/investments?robinhood=disconnected`);
      await expect(box).toContainText("Jane deleted its access");
      await expect(box.getByRole("link", { name: "Connect Robinhood" })).toBeVisible();
      expect(await held()).toBe(0);
      expect(await connections()).toBe(0);
    } finally {
      await client.end();
    }
  });

  test("saying no on Robinhood's page saves nothing", async ({ context, page }) => {
    const user = await signedInUser("admin");
    userId = user.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: user.sessionToken, url: BASE },
    ]);
    await page.goto(`${BASE}/investments`);
    const box = page.locator("[data-robinhood]");
    await box.getByRole("link", { name: "Connect Robinhood" }).click();
    await page.waitForURL(`${fake.origin}/oauth**`);
    await page.locator("#deny").click();
    await page.waitForURL(`${BASE}/investments?robinhood=not_connected`);
    await expect(box).toContainText("wasn't connected");
    await expect(box.getByRole("link", { name: "Connect Robinhood" })).toBeVisible();
  });

  test("the suite's own server has it off: no button, and the routes answer 404", async ({
    context,
    page,
    baseURL,
    request,
  }) => {
    const user = await signedInUser("admin");
    userId = user.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
    ]);
    await page.goto("/investments");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.locator("[data-robinhood]")).toHaveCount(0);
    expect((await request.get(`${baseURL}/api/robinhood/connect`)).status()).toBe(404);
    expect((await request.post(`${baseURL}/api/robinhood/disconnect`)).status()).toBe(404);
    expect((await request.get(`${baseURL}/api/robinhood/callback?code=x&state=y`)).status()).toBe(
      404,
    );
  });
});
