"use server";

import { logAudit } from "@/lib/audit";
import { scopedDb } from "@/lib/db-scoped";
import { cleanReport, saveProblemReport } from "@/lib/problem-reports";
import { requireUser } from "@/lib/session";

export type ReportResult = { ok: true } | { ok: false; error: string };

// Saves the person's report with the page it's about. The audit log keeps that one was sent, not
// its words; analytics hears nothing.
export async function sendProblemReport(formData: FormData): Promise<ReportResult> {
  const user = await requireUser();
  const report = cleanReport(formData.get("from"), formData.get("message"));
  if (typeof report === "string") return { ok: false, error: report };
  const db = await scopedDb();
  const id = await saveProblemReport(db, report);
  await logAudit({ type: "user", id: user.id }, "problem_reported", { type: "problem_report", id });
  return { ok: true };
}
