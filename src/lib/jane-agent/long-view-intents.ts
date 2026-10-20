// The long view (spec step 209), typed: "where will I be in 30 years", "what will my net
// worth be when I retire", "the long view". Pure.

export type LongViewIntent = { kind: "long_view" };

const LONG_VIEW =
  /\b(?:long view|long[- ]term picture|where (?:will|would) i be (?:in|at) (?:\d+|ten|twenty|thirty) years?)\b|\bin (?:10|20|30|ten|twenty|thirty) years\b.*\b(?:net worth|worth|have|saved)\b|\b(?:net worth|worth)\b.*\bin (?:10|20|30|ten|twenty|thirty) years\b|\bnet worth (?:when i retire|at retirement)\b|\bwhere is my money (?:heading|going) (?:long term|over the years)\b/;

export function parseLongView(text: string): LongViewIntent | null {
  return LONG_VIEW.test(text) ? { kind: "long_view" } : null;
}
