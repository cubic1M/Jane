import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { appendEntry, dropOf, entryOf, withNightlyTable, type NightEntry } from "./history";
import { createCheckPerson, deleteCheckPerson } from "./person";
import { runAnswerChecks } from "./run";

// `npm run checks:nightly` (spec step 195), run by .github/workflows/chat-quality.yml: one
// night's run of the bank against the scratch database in TEST_DATABASE_URL: the rules
// questions always, and with ANTHROPIC_API_KEY a rotating share of the Claude ones within a
// small cap. It records the night in docs/chat-quality-history.json and the table in
// docs/chat-quality.md, and writes chat-quality-drop.txt when a score fell. Skipped in
// `npm test`.

const url = process.env.TEST_DATABASE_URL;
const HISTORY = "docs/chat-quality-history.json";
const DOC = "docs/chat-quality.md";
const DAY_MS = 86_400_000;
// Conversations of Claude questions asked a night, and the most a night may spend, in cents.
const PER_NIGHT = Number(process.env.CHAT_NIGHTLY_COUNT ?? 20);
const CAP_CENTS = Number(process.env.CHAT_NIGHTLY_CAP_CENTS ?? 15);

it.runIf(process.env.CHAT_NIGHTLY === "1" && url)(
  "runs the bank for the night",
  async () => {
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    }
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const now = new Date();
    const userId = await createCheckPerson({ client, now });
    try {
      const run = await runAnswerChecks(userId, {
        client,
        now,
        capCents: CAP_CENTS,
        rotate: { day: Math.floor(now.getTime() / DAY_MS), count: PER_NIGHT },
      });
      const entry: NightEntry = entryOf(run, now.toISOString().slice(0, 10));
      const history: NightEntry[] = existsSync(HISTORY)
        ? JSON.parse(readFileSync(HISTORY, "utf8"))
        : [];
      const drop = dropOf(history, entry);
      const next = appendEntry(history, entry);
      writeFileSync(HISTORY, `${JSON.stringify(next, null, 2)}\n`);
      writeFileSync(DOC, withNightlyTable(readFileSync(DOC, "utf8"), next));
      if (drop) {
        const failing = entry.failed.map((f) => `- ${f.id} (${f.score}): ${f.text}`).join("\n");
        writeFileSync("chat-quality-drop.txt", `${drop}\n\nQuestions under 80:\n${failing}\n`);
      }
      console.log(JSON.stringify({ ...entry, failed: entry.failed.length, drop }, null, 2));
      expect(run.results.length).toBeGreaterThan(0);
    } finally {
      await deleteCheckPerson(userId, { client });
      await client.$disconnect();
    }
  },
  30 * 60 * 1000,
);
