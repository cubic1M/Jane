import type { PlaidApi } from "plaid";
import type { PersonId } from "@/config/people";
import type { PrismaClient } from "@/generated/prisma/client";
import { linkDemoBank } from "@/lib/plaid/demo";
import { saveProfileForm } from "@/lib/investments/profile";
import { syncItem } from "@/lib/plaid/sync";
import { runAutopilot } from "@/lib/practice/autopilot";
import { startPractice } from "@/lib/practice/portfolio";
import { runPracticeDay } from "@/lib/practice/scan";

// The person Jane's answer checks talk to (spec step 87): a new account with the demo bank
// linked and synced, so every run asks over the same kind of data. Never a real person;
// deleted after the run.

// The demo bank never calls Plaid; anything that tried would fail here.
const NO_PLAID = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error("The demo bank must never call Plaid");
    },
  },
) as PlaidApi;

export async function createCheckPerson({
  client,
  now,
  person,
}: {
  client: PrismaClient;
  now: Date;
  // One of the sample lives (src/config/people.ts); the original demo bank without it.
  person?: PersonId;
}): Promise<string> {
  const user = await client.user.create({
    data: { email: `answer-checks-${crypto.randomUUID()}@example.com` },
  });
  const { itemId } = await linkDemoBank(user.id, { client, now, person });
  await syncItem(itemId, { client, api: NO_PLAID, now });
  // Spec step 137: a finished investor profile, so investment questions get full answers.
  await saveProfileForm(
    user.id,
    { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement"] },
    { client, now },
  );
  // Spec step 297: on the demo bank, a practice portfolio at that profile's level (Medium) with
  // weeks of trades to talk about. The first sync starts it by itself for a demo person (Phase
  // AW, src/lib/practice/demo-start.ts); this only fills in if that didn't. Practice money only.
  if (!person && !(await client.practicePortfolio.findFirst({ where: { userId: user.id } })))
    await seedPractice(user.id, client, now);
  return user.id;
}

const DAY_MS = 86_400_000;

async function seedPractice(userId: string, client: PrismaClient, now: Date) {
  const start = new Date(now.getTime() - 45 * DAY_MS);
  await startPractice(userId, 3, { client, now: start });
  await runAutopilot(userId, { client, now: start });
  for (let d = 7; d >= 0; d -= 1) {
    await runPracticeDay(userId, { client, now: new Date(now.getTime() - d * DAY_MS) });
  }
}

export async function deleteCheckPerson(userId: string, { client }: { client: PrismaClient }) {
  await client.user.deleteMany({ where: { id: userId, email: { startsWith: "answer-checks-" } } });
}
