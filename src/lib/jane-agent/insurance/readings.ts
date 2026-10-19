import type { PrismaClient } from "@/generated/prisma/client";
import { loadInsurance } from "@/lib/insurance/profile";
import { listReadings } from "@/lib/insurance/readings";
import type { Reply } from "../replies";
import { readingBody, readingLink, readingTitle } from "./reading-words";

// "Did you read my policy?" (spec step 151): the policies Jane read from documents and
// that wait for the person's confirm tap. One waiting is asked right here.

const DOCUMENTS = { id: "open", label: "Documents", kind: "link", href: "/documents" } as const;

export async function readingsAnswer(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  // Reads any policy document not read yet.
  await loadInsurance(userId, { client, now });
  const readings = await listReadings(userId, { client });
  const waiting = readings.filter((r) => r.status === "waiting");
  if (waiting.length === 1) {
    const [reading] = waiting;
    return {
      body: readingBody(reading),
      actions: [
        { id: "reading.confirm", label: "Confirm", kind: "primary" },
        readingLink(reading.id),
        { id: "reading.dismiss", label: "Not a policy", kind: "secondary" },
      ],
      refs: { readingId: reading.id },
    };
  }
  if (waiting.length > 1) {
    return {
      body: [
        `I read ${waiting.length} policy documents, waiting for you to confirm what I read.`,
        ...waiting.map((r) => `- ${readingTitle(r).replace(/^./, (c) => c.toUpperCase())}`),
        "Nothing is added to your insurance until you confirm each one.",
      ].join("\n"),
      actions: waiting.slice(0, 3).map((r) => ({ ...readingLink(r.id), label: r.input.carrier })),
      refs: {},
    };
  }
  const confirmed = readings.filter((r) => r.status === "confirmed").length;
  return {
    body:
      confirmed > 0
        ? `Every policy document I've read is confirmed and on your insurance (${confirmed === 1 ? "1 document" : `${confirmed} documents`}). Upload a declarations page or renewal notice on Documents and I'll read it too.`
        : "I haven't read any policy documents yet. Upload a declarations page or renewal notice on Documents and I'll read the insurer, price, deductible and cover limits for you to confirm.",
    actions: [DOCUMENTS],
    refs: {},
  };
}
