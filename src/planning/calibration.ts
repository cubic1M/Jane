import { CALIBRATION_BAND, CALIBRATION_MIN_SAMPLE, CALIBRATION_TOLERANCE } from "@/config/reach";

// Is Jane's confidence honest? (spec step 258). Pure. Of the suggestions she was about 80%
// sure of, about 80% should prove right. "Right" here is what the person did with it: yes is
// right, no is wrong (the results of what then worked, step 207, refine it per kind of
// finding). Only answered suggestions count.

export type Answered = { detector: string; percent: number; right: boolean };

export type Band = {
  from: number;
  to: number;
  count: number;
  // The average confidence stated, and the share that proved right, both whole percentages.
  stated: number;
  actual: number;
};
export type OffDetector = {
  detector: string;
  count: number;
  stated: number;
  actual: number;
  // "high" means Jane was surer than the results justify.
  direction: "high" | "low";
};

const pct = (n: number, d: number) => Math.round((100 * n) / d);

export function bandsOf(rows: readonly Answered[]): Band[] {
  const groups = new Map<number, Answered[]>();
  for (const r of rows) {
    const from = Math.min(
      100 - CALIBRATION_BAND,
      Math.floor(r.percent / CALIBRATION_BAND) * CALIBRATION_BAND,
    );
    groups.set(from, [...(groups.get(from) ?? []), r]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([from, list]) => ({
      from,
      to: from + CALIBRATION_BAND,
      count: list.length,
      stated: Math.round(list.reduce((s, r) => s + r.percent, 0) / list.length),
      actual: pct(list.filter((r) => r.right).length, list.length),
    }));
}

// Detectors whose percentages run high or low, so they can be corrected.
export function offDetectors(rows: readonly Answered[]): OffDetector[] {
  const by = new Map<string, Answered[]>();
  for (const r of rows) by.set(r.detector, [...(by.get(r.detector) ?? []), r]);
  return [...by.entries()]
    .flatMap(([detector, list]) => {
      if (list.length < CALIBRATION_MIN_SAMPLE) return [];
      const stated = Math.round(list.reduce((s, r) => s + r.percent, 0) / list.length);
      const actual = pct(list.filter((r) => r.right).length, list.length);
      if (Math.abs(stated - actual) < CALIBRATION_TOLERANCE) return [];
      return [
        {
          detector,
          count: list.length,
          stated,
          actual,
          direction: stated > actual ? ("high" as const) : ("low" as const),
        },
      ];
    })
    .sort((a, b) => a.detector.localeCompare(b.detector));
}
