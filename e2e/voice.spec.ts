import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Spec step 186: talk to Jane. The browser's speech recognition and speech are stand-ins
// here (a real one needs a microphone): the microphone works from the keyboard, what was
// heard fills the message box, the person sends it like anything typed (only that text
// leaves the page), and Read aloud speaks an answer.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// A stand-in SpeechRecognition the test can make "hear" words, and a speechSynthesis that
// writes down what it was asked to say.
const STANDINS = () => {
  const w = window as unknown as Record<string, unknown>;
  const spoken: string[] = [];
  w.__spoken = spoken;
  class FakeRecognition {
    lang = "";
    interimResults = false;
    continuous = false;
    maxAlternatives = 1;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      w.__recognition = this;
    }
    stop() {
      this.onend?.();
    }
    abort() {
      this.onend?.();
    }
  }
  w.SpeechRecognition = FakeRecognition;
  w.webkitSpeechRecognition = FakeRecognition;
  w.__hear = (text: string) => {
    const r = w.__recognition as FakeRecognition;
    const phrase = Object.assign([{ transcript: text }], { isFinal: true });
    r.onresult?.({ results: [phrase] });
    r.onend?.();
  };
  Object.defineProperty(window, "speechSynthesis", {
    value: {
      speak: (u: { text: string; onend?: () => void }) => {
        spoken.push(u.text);
      },
      cancel: () => {},
    },
  });
  w.SpeechSynthesisUtterance = class {
    lang = "";
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  };
};

test("speak a question with the keyboard, send it, and hear the answer", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.addInitScript(STANDINS);
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/chat/send")) sent.push(r.postData() ?? "");
  });

  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await expect(page).toHaveURL("/chat", { timeout: 60_000 });

  // From the message box, Tab reaches the microphone; Enter starts listening.
  const ask = page.getByRole("textbox", { name: "Message Jane" });
  await ask.focus();
  await page.keyboard.press("Tab");
  const mic = page.getByRole("button", { name: "Speak your message" });
  await expect(mic).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Stop listening" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("status").filter({ hasText: "Listening…" })).toBeVisible();

  // What it heard fills the box, to check before sending.
  await page.evaluate(() =>
    (window as unknown as { __hear: (t: string) => void }).__hear("safe to spend"),
  );
  await expect(ask).toHaveValue("safe to spend");
  await expect(ask).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Check the words" })).toBeVisible();
  expect(sent).toEqual([]);

  // Sent like anything typed: the same rules answer it, and only the text left the page.
  await ask.press("Enter");
  const messages = page.getByRole("list", { name: "Messages" }).getByRole("listitem");
  await expect(messages.last()).toContainText(/You have \$[\d,]+\.\d\d safe to spend/);
  expect(sent.map((body) => JSON.parse(body))).toEqual([{ message: "safe to spend" }]);

  // Read aloud, on request.
  await messages.last().getByRole("button", { name: "Read aloud" }).click();
  const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
  expect(spoken.at(-1)).toMatch(/^You have \$[\d,]+\.\d\d safe to spend/);
});

test("no microphone or Read aloud where the browser can't do them", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.addInitScript(() => {
    for (const name of ["webkitSpeechRecognition", "SpeechRecognition", "speechSynthesis"])
      Object.defineProperty(window, name, { value: undefined, configurable: true });
  });
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await expect(page).toHaveURL("/chat", { timeout: 60_000 });
  await expect(page.getByRole("textbox", { name: "Message Jane" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Speak your message" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Read aloud" })).toHaveCount(0);
});
