import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, it, vi } from "vitest";
import { PEOPLE } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { formatProof, proveOn, type PersonProof } from "./proof";

// `npm run checks:proof` (spec step 266): walks the eight sample people through their top
// suggestions and the chat, and writes docs/proof-on-every-person.md. Skipped in `npm test`.

const url = process.env.TEST_DATABASE_URL;

it.runIf(process.env.CHAT_PROOF === "1" && url)(
  "walks every sample person through their suggestions and the chat",
  async () => {
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    }
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const now = new Date();
    try {
      const proofs: PersonProof[] = [];
      for (const person of PEOPLE) proofs.push(await proveOn(person, { client, now }));
      const doc = formatProof(proofs, now.toISOString().slice(0, 10));
      writeFileSync("docs/proof-on-every-person.md", `${doc}\n`);
      console.log(doc.split("\n").slice(0, 16).join("\n"));
      expect(proofs).toHaveLength(PEOPLE.length);
    } finally {
      await client.$disconnect();
    }
  },
  20 * 60 * 1000,
);
