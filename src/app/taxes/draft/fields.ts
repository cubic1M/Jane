import { DRAFT_FIELDS } from "@/config/draft-return";
import type { DraftFields } from "@/planning/draft-return";

// The form's draft fields, trimmed, empty ones left out. Kept out of actions.ts because a "use
// server" file may only export async functions.
export function draftFieldsFrom(formData: FormData): DraftFields {
  const fields: DraftFields = {};
  for (const f of DRAFT_FIELDS) {
    const value = String(formData.get(f.key) ?? "").trim();
    if (value) fields[f.key] = value;
  }
  return fields;
}
