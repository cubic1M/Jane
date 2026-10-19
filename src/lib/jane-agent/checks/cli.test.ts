import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// Everything, the app's own default database client included, uses the scratch database:
// never the one in .env.
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { createCheckPerson, deleteCheckPerson } from "./person";
import { runAnswerChecks } from "./run";
import { compareRuns, formatRun, previousRun, saveRun } from "./store";

// `npm run checks:answers`: one run of Jane's answer checks (spec step 87) against the
// scratch database in TEST_DATABASE_URL, saved and compared with the last run. With
// ANTHROPIC_API_KEY set it's a full run (free questions and Claude's grades, within the
// spending cap); without, the rules questions and fixed checks only. Skipped in `npm test`.

const url = process.env.TEST_DATABASE_URL;

it.runIf(process.env.ANSWER_CHECKS === "1" && url)(
  "runs Jane's answer checks",
  async () => {
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    }
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const now = new Date();
    const userId = await createCheckPerson({ client, now });
    try {
      const run = await runAnswerChecks(userId, { client, now });
      const before = await previousRun({ client }, run.mode, new Date());
      await saveRun(run, { client });
      console.log(formatRun(run, before && compareRuns(before, run)));
      expect(run.results.length).toBeGreaterThan(0);
    } finally {
      await deleteCheckPerson(userId, { client });
      await client.$disconnect();
    }
  },
  30 * 60 * 1000,
);
