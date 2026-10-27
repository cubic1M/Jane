import type { DocumentContentType } from "@/config/documents";
import { COVERAGE_FIELDS, POLICY_KINDS, type PolicyKind } from "@/config/insurance";
import { anthropic } from "@/lib/anthropic";
import { readFields, type ReadResult } from "@/lib/read-fields";
import type { Fields } from "./reading-rules";

// Claude reads a policy's deductible and cover limits off its declarations page or renewal
// notice (spec step 151); step 68 already read the insurer, price and renewal date. The
// answer is held to a JSON schema and every value then goes through the reading rules
// (src/lib/insurance/reading-rules.ts) before the person sees it. Without a key, or when
// reading fails, nothing is read: the fields are prefilled from payments instead.

const HOW: Record<string, string> = {
  money: "in dollars as a plain number like 100000",
  yesno: "as yes or no",
  years: "in whole years",
  percent: "as a whole percent like 80",
  days: "in whole days",
};

function prompt(kind: PolicyKind): string {
  return [
    `This is the person's ${POLICY_KINDS[kind].toLowerCase()} insurance declarations page or renewal notice. Read its cover limits.`,
    "deductible: the deductible in dollars as a plain number.",
    ...COVERAGE_FIELDS[kind].map((f) => `${f.key}: ${f.label}, ${HOW[f.type]}.`),
    "Leave any field you can't find as an empty string. Never guess.",
  ].join("\n");
}

export type DetailsResult = ReadResult<Fields>;

export async function readPolicyDetails(
  file: { bytes: Uint8Array; contentType: DocumentContentType },
  kind: PolicyKind,
  { claude = anthropic }: { claude?: typeof anthropic } = {},
): Promise<DetailsResult> {
  const coverage = COVERAGE_FIELDS[kind].map((f) => f.key);
  const result = await readFields(file, {
    keys: ["deductible", ...coverage],
    prompt: prompt(kind),
    maxTokens: 800,
    claude,
  });
  if (result.kind !== "claude") return result;
  const fields: Fields = {};
  for (const [key, value] of Object.entries(result.fields)) {
    if (value) fields[key === "deductible" ? key : `coverage.${key}`] = value;
  }
  return { kind: "claude", fields };
}
