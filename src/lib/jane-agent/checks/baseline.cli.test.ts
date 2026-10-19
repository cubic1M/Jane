import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { formatBaseline, measureBaseline } from "./baseline";
import { createCheckPerson, deleteCheckPerson } from "./person";

// `npm run checks:baseline` (spec step 189): how much of the question bank the rules alone
// understand, by sector and page, with no key. Prints the table for docs/chat-quality.md.
// Skipped in `npm test`.

const url = process.env.TEST_DATABASE_URL;

it.runIf(process.env.CHAT_BASELINE === "1" && url)(
  "measures what the rules understand",
  async () => {
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    }
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const now = new Date();
    const userId = await createCheckPerson({ client, now });
    try {
      const started = Date.now();
      const baseline = await measureBaseline(userId, { client, now });
      console.log(formatBaseline(baseline));
      console.log(`Took ${Math.round((Date.now() - started) / 1000)}s.`);
      console.log(
        "NOT UNDERSTOOD:\n" +
          baseline.rows
            .filter((r) => !r.understood)
            .map((r) => `${r.sector}\t${r.text}`)
            .join("\n"),
      );
      expect(baseline.asked).toBeGreaterThanOrEqual(400 - 60);
    } finally {
      await deleteCheckPerson(userId, { client });
      await client.$disconnect();
    }
  },
  5 * 60 * 1000,
);
