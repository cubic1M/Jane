import { after } from "next/server";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { log } from "@/lib/log";
import { mayRescan } from "@/lib/trial-rescans";

// "An answer changes the cards at once" (walk on da81c3495): the cards on the Taxes page and in the
// dock say what the last scan found, so an answer that decides whether one applies (a citizen's
// education and earned income credit cards, a student visa's none) used to show only after the next
// scan, upload or nightly. Every answer to a profile or tax question (the question card, What Jane
// knows, the chat, the tax profile) and every forget runs the same suggestion scan again, after the
// reply has gone out. It is the existing scan (src/lib/suggestions.ts), not a second engine, and a
// scan that fails does not undo what the person said. Outside a request (a script, a test) there is
// nothing to run after, and the nightly scan stands.
//
// The scan does not learn from the data again (`learn: false`): the person may have just deleted
// memory, and the nightly scan does that. Rescans of one person in this server run one after the
// other, so a scan that started on an older answer cannot finish after, and overwrite, a newer one.
const lastScan = new Map<string, Promise<void>>();

export async function rescanAfterAnswer(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<void> {
  const run = async () => {
    try {
      // The limit is counted only for a scan that is going to run.
      if (!(await mayRescan(userId))) return;
      const { scanSuggestions } = await import("@/lib/suggestions");
      await scanSuggestions(userId, { client, now, learn: false });
    } catch (error) {
      log.error("Scanning after an answer failed", { error: String(error) });
    }
  };
  try {
    after(() => {
      const turn = (lastScan.get(userId) ?? Promise.resolve()).then(run);
      lastScan.set(userId, turn);
      return turn.finally(() => {
        if (lastScan.get(userId) === turn) lastScan.delete(userId);
      });
    });
  } catch {
    // Not inside a request: nothing to run it after.
  }
}
