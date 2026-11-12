"use server";

import { after } from "next/server";
import { logAudit } from "@/lib/audit";
import { encryptBytes } from "@/lib/crypto";
import { scopedDb } from "@/lib/db-scoped";
import { emailFeedback } from "@/lib/feedback-email";
import { cleanReport, cleanScreenshot, saveProblemReport } from "@/lib/problem-reports";
import { hit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { saveTryFeedback } from "@/lib/try-feedback";
import { isTrialUser } from "@/lib/trial-ids";

export type ReportResult = { ok: true } | { ok: false; error: string };

// Saves the person's feedback with the page it's about, and a screenshot if they attached one, then
// emails the founders the words and the page (never the screenshot). The audit log keeps that one
// was sent, not its words; analytics hears nothing.
export async function sendProblemReport(formData: FormData): Promise<ReportResult> {
  const user = await requireUser();
  const sample = isTrialUser(user.id);
  if (
    !(await hit("problemReports", user.id)).ok ||
    (sample && !(await hit("sampleProblemReports", "all")).ok)
  ) {
    return { ok: false, error: "That's a lot of reports. Try again in an hour." };
  }
  const report = cleanReport(formData.get("from"), formData.get("message"));
  if (typeof report === "string") return { ok: false, error: report };
  // A try is deleted, and a report saved with its person would go too: kept apart, tied to no one,
  // with no picture.
  if (sample) {
    await saveTryFeedback(user.id, report);
    return { ok: true };
  }
  const screenshot = await cleanScreenshot(formData.get("screenshot"));
  if (typeof screenshot === "string") return { ok: false, error: screenshot };
  const db = await scopedDb();
  const id = await saveProblemReport(
    db,
    report,
    screenshot && { encrypted: encryptBytes(screenshot.bytes), type: screenshot.type },
  );
  await logAudit(
    { type: "user", id: user.id },
    "problem_reported",
    { type: "problem_report", id },
    { screenshot: screenshot !== null },
  );
  after(() =>
    emailFeedback({
      ...report,
      screenshot: screenshot !== null,
      replyTo: user.email ?? null,
    }),
  );
  return { ok: true };
}
