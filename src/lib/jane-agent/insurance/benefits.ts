import type { PrismaClient } from "@/generated/prisma/client";
import { listBenefits, openEnrollmentAtWork } from "@/lib/insurance/benefits";
import { latestCheckup } from "@/lib/insurance/checkups";
import { openEnrollmentDates } from "@/lib/insurance/health";
import type { Reply } from "../replies";
import { BENEFITS_LINK, benefitLine } from "./benefit-words";
import { dayLabel } from "@/lib/day-label";

// "What benefits do I get through work?" (spec step 150): the benefits on file, the
// employer's open enrollment, and Jane's recommendation when it's ready (demo advice).

export async function benefitsAnswer(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  const [benefits, window, review] = await Promise.all([
    listBenefits(userId, { client }),
    openEnrollmentAtWork(userId, { client, now }),
    latestCheckup(userId, { client }),
  ]);
  const confirmed = benefits.filter((b) => b.status === "confirmed");
  const found = benefits.filter((b) => b.status === "found");
  const marketplace = openEnrollmentDates(now.toISOString().slice(0, 10)).at(-1)!;
  const lines: string[] = [];
  if (confirmed.length === 0 && found.length === 0) {
    lines.push(
      "I don't have any benefits through work on file yet. If your job gives you health, life or disability cover, add it on your insurance page.",
    );
  } else {
    lines.push(
      `You have ${confirmed.length === 1 ? "1 benefit" : `${confirmed.length} benefits`} through work on file${found.length > 0 ? `, and ${found.length} I found on your pay stub to confirm` : ""}.`,
      ...[...confirmed, ...found].map(
        (b) => `- ${benefitLine(b)}${b.status === "found" ? " (not confirmed yet)" : ""}`,
      ),
    );
  }
  lines.push(
    window
      ? `Open enrollment at ${window.employer} runs ${dayLabel(window.start, { year: true })} to ${dayLabel(window.end, { year: true })}; marketplace plans close on ${dayLabel(marketplace.date, { year: true })}.`
      : `Marketplace open enrollment closes on ${dayLabel(marketplace.date, { year: true })}.`,
  );
  const ready = review?.reason === "enrollment" ? review : null;
  if (ready && ready.recommendations.length > 0) {
    lines.push(
      `My recommendation for open enrollment: ${ready.recommendations[0].title} ${ready.recommendations[0].risk}`,
    );
  }
  return {
    body: lines.join("\n"),
    actions: [BENEFITS_LINK],
    refs: ready ? { advice: true, insuranceCheckupId: ready.id } : {},
  };
}
