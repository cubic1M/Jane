import {
  BENEFICIARY_SUBTYPES,
  FILE_DISCLAIMER,
  FILE_SECTIONS,
  FULL_SHARE,
  TOD_SUBTYPES,
  type BeneficiaryEvent,
  type FileSection,
} from "@/config/family-file";

// The family looked after (spec step 237). Pure: what is missing or out of date on each
// account, and the family file built from only the sections the person picked.

export type BeneficiaryRow = {
  accountId: string;
  name: string;
  relationship: string;
  sharePct: number;
  tier: "primary" | "contingent";
  // The day the person last said these names are right.
  confirmedOn: string;
};
export type CheckAccount = {
  id: string;
  name: string;
  subtype: string | null;
  mask?: string | null;
};
export type LifeEventRow = { kind: BeneficiaryEvent; on: string };

export type Problem = "missing" | "out_of_date" | "shares";
export type AccountCheck = {
  accountId: string;
  accountName: string;
  // "beneficiary": takes a form; "tod": can be set up to pass to someone; null: nothing to check.
  type: "beneficiary" | "tod" | null;
  problems: Problem[];
  // The event after which the names were last confirmed, when that made them out of date.
  because: BeneficiaryEvent | null;
  names: string[];
};

export function checkAccounts(
  accounts: readonly CheckAccount[],
  rows: readonly BeneficiaryRow[],
  events: readonly LifeEventRow[],
): AccountCheck[] {
  return accounts.flatMap((a): AccountCheck[] => {
    const subtype = (a.subtype ?? "").toLowerCase();
    const type = BENEFICIARY_SUBTYPES.includes(subtype)
      ? "beneficiary"
      : TOD_SUBTYPES.includes(subtype)
        ? "tod"
        : null;
    if (!type) return [];
    const mine = rows.filter((r) => r.accountId === a.id);
    const primary = mine.filter((r) => r.tier === "primary");
    const problems: Problem[] = [];
    let because: BeneficiaryEvent | null = null;
    if (mine.length === 0) {
      // Only a form-naming account is a problem when empty; a bank or brokerage account without
      // a transfer-on-death setup is an option, not a mistake.
      if (type === "beneficiary") problems.push("missing");
    } else {
      if (primary.reduce((s, r) => s + r.sharePct, 0) !== FULL_SHARE) problems.push("shares");
      const confirmed = mine.reduce((m, r) => (r.confirmedOn > m ? r.confirmedOn : m), "");
      const after = events
        .filter((e) => e.on > confirmed)
        .sort((x, y) => (x.on < y.on ? 1 : -1))[0];
      if (after) {
        problems.push("out_of_date");
        because = after.kind;
      }
    }
    return [
      {
        accountId: a.id,
        accountName: a.name,
        type,
        problems,
        because,
        names: mine.map((r) => r.name),
      },
    ];
  });
}

export const needsAttention = (checks: readonly AccountCheck[]) =>
  checks.filter((c) => c.problems.length > 0);

export type ContactRow = { name: string; role: string; phone: string | null; email: string | null };
export type FileData = {
  accounts: readonly (CheckAccount & { institution?: string | null })[];
  checks: readonly AccountCheck[];
  contacts: readonly ContactRow[];
  documents: string;
};

// The file as plain text, with only the sections the person picked. Anything not picked is not
// in it at all, not even its heading.
export function buildFile(picks: readonly FileSection[], data: FileData, today: string): string {
  const lines = [`What my family would need (as of ${today})`, FILE_DISCLAIMER, ""];
  const has = (s: FileSection) => picks.includes(s);
  if (has("accounts")) {
    lines.push(FILE_SECTIONS.accounts);
    for (const a of data.accounts) {
      lines.push(
        `- ${a.name}${a.mask ? ` (ending ${a.mask})` : ""}${a.institution ? `, ${a.institution}` : ""}`,
      );
    }
    lines.push("");
  }
  if (has("beneficiaries")) {
    lines.push(FILE_SECTIONS.beneficiaries);
    for (const c of data.checks) {
      lines.push(`- ${c.accountName}: ${c.names.length > 0 ? c.names.join(", ") : "nobody named"}`);
    }
    lines.push("");
  }
  if (has("contacts")) {
    lines.push(FILE_SECTIONS.contacts);
    for (const c of data.contacts) {
      lines.push(
        `- ${c.name} (${c.role})${c.phone ? ` ${c.phone}` : ""}${c.email ? ` ${c.email}` : ""}`,
      );
    }
    lines.push("");
  }
  if (has("documents") && data.documents.trim() !== "") {
    lines.push(FILE_SECTIONS.documents, data.documents.trim(), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}
