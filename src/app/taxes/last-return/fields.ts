import { PRIOR_RETURN_FIELDS } from "@/config/prior-return";
import type { Fields } from "@/planning/prior-return";

// The form's return fields, trimmed, empty ones left out. Kept out of actions.ts because a
// "use server" file may only export async functions.
export function fieldsFrom(formData: FormData): Fields {
  const fields: Fields = {};
  for (const f of PRIOR_RETURN_FIELDS) {
    const value = String(formData.get(f.key) ?? "").trim();
    if (value) fields[f.key] = value;
  }
  return fields;
}
