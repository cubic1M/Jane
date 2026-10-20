import { NOTICE_FIELDS } from "@/config/tax-notices";
import type { Fields } from "@/planning/tax-notice";

// The fields read from a letter form (kept out of the "use server" actions file, which may
// only export async functions).
export function fieldsFrom(formData: FormData): Fields {
  const fields: Fields = {};
  for (const f of NOTICE_FIELDS) {
    const v = String(formData.get(f.key) ?? "").trim();
    if (v) fields[f.key] = v;
  }
  return fields;
}
