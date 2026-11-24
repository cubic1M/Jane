import { withoutAchDetails } from "@/data-sources/merchant";

// The payer on a paycheck line: no ACH details, no bank's "Deposit from" (Capital One 360),
// "DEPOSIT - " (Navy Federal) or "ACH CREDIT" (Truist) in front, and nothing from "PAYROLL" on
// (debugger 11-01, 11-02).
export function employerName(description: string): string {
  return (
    withoutAchDetails(description)
      .trim()
      .replace(
        /^(?:DEPOSIT FROM|DEPOSIT -|ACH CREDIT|ACH DEPOSIT,?|DIRECT DEP(?:OSIT)?(?: FROM)?)\s+/i,
        "",
      )
      .replace(/\s+PAYROLL.*$/i, "")
      .replace(/\s+ACH (?:CREDIT|DEPOSIT)$/i, "")
      .replace(/\s+(?:PPD|WEB|CCD)\s+ID:\s*\d+\s*$/i, "")
      // A per-deposit date or number at the end ("SPRINGFIELD SCHOOLS 102025", "ACME 03/15"): not
      // part of the name (debugger 11-14).
      .replace(/\s+(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4,})$/, "")
      .trim()
  );
}
