import { createHash } from "node:crypto";

// A finding as Jane describes it in the chat: its type, title, saving and evidence. A
// button only acts while this is unchanged; newer card wording (Claude's explanation)
// doesn't change it.
export function findingFingerprint(finding: {
  id: string;
  type: string;
  title: string;
  annualSavingsCents: number | null;
  evidence: unknown;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        finding.id,
        finding.type,
        finding.title,
        finding.annualSavingsCents,
        finding.evidence,
      ]),
    )
    .digest("hex");
}
